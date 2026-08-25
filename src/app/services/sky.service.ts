import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { SkyState } from '@gl';
import { LightSource, SkyEvent } from '@interfaces';
import { bodyPath, bodyPosition, nextRise, nextSet, SkyPosition, skyDirection } from '@utils';

import { CameraService } from './camera.service';
import { MilkyWayService } from './milky-way.service';
import { SettingsService } from './settings.service';
import { TerrainService } from './terrain.service';
import { TimezoneService } from './timezone.service';
import { ViewpointService } from './viewpoint.service';

/** Minutes between samples along the drawn track */
const PATH_STEP = 5;
/** Sampling step for crossings */
const EVENT_STEP = 1;
/** Azimuth bins in the skyline profile */
const HORIZON_BINS = 720;

/**
 * Where the sun or moon sits, and the track it follows across the day, for the
 * moment and place currently being viewed.
 */
@Injectable({ providedIn: 'root' })
export class SkyService {
	private readonly tick = setInterval(() => {
		if (this.live()) {
			this.moment.set(new Date());
		}
	}, 30_000);

	private readonly viewpoint = inject(ViewpointService);
	private readonly settings = inject(SettingsService);
	private readonly terrain = inject(TerrainService);
	private readonly camera = inject(CameraService);
	private readonly milkyWay = inject(MilkyWayService);
	private readonly timezone = inject(TimezoneService);

	constructor() {
		inject(DestroyRef).onDestroy(() => clearInterval(this.tick));
	}

	/** The moment being shown */
	readonly moment = signal(new Date());

	/**
	 * Set once a time has been chosen by hand, which stops the clock from moving
	 * underneath it. Until then the view is of the sky as it is, and follows it.
	 */
	private readonly held = signal(false);

	/** Whether the moment tracks the real clock */
	readonly live = computed(() => !this.held());

	/** Which bodies are on show */
	readonly bodies = computed<LightSource[]>(() => {
		const bodies: LightSource[] = [];
		if (this.settings.showSun()) {
			bodies.push('sun');
		}
		if (this.settings.showMoon()) {
			bodies.push('moon');
		}
		return bodies;
	});

	readonly positions = computed(() =>
		this.bodies().map((body) => ({
			body,
			position: bodyPosition(body, this.moment(), this.viewpoint.position()),
		})),
	);

	/** Ready to hand straight to the renderer */
	readonly state = computed<SkyState>(() => {
		const moment = this.moment();
		const place = this.viewpoint.position();
		const state: SkyState = {};

		for (const body of this.bodies()) {
			state[body] = {
				direction: skyDirection(bodyPosition(body, moment, place)),
				path: flatten(bodyPath(body, moment, place, PATH_STEP)),
			};
		}

		const milkyWay = this.milkyWay.rings(moment);
		if (milkyWay.length) {
			state.milkyWay = milkyWay;
		}
		return state;
	});

	/**
	 * Elevation angle of the mountains in every direction. Recomputed only when
	 * the terrain or the eye height changes, since the sweep is not free.
	 */
	private readonly horizon = computed(() => {
		const field = this.terrain.field();
		if (!field) {
			return null;
		}
		return field.horizonProfile(
			this.camera.altitude(),
			this.settings.visibility(),
			HORIZON_BINS,
		);
	});

