import { LatLon } from '@interfaces';

export const EARTH_RADIUS = 6_371_008.8;

/**
 * Effective radius used for the horizon drop. The 7/6 factor is the standard
 * approximation of atmospheric refraction bending light back towards the ground.
 */
export const REFRACTED_EARTH_RADIUS = (EARTH_RADIUS * 7) / 6;

export const METRES_PER_DEGREE_LAT = 111_320;

export const DEG = Math.PI / 180;

export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

export function metresPerDegreeLon(lat: number): number {
	return METRES_PER_DEGREE_LAT * Math.cos(lat * DEG);
}

/** Amount the terrain falls away below the tangent plane at a given range. */
export function curvatureDrop(distance: number): number {
	return (distance * distance) / (2 * REFRACTED_EARTH_RADIUS);
}

/* Web mercator, normalised to the 0..1 range
------------------------------------------------- */

export function lonToMercatorX(lon: number): number {
	return (lon + 180) / 360;
}

export function latToMercatorY(lat: number): number {
	const sin = Math.sin(clamp(lat, -85.051129, 85.051129) * DEG);
	return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
}

export function mercatorXToLon(x: number): number {
	return x * 360 - 180;
}

export function mercatorYToLat(y: number): number {
	return (2 * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - Math.PI / 2) / DEG;
}

/* Viewer-local ENU frame
------------------------------------------------- */

/** Offset of a position from the origin, in metres east/north. */
export function toLocal(origin: LatLon, point: LatLon): { east: number; north: number } {
	return {
		east: (point.lon - origin.lon) * metresPerDegreeLon(origin.lat),
		north: (point.lat - origin.lat) * METRES_PER_DEGREE_LAT,
	};
}

export function fromLocal(origin: LatLon, east: number, north: number): LatLon {
	return {
		lat: origin.lat + north / METRES_PER_DEGREE_LAT,
		lon: origin.lon + east / metresPerDegreeLon(origin.lat),
	};
}

export function distanceBetween(a: LatLon, b: LatLon): number {
	const { east, north } = toLocal(a, b);
	return Math.hypot(east, north);
}

/** Compass bearing from `a` to `b`, in degrees clockwise from north. */
export function bearingBetween(a: LatLon, b: LatLon): number {
	const { east, north } = toLocal(a, b);
	return (Math.atan2(east, north) / DEG + 360) % 360;
}

/* Coordinate formatting
------------------------------------------------- */

export function isValidLat(lat: number): boolean {
	return Number.isFinite(lat) && Math.abs(lat) <= 90;
}

export function isValidLon(lon: number): boolean {
	return Number.isFinite(lon) && Math.abs(lon) <= 180;
}
