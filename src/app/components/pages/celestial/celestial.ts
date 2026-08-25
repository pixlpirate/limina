import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { SkyService, TimezoneService, ViewpointService } from '@services';
import {
	bodyPath,
	CelestialBody,
	moonPhase,
	moonPosition,
	nextRise,
	nextSet,
	solarNoon,
	sunPosition,
} from '@utils';

import { Panel, Table, TableColumn } from '../../molecules';

/** Sun altitudes bounding each stage of dusk */
const TWILIGHTS = [
	{ stage: 'golden', from: 6, to: -4 },
	{ stage: 'blue', from: -4, to: -6 },
	{ stage: 'civil', from: -0.833, to: -6 },
	{ stage: 'nautical', from: -6, to: -12 },
	{ stage: 'astronomical', from: -12, to: -18 },
];

/** One table row: a name and its figure */
interface Row {
	label: string;
	value: string;
}

/** Sky colour per stage, for the swatch */
const STEP_COLOURS: Record<string, string> = {
	golden: '#e8a13c',
	blue: '#3f6cc4',
	civil: '#2b4a8f',
	nautical: '#1b2f63',
	astronomical: '#0f1938',
	sunriseHorizon: '#f2c063',
	sunriseMountains: '#f2c063',
	highestPoint: '#ffe9a8',
	sunsetMountains: '#e8853c',
	sunsetHorizon: '#e8853c',
	moonriseHorizon: '#b9c4d8',
	moonriseMountains: '#b9c4d8',
	moonsetMountains: '#8d97ab',
	moonsetHorizon: '#8d97ab',
};

@Component({
	selector: 'app-celestial',
	changeDetection: ChangeDetectionStrategy.OnPush,
	imports: [Panel, Table, TranslatePipe],
	templateUrl: './celestial.html',
	styleUrl: './celestial.scss',
})
export class Celestial {
	private readonly sky = inject(SkyService);
	private readonly viewpoint = inject(ViewpointService);
	private readonly translate = inject(TranslateService);
	private readonly timezone = inject(TimezoneService);

	protected readonly moment = this.sky.moment;

	/**
	 * The rows arrive as a sequence — rise, set, then the light either side of them — and stay
	 * that way until someone sorts, which is worth having when you are after one figure.
	 */
	/** Bound to the pickers and the landscape drawer */
	protected readonly date = this.sky.date;
	protected readonly time = this.sky.time;
	protected readonly live = this.sky.live;

	protected readonly columns: TableColumn<Row>[] = [
		{
			key: 'label',
			label: 'celestial.step',
			rowHeader: true,
			text: (row) => this.say(row.label),
			swatch: (row) => this.colour(row.label),
		},
		{ key: 'value', label: 'celestial.time', text: (row) => row.value },
	];

	/** Where the sun is now */
	protected readonly sun = computed(() => {
		const place = this.viewpoint.position();
		const position = sunPosition(this.moment(), place);

		this.translate.currentLang();
		return {
			state: this.say(daylight(position.altitude)),
			up: position.altitude > -0.833,
			markerY: -Math.max(-1, Math.min(1, position.altitude / 90)) * 42,
			readings: [
				{
					label: this.say('celestial.heightInSky'),
					value: `${position.altitude.toFixed(1)}°`,
				},
				{
					label: this.say('celestial.direction'),
					value: `${position.azimuth.toFixed(0)}°`,
				},
				{
					label: this.say('celestial.highestToday'),
					value: `${highest('sun', this.moment(), place).toFixed(1)}°`,
				},
				{ label: this.say('celestial.distance'), value: this.say('celestial.sunDistance') },
			],
		};
	});

	protected readonly moon = computed(() => {
		const place = this.viewpoint.position();
		const position = moonPosition(this.moment(), place);
		const phase = moonPhase(this.moment());

		this.translate.currentLang();
		return {
			state: this.say(phase.name),
			/** Terminator width, as an ellipse */
			terminator: Math.abs(Math.cos(phase.fraction * 2 * Math.PI)) * 50,
			/** Which side is lit */
			waxing: phase.fraction < 0.5,
			/** Whether the lit part is wider than a half disc */
			gibbous: phase.illumination > 0.5,
			percent: `${Math.round(phase.illumination * 100)}%`,
			readings: [
				{
					label: this.say('celestial.heightInSky'),
					value: `${position.altitude.toFixed(1)}°`,
				},
				{
					label: this.say('celestial.direction'),
					value: `${position.azimuth.toFixed(0)}°`,
				},
				{
					label: this.say('celestial.highestToday'),
					value: `${highest('moon', this.moment(), place).toFixed(1)}°`,
				},
				{
					label: this.say('celestial.distance'),
					value: `${Math.round(phase.distance).toLocaleString()} km`,
				},
			],
		};
	});

