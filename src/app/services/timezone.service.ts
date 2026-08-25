import { computed, inject, Injectable, resource } from '@angular/core';
import { environment } from '@environments';
import { LatLon } from '@interfaces';

import { OfflineCacheService, ResponseStore } from './offline-cache.service';
import { summitRegion } from './peaks.service';
import { ViewpointService } from './viewpoint.service';

interface TimezoneResponse {
	zone?: string;
	offset?: number;
	abbreviation?: string;
	exact?: boolean;
	error?: string;
}

/** The clock in force at a viewpoint */
export interface Timezone {
	/** IANA name, for formatting through `Intl` */
	zone: string;
	/** Seconds east of UTC when asked */
	offset: number;
	abbreviation: string;
}

/** Falls back to the browser's own zone */
function local(): Timezone {
	const format = new Intl.DateTimeFormat();
	return {
		zone: format.resolvedOptions().timeZone,
		offset: -new Date().getTimezoneOffset() * 60,
		abbreviation: '',
	};
}

/**
 * Which clock the viewpoint keeps.
 *
 * Sunrise at a place is a fact about that place, so it belongs on that place's
 * clock — showing it on the visitor's makes a tropical sunrise read as noon.
 * The lookup lives in the API rather than in the app because the boundaries are
 * far too large to ship to a browser, and the answer is small enough to cache.
 */
@Injectable({ providedIn: 'root' })
export class TimezoneService {
	private readonly viewpoint = inject(ViewpointService);
	private readonly cache = inject(OfflineCacheService);

	/**
	 * Asked for per region rather than per position, so panning around does not
	 * re-ask and a stored area answers for everywhere inside it.
	 */
	private readonly region = computed(
		() => summitRegion(this.viewpoint.position(), 50_000).centre,
		{ equal: (a, b) => a.lat === b.lat && a.lon === b.lon },
	);

	private readonly lookup = resource({
		params: () => this.region(),
		loader: ({ params, abortSignal }) => fetchTimezone(params, abortSignal, this.cache),
		defaultValue: null as Timezone | null,
	});

	/** The viewpoint's zone, never null */
	readonly zone = computed<Timezone>(
		() => (this.lookup.hasValue() ? this.lookup.value() : null) ?? local(),
	);

	/** Whether the browser's zone is standing in */
	readonly assumed = computed(() => !this.lookup.hasValue() || this.lookup.value() === null);

	/** Seconds east of UTC at the viewpoint */
	offsetAt(when: Date): number {
		const name = new Intl.DateTimeFormat('en-US', {
			timeZone: this.zone().zone,
			timeZoneName: 'longOffset',
		})
			.formatToParts(when)
			.find((part) => part.type === 'timeZoneName')?.value;

		const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name ?? '');
		if (!match) {
			return 0;
		}
		const sign = match[1] === '-' ? -1 : 1;
		return sign * (Number(match[2]) * 3600 + Number(match[3] ?? 0) * 60);
	}

	/** `YYYY-MM-DD` as the viewpoint reads it */
	dateValue(when: Date): string {
		return new Intl.DateTimeFormat('en-CA', {
			timeZone: this.zone().zone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
		}).format(when);
	}

	/** `HH:MM` as the viewpoint reads it */
	timeValue(when: Date): string {
		return new Intl.DateTimeFormat('en-GB', {
			timeZone: this.zone().zone,
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23',
		}).format(when);
	}

	/**
	 * The moment whose reading on the viewpoint's clock is this date and time.
	 *
	 * Solved rather than computed: the offset depends on the instant, and the
	 * instant is what is being looked for. One pass settles it everywhere except
	 * across a change of the clocks, which the second pass catches.
	 */
	fromValues(date: string, time: string): Date {
		const naive = Date.parse(`${date}T${time}:00Z`);
		if (Number.isNaN(naive)) {
			return new Date();
		}
		let settled = new Date(naive - this.offsetAt(new Date(naive)) * 1000);
		settled = new Date(naive - this.offsetAt(settled) * 1000);
		return settled;
	}

	/** Formats a moment on the viewpoint's clock */
	format(when: Date, options: Intl.DateTimeFormatOptions): string {
		return new Intl.DateTimeFormat(undefined, {
			...options,
			timeZone: this.zone().zone,
		}).format(when);
	}

	/** Midnight at the viewpoint on that day */
	startOfDay(when: Date): Date {
		const parts = new Intl.DateTimeFormat('en-CA', {
			timeZone: this.zone().zone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hourCycle: 'h23',
		}).formatToParts(when);

		const at = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
		const secondsIntoDay = at('hour') * 3600 + at('minute') * 60 + at('second');
		return new Date(when.getTime() - secondsIntoDay * 1000);
	}
}

export async function fetchTimezone(
	origin: LatLon,
	abortSignal: AbortSignal,
	cache?: ResponseStore,
): Promise<Timezone | null> {
	const url = new URL(environment.timezoneApiUrl, globalThis.location?.href);
	url.searchParams.set('lat', String(origin.lat));
	url.searchParams.set('lon', String(origin.lon));
	const key = url.toString();

	const stored = await cache?.match(key);
	if (stored) {
		return read((JSON.parse(await stored.text()) as TimezoneResponse) ?? {});
	}

	try {
		const response = await fetch(url, { signal: abortSignal });
		const text = await response.text();
		if (!response.ok) {
			return null;
		}
		await cache?.put(key, new Blob([text], { type: 'application/json' }));
		return read(JSON.parse(text) as TimezoneResponse);
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') {
			throw error;
		}
		// A missing API is not worth a broken screen; the caller falls back.
		return null;
	}
}

function read(body: TimezoneResponse): Timezone | null {
	if (!body.zone) {
		return null;
	}
	return {
		zone: body.zone,
		offset: body.offset ?? 0,
		abbreviation: body.abbreviation ?? '',
	};
}
