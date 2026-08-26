import { computed, effect, inject, Injectable, resource, signal, untracked } from '@angular/core';
import { environment } from '@environments';
import { buildHorizonMask, hasLineOfSightAcross, HeightField, HorizonMask, maskVerdict } from '@gl';
import { isLandform, LatLon, Peak, PeakKind } from '@interfaces';
import {
	bearingBetween,
	curvatureDrop,
	DEG,
	distanceBetween,
	METRES_PER_DEGREE_LAT,
	metresPerDegreeLon,
	toLocal,
} from '@utils';

import { CameraService } from './camera.service';
import { DataWarningService } from './data-warning.service';
import { OfflineCacheService, ResponseStore } from './offline-cache.service';
import { SettingsService } from './settings.service';
import { TerrainService } from './terrain.service';
import { ViewpointService } from './viewpoint.service';
import { TranslateService } from '@ngx-translate/core';

/** One row as the local summit API returns it */
interface PeaksApiPeak {
	id: string;
	name: string;
	lat: number;
	lon: number;
	elevation: number | null;
	kind: string;
}

interface PeaksApiResponse {
	peaks?: PeaksApiPeak[];
	error?: string;
}

/**
 * Cell size as a fraction of the visible radius. Bigger cells mean fewer
 * distinct queries, and so more reuse both of the network and of the store;
 * smaller ones mean less over-fetching. A quarter asks for about forty per cent
 * more area than the view needs, and lets the viewpoint move a good few
 * kilometres before anything has to be fetched again.
 */
const REGION_FRACTION = 0.25;

/**
 * Degrees a summit may sit below the skyline and still be named. Roughly four
 * screen pixels at the usual field of view.
 */
const OCCLUSION_SLACK = 0.25;

/** Stillness before the skyline is rebuilt */
const SETTLE_DELAY = 180;

/** The area one summit query covers */
export interface SummitRegion {
	centre: LatLon;
	radius: number;
}

/**
 * The query covering a viewpoint, snapped to a grid so that neighbours share it.
 *
 * Asking for exactly what the viewpoint can see makes every position its own
 * request, which is fine online and useless offline: a stored area only answers
 * for the one point it was stored at. Snapping the centre and reaching a little
 * further gives every viewpoint in a cell the same query — the same URL, so the
 * same entry in the store — and the extra summits are dropped when the list is
 * filtered to what is actually in range.
 */
export function summitRegion(origin: LatLon, radius: number): SummitRegion {
	const cell = radius * REGION_FRACTION;

	const latStep = cell / METRES_PER_DEGREE_LAT;
	const lat = Math.round(origin.lat / latStep) * latStep;
	const lonStep = cell / metresPerDegreeLon(lat);
	const lon = Math.round(origin.lon / lonStep) * lonStep;

	return {
		// Fixed precision, so a centre that is arithmetically the same is also
		// the same string in the url the store is keyed by.
		centre: { lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)) },
		// Half a cell along each axis is as far as the viewpoint can sit from the
		// centre, so the query has to reach that much further than the view does.
		radius: Math.round(radius + cell * Math.SQRT1_2),
	};
}

function sameRegion(a?: SummitQuery, b?: SummitQuery): boolean {
	if (!a || !b) {
		return a === b;
	}
	return (
		a.centre.lat === b.centre.lat &&
		a.centre.lon === b.centre.lon &&
		a.radius === b.radius &&
		a.language === b.language
	);
}

/** A region, and the language its names should come back in */
type SummitQuery = SummitRegion & { language: string };

/** A named summit, before viewer geometry */
type RawPeak = LatLon & { id: string; name: string; elevation: number | null; kind: PeakKind };

@Injectable({ providedIn: 'root' })
export class PeaksService {
	private readonly viewpoint = inject(ViewpointService);
	private readonly terrain = inject(TerrainService);
	private readonly camera = inject(CameraService);
	private readonly settings = inject(SettingsService);
	private readonly cache = inject(OfflineCacheService);
	private readonly warning = inject(DataWarningService);
	private readonly translate = inject(TranslateService);

	/**
	 * Held apart from the viewpoint so that moving within one cell is not a
	 * change: the resource only reloads when this comes out different.
	 */
	private readonly region = computed<SummitQuery | undefined>(
		() =>
			this.warning.permitted()
				? {
						...summitRegion(this.viewpoint.position(), this.settings.visibility()),
						language: this.translate.currentLang() ?? '',
					}
				: undefined,
		{ equal: sameRegion },
	);

	private readonly summits = resource({
		params: () => this.region(),
		loader: ({ params, abortSignal }) =>
			fetchSummits(params.centre, params.radius, abortSignal, this.cache, params.language),
		defaultValue: [] as RawPeak[],
	});

	constructor() {
		let timer: ReturnType<typeof setTimeout> | undefined;
		effect((onCleanup) => {
			const altitude = this.camera.altitude();
			// The first reading is the one already on screen, so it lands at once.
			if (untracked(() => this.settledAltitude()) === altitude) {
				return;
			}
			timer = setTimeout(() => this.settledAltitude.set(altitude), SETTLE_DELAY);
			onCleanup(() => clearTimeout(timer));
		});
	}