	/**
	 * The sun's day: when it clears the horizon, when it clears the mountains,
	 * and the light either side of both.
	 */
	protected readonly sunRows = computed<Row[]>(() => {
		const when = this.startOfDay();
		const place = this.viewpoint.position();

		const rise = nextRise('sun', when, place);
		const set = rise ? nextSet('sun', rise, place) : null;
		const noon = solarNoon(this.moment(), place);

		const rows: Row[] = [];

		for (const { stage, from, to } of [...TWILIGHTS].reverse()) {
			rows.push({
				label: `celestial.dawn.${stage}`,
				value: this.lightWindow(from, to, 'morning'),
			});
		}

		rows.push(
			{ label: 'celestial.sunriseHorizon', value: this.clock(rise) },
			{ label: 'celestial.sunriseMountains', value: this.crossing('sun', 'rise') },
			{ label: 'celestial.highestPoint', value: this.clock(noon.time) },
			{ label: 'celestial.sunsetMountains', value: this.crossing('sun', 'set') },
			{ label: 'celestial.sunsetHorizon', value: this.clock(set) },
		);

		for (const { stage, from, to } of TWILIGHTS) {
			rows.push({
				label: `celestial.dusk.${stage}`,
				value: this.lightWindow(from, to, 'evening'),
			});
		}

		return rows;
	});

	protected readonly moonRows = computed<Row[]>(() => {
		const when = this.startOfDay();
		const place = this.viewpoint.position();
		const rise = nextRise('moon', when, place);
		const set = rise ? nextSet('moon', rise, place) : null;

		return [
			{ label: 'celestial.moonriseHorizon', value: this.clock(rise) },
			{ label: 'celestial.moonriseMountains', value: this.crossing('moon', 'rise') },
			{ label: 'celestial.moonsetMountains', value: this.crossing('moon', 'set') },
			{ label: 'celestial.moonsetHorizon', value: this.clock(set) },
		];
	});

	/** One half of a light window, morning or evening */
	private lightWindow(from: number, to: number, half: 'morning' | 'evening'): string {
		const when = this.startOfDay();
		const place = this.viewpoint.position();
		const low = Math.min(from, to);
		const high = Math.max(from, to);

		const dawn = nextRise('sun', when, place, low);
		const dawnEnd = nextRise('sun', when, place, high);
		if (half === 'morning') {
			return this.window(dawn, dawnEnd);
		}

		const duskStart = dawnEnd ? nextSet('sun', dawnEnd, place, high) : null;
		const duskEnd = duskStart ? nextSet('sun', duskStart, place, low) : null;
		return this.window(duskStart, duskEnd);
	}

	/** Where and when a body meets the mountains */
	private crossing(body: CelestialBody, kind: 'rise' | 'set'): string {
		const event = this.sky.events().find((item) => item.body === body && item.kind === kind);
		return event ? this.clock(event.time) : '\u2014';
	}

	/** The light a row stands for, if any */
	private colour(label: string): string {
		const stage = label.split('.').pop() ?? '';
		return STEP_COLOURS[stage] ?? '';
	}

	/** Shorthand for the translation catalogue */
	private say(key: string, params?: Record<string, unknown>): string {
		return this.translate.instant(key, params) as string;
	}

	protected toggleHold(): void {
		this.sky.toggleHold();
	}

	protected setDate(value: string): void {
		this.sky.setDate(value);
	}

	protected setTime(value: string): void {
		this.sky.setTime(value);
	}

	/**
	 * Every figure is quoted for the day being viewed, and the day is the one in
	 * progress at the viewpoint — not the one on the reader's own calendar.
	 */
	private startOfDay(): Date {
		return this.timezone.startOfDay(this.moment());
	}

	/** Both ends of a light window */
	private window(from: Date | null, to: Date | null): string {
		return from && to ? `${this.clock(from)} \u2013 ${this.clock(to)}` : '\u2014';
	}

	/** A moment on the viewpoint's clock, as `HH:MM` */
	protected clock(when: Date | null): string {
		if (!when) {
			return '\u2014';
		}
		return this.timezone.format(when, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
	}

	/**
	 * The clock every time on this screen is quoted on, as an offset from UTC.
	 *
	 * An abbreviation only means something to people who already know it — CEST
	 * and AST say nothing about how far from your own clock they are, and several
	 * of them are ambiguous besides.
	 */
	protected readonly zoneLabel = computed(() => {
		const minutes = Math.round(this.timezone.offsetAt(this.moment()) / 60);
		if (minutes === 0) {
			return 'UTC';
		}
		const sign = minutes < 0 ? '−' : '+';
		const hours = Math.floor(Math.abs(minutes) / 60);
		const rest = Math.abs(minutes) % 60;
		return `UTC${sign}${hours}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`;
	});
}

/** Highest the body climbs today */
function highest(body: CelestialBody, when: Date, place: { lat: number; lon: number }): number {
	return bodyPath(body, when, place, 10).reduce(
		(peak, point) => Math.max(peak, point.altitude),
		-90,
	);
}

/** Catalogue key for the light at this altitude */
function daylight(altitude: number): string {
	if (altitude > -0.833) return 'celestial.state.daylight';
	if (altitude > -6) return 'celestial.state.civil';
	if (altitude > -12) return 'celestial.state.nautical';
	if (altitude > -18) return 'celestial.state.astronomical';
	return 'celestial.state.night';
}
