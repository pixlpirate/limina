import { effect, Injectable, signal } from '@angular/core';
import { LabelSize, Language, LANGUAGES, LightSource, Units, UserSettings } from '@interfaces';

const STORAGE_KEY = 'limina.settings';

/** How far the landscape is drawn */
export const VISIBILITY_OPTIONS = [10_000, 25_000, 50_000, 75_000, 100_000];

const DEFAULTS: UserSettings = {
	units: 'metric',
	language: 'en',
	labelSize: 'medium',
	visibility: 50_000,
	outlineWidth: 1,
	showSun: true,
	showMoon: true,
	showPeakElevation: true,
	showRanges: true,
	showMilkyWay: true,
};

/** User preferences, mirrored to local storage */
@Injectable({ providedIn: 'root' })
export class SettingsService {
	private readonly stored = restore();

	readonly units = signal<Units>(this.stored.units);
	readonly showSun = signal<boolean>(this.stored.showSun);
	readonly showMoon = signal<boolean>(this.stored.showMoon);
	readonly showPeakElevation = signal<boolean>(this.stored.showPeakElevation);
	readonly showRanges = signal<boolean>(this.stored.showRanges);
	readonly showMilkyWay = signal<boolean>(this.stored.showMilkyWay);
	readonly labelSize = signal<LabelSize>(this.stored.labelSize);
	readonly visibility = signal<number>(this.stored.visibility);
	readonly outlineWidth = signal<number>(this.stored.outlineWidth);
	readonly language = signal<Language>(this.stored.language);

	constructor() {
		effect(() => {
			const settings: UserSettings = {
				units: this.units(),
				showSun: this.showSun(),
				showMoon: this.showMoon(),
				showPeakElevation: this.showPeakElevation(),
				showRanges: this.showRanges(),
				showMilkyWay: this.showMilkyWay(),
				labelSize: this.labelSize(),
				visibility: this.visibility(),
				outlineWidth: this.outlineWidth(),
				language: this.language(),
			};
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
			} catch {}
		});
	}

	toggle(body: LightSource): void {
		const flag = body === 'sun' ? this.showSun : this.showMoon;
		flag.update((shown) => !shown);
	}
}

function restore(): UserSettings {
	const defaults: UserSettings = { ...DEFAULTS, language: preferredLanguage() };
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<UserSettings>) } : defaults;
	} catch {
		return defaults;
	}
}

/** The first browser language we translate into */
function preferredLanguage(): Language {
	const wanted = globalThis.navigator?.languages ?? [globalThis.navigator?.language ?? ''];
	for (const tag of wanted) {
		const base = tag.toLowerCase().split('-')[0] as Language;
		if (LANGUAGES.includes(base)) {
			return base;
		}
	}
	return DEFAULTS.language;
}
