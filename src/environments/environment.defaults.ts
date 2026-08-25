/**
 * Shared between every build configuration. `environment.ts` (and its
 * per-configuration replacements) layer their overrides on top of this.
 */
export const defaults = {
	/** Shown on the info screen, and what a changelog entry is filed under */
	version: '1.0.0',
	/** Terrarium DEM tiles, public and key-less */
	demTileUrl: 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp',
	demTileSize: 512,
	demAttribution: '© Mapterhorn',
	/** Elevation raster size, in texels per side */
	demTexelBudget: 2560,
	/**
	 * How much the ground is smoothed where a raster is finer than the tiles
	 * behind it, which is most places. One interpolates fully; nought keeps each
	 * source texel whole, which is truer to the data and looks like steps.
	 */
	demSmoothing: 1,
	/**
	 * Coverage thins out well before this in flat country — the Sahara stops at z12 — so missing
	 * tiles are filled from their parent rather than trusted to exist.
	 */
	demMaxZoom: 17,
	/**
	 * Raster basemap for the 2D picker, in two halves. The relief is drawn between
	 * them, so the place names stay legible rather than being shaded over.
	 */
	basemapTileUrl: 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
	basemapLabelsUrl: 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png',
	basemapAttribution: '© OpenStreetMap contributors © CARTO',
	/**
	 * Summit API, backed by the imported OSM database — see server/README.md.
	 * Relative on purpose: it is published alongside the app, so a build dropped
	 * in any folder on any host finds it without being told where.
	 */
	peaksApiUrl: 'api/peaks.php',
	/** Civil timezone at a point */
	timezoneApiUrl: 'api/timezone.php',
	nominatimUrl: 'https://nominatim.openstreetmap.org/search',
};