	/** Where and when a body crosses the skyline */
	readonly events = computed<SkyEvent[]>(() => {
		const horizon = this.horizon();
		if (!horizon) {
			return [];
		}

		const events: SkyEvent[] = [];

		for (const body of this.bodies()) {
			const path = bodyPath(body, this.moment(), this.viewpoint.position(), EVENT_STEP);
			let previous = path[0].altitude - horizonAt(horizon, path[0].azimuth);

			for (let i = 1; i < path.length; i++) {
				const clearance = path[i].altitude - horizonAt(horizon, path[i].azimuth);
				if (previous === 0 || clearance === 0 || previous < 0 === clearance < 0) {
					previous = clearance;
					continue;
				}

				const t = previous / (previous - clearance);
				const before = path[i - 1].time.getTime();
				events.push({
					body,
					kind: clearance > 0 ? 'rise' : 'set',
					source: 'skyline',
					time: new Date(before + (path[i].time.getTime() - before) * t),
					azimuth: interpolateAzimuth(path[i - 1].azimuth, path[i].azimuth, t),
					altitude: path[i - 1].altitude + (path[i].altitude - path[i - 1].altitude) * t,
				});
				previous = clearance;
			}

			// Where the ground never rose to meet the track there is no crossing to
			// report, and the arc used to simply stop with nothing said. The true
			// horizon still happened, so that is what gets reported instead.
			for (const kind of ['rise', 'set'] as const) {
				if (events.some((event) => event.body === body && event.kind === kind)) {
					continue;
				}
				const at = this.horizonFallback(body, kind, horizon);
				if (at) {
					events.push(at);
				}
			}
		}
		return events.sort((a, b) => a.time.getTime() - b.time.getTime());
	});

	/**
	 * Rise or set against the true horizon, for a body no mountain hides.
	 *
	 * Only where the moment could actually be watched. A body whose whole arc
	 * passes behind the relief has no crossing to report either, but reporting
	 * the horizon instead would pin a time to a patch of mountainside with
	 * nothing happening on it.
	 */
	private horizonFallback(
		body: LightSource,
		kind: 'rise' | 'set',
		horizon: Float32Array,
	): SkyEvent | null {
		const place = this.viewpoint.position();
		const start = new Date(this.moment().getTime() - 12 * 3_600_000);
		const time = kind === 'rise' ? nextRise(body, start, place) : nextSet(body, start, place);
		if (!time) {
			return null;
		}

		const where = bodyPosition(body, time, place);
		if (where.altitude <= horizonAt(horizon, where.azimuth)) {
			return null;
		}

		return {
			body,
			kind,
			source: 'horizon',
			time,
			azimuth: where.azimuth,
			altitude: where.altitude,
		};
	}

	/**
	 * `YYYY-MM-DD` and `HH:MM` on the viewpoint's clock, for the pickers.
	 *
	 * The whole app quotes one clock — the one in force where you are looking —
	 * so the picker has to agree with the tables under it. Picking noon means
	 * noon there, not noon here.
	 */
	readonly date = computed(() => this.timezone.dateValue(this.moment()));
	readonly time = computed(() => this.timezone.timeValue(this.moment()));

	setDate(value: string): void {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
			return;
		}
		this.held.set(true);
		this.moment.set(this.timezone.fromValues(value, this.time()));
	}

	setTime(value: string): void {
		if (!/^\d{2}:\d{2}/.test(value)) {
			return;
		}
		this.held.set(true);
		this.moment.set(this.timezone.fromValues(this.date(), value.slice(0, 5)));
	}

	/** Back to now, and following the clock again */
	now(): void {
		this.held.set(false);
		this.moment.set(new Date());
	}

	/** Holds the moment, or lets it run */
	toggleHold(): void {
		if (this.held()) {
			this.now();
			return;
		}
		this.held.set(true);
	}
}

/** Sky positions, as the renderer wants them */
function flatten(path: SkyPosition[]): Float32Array {
	const flat = new Float32Array(path.length * 3);

	path.forEach((position, index) => {
		const [east, north, up] = skyDirection(position);
		flat[index * 3] = east;
		flat[index * 3 + 1] = north;
		flat[index * 3 + 2] = up;
	});
	return flat;
}

/** Skyline angle at an azimuth, between bins */
function horizonAt(profile: Float32Array, azimuth: number): number {
	const bins = profile.length;
	const position = (((azimuth % 360) + 360) % 360) * (bins / 360);
	const low = Math.floor(position) % bins;
	const high = (low + 1) % bins;
	const fraction = position - Math.floor(position);

	return profile[low] + (profile[high] - profile[low]) * fraction;
}

/** Interpolates across the seam the short way */
function interpolateAzimuth(from: number, to: number, t: number): number {
	let delta = to - from;
	if (delta > 180) {
		delta -= 360;
	} else if (delta < -180) {
		delta += 360;
	}
	return (((from + delta * t) % 360) + 360) % 360;
}