	/** Summits in range, nearest first */
	/**
	 * The skyline from the current viewpoint, rebuilt when the ground under it or
	 * the height above it changes. Every summit is then a lookup rather than its
	 * own walk across the terrain.
	 */
	private readonly horizon = computed<HorizonMask | null>(() => {
		const rings = this.terrain.rings();
		if (!rings.length) {
			return null;
		}
		return buildHorizonMask(rings, this.settledAltitude(), this.settings.visibility());
	});

	/**
	 * The eye height the skyline is built for, which follows the camera but does
	 * not chase it.
	 *
	 * Raising the viewpoint is a held button that steps many times a second, and
	 * the skyline costs tens of milliseconds to rebuild. Rebuilding on every step
	 * spends the whole frame on labels and leaves none for the landscape, so the
	 * climb is allowed to finish first.
	 */
	private readonly settledAltitude = signal(this.camera.altitude());

	readonly peaks = computed<Peak[]>(() => {
		const rings = this.terrain.rings();
		const field = rings[rings.length - 1];
		const summits = this.summits.hasValue() ? this.summits.value() : [];
		if (!field || !summits.length) {
			return [];
		}

		const eye = this.settledAltitude();
		const origin = this.viewpoint.position();
		const horizon = this.horizon();

		const radius = this.settings.visibility();
		const landforms = this.settings.showRanges();
		return summits
			.filter((summit) => landforms || !isLandform(summit.kind))
			.map((summit) => describe(summit, origin, rings, eye, horizon))
			.filter((peak) => peak.distance <= radius)
			.sort((a, b) => a.distance - b.distance);
	});

	readonly visiblePeaks = computed(() => this.peaks().filter((peak) => peak.visible));

	readonly loading = computed(() => this.summits.isLoading() || this.terrain.loading());
	readonly error = computed(() => this.summits.error() as Error | undefined);

	reload(): void {
		this.summits.reload();
	}
}

/**
 * Whether a summit is in view.
 *
 * The skyline settles the clear cases at a glance; the rest are walked. Most
 * summits standing in the open are settled by the first test, and most of the
 * hidden ones meet their blocker within the first few hundred metres, so the
 * walk that remains is short.
 */
function seen(
	horizon: HorizonMask | null,
	rings: HeightField[],
	eye: number,
	target: { east: number; north: number; up: number },
	distance: number,
	bearing: number,
): boolean {
	const lifted = { ...target, up: target.up + Math.tan(OCCLUSION_SLACK * DEG) * distance };

	if (horizon) {
		const angle = Math.atan2(lifted.up - curvatureDrop(distance) - eye, distance) / DEG;
		const verdict = maskVerdict(horizon, bearing, distance, angle);
		if (verdict !== 'unsure') {
			return verdict === 'visible';
		}
	}
	return hasLineOfSightAcross(rings, eye, lifted);
}

function describe(
	summit: RawPeak,
	origin: LatLon,
	rings: HeightField[],
	eye: number,
	horizon: HorizonMask | null,
): Peak {
	const field = rings[rings.length - 1];
	const { east, north } = toLocal(origin, summit);

	const up = field.elevationAt(summit.lat, summit.lon);
	const distance = distanceBetween(origin, summit);
	const bearing = bearingBetween(origin, summit);

	return {
		id: summit.id,
		name: summit.name,
		kind: summit.kind,
		lat: summit.lat,
		lon: summit.lon,
		elevation: summit.elevation ?? up,
		distance,
		bearing,
		east,
		north,
		up,
		visible: seen(horizon, rings, eye, { east, north, up }, distance, bearing),
	};
}

export async function fetchSummits(
	origin: LatLon,
	radius: number,
	abortSignal: AbortSignal,
	cache?: ResponseStore,
	language = '',
): Promise<RawPeak[]> {
	const url = new URL(environment.peaksApiUrl, globalThis.location?.href);
	url.searchParams.set('lat', String(origin.lat));
	url.searchParams.set('lon', String(origin.lon));
	url.searchParams.set('radius', String(radius));
	// Part of the url, so each language is stored under its own key rather than
	// one overwriting another in the offline cache.
	if (language) {
		url.searchParams.set('lang', language);
	}
	const key = url.toString();

	const stored = await cache?.match(key);
	const body = stored
		? ((JSON.parse(await stored.text()) as PeaksApiResponse) ?? {})
		: await fetchSummitsFresh(url, key, abortSignal, cache);

	return (body.peaks ?? []).map((peak) => ({
		id: peak.id,
		name: peak.name,
		lat: peak.lat,
		lon: peak.lon,
		elevation: peak.elevation,
		kind: asKind(peak.kind),
	}));
}

async function fetchSummitsFresh(
	url: URL,
	key: string,
	abortSignal: AbortSignal,
	cache?: ResponseStore,
): Promise<PeaksApiResponse> {
	let response: Response;
	try {
		response = await fetch(url, { signal: abortSignal });
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') {
			throw error;
		}
		throw new Error('errors.summitsUnreachable');
	}

	const text = await response.text();
	const body = (safeParse(text) ?? {}) as PeaksApiResponse;
	if (!response.ok) {
		throw new Error(body.error ?? 'errors.summitsFailed');
	}

	await cache?.put(key, new Blob([text], { type: 'application/json' }));
	return body;
}

/** Unrecognised kinds count as summits */
function asKind(value: string): PeakKind {
	const kinds: PeakKind[] = ['volcano', 'mountain_range', 'ridge', 'hill', 'region'];
	return (kinds as string[]).includes(value) ? (value as PeakKind) : 'peak';
}

function safeParse(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}
