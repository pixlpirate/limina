import { LightSource } from './settings.interface';

/**
 * The moment a celestial body rises or sets.
 *
 * Against the mountains where there are mountains in the way, and against the
 * true horizon where the ground falls away and never meets the track — over the
 * sea, off the edge of a plateau, or simply past the far edge of the terrain the
 * app has loaded. Both are worth knowing and they are not the same fact, so
 * which one this is travels with it.
 */
export interface SkyEvent {
	body: LightSource;
	kind: 'rise' | 'set';
	time: Date;
	/** What marked the moment */
	source: 'skyline' | 'horizon';
	/** Where on the skyline, in degrees from north */
	azimuth: number;
	/** Elevation angle of that crossing, in degrees */
	altitude: number;
}
