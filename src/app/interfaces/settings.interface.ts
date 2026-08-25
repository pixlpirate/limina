export type Units = 'metric' | 'imperial';

/**
 * The languages the app is translated into. The tag is what names the catalogue
 * in `public/i18n`, so the two lists have to stay in step.
 */
export const LANGUAGES = ['en', 'fr', 'es', 'it', 'de', 'pt', 'el', 'sv', 'nl'] as const;

export type Language = (typeof LANGUAGES)[number];

/** A flag to put beside each language in the picker. */
export const LANGUAGE_FLAGS: Record<Language, string> = {
	en: '\u{1F1EC}\u{1F1E7}',
	fr: '\u{1F1EB}\u{1F1F7}',
	es: '\u{1F1EA}\u{1F1F8}',
	it: '\u{1F1EE}\u{1F1F9}',
	de: '\u{1F1E9}\u{1F1EA}',
	pt: '\u{1F1F5}\u{1F1F9}',
	el: '\u{1F1EC}\u{1F1F7}',
	sv: '\u{1F1F8}\u{1F1EA}',
	nl: '\u{1F1F3}\u{1F1F1}',
};

/**
 * What each language calls itself. A picker written in the language you already
 * read is no use to someone looking for the one they do.
 */
export const LANGUAGE_NAMES: Record<Language, string> = {
	en: 'English',
	fr: 'Français',
	es: 'Español',
	it: 'Italiano',
	de: 'Deutsch',
	pt: 'Português',
	el: 'Ελληνικά',
	sv: 'Svenska',
	nl: 'Nederlands',
};

/** A celestial body the app can draw, with its disc and its track. */
export type LightSource = 'sun' | 'moon';

export type LabelSize = 'small' | 'medium' | 'large';

export interface UserSettings {
	units: Units;
	labelSize: LabelSize;
	/** Both are drawn at once; these only take one back off the sky. */
	showSun: boolean;
	showMoon: boolean;
	/** Print each summit's height beside its name. */
	showPeakElevation: boolean;
	/** Name the massifs and ranges too, not only the summits. */
	showRanges: boolean;
	/** Trace the galactic equator across the sky. */
	showMilkyWay: boolean;
	/** How far the landscape is drawn, in metres. */
	visibility: number;
	/** Line weight, in device pixels */
	outlineWidth: number;
	/** Which catalogue the interface is read from. */
	language: Language;
}
