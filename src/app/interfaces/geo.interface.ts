/** A WGS84 position, in decimal degrees */
export interface LatLon {
	lat: number;
	lon: number;
}

/** How the viewpoint was acquired */
export type ViewpointOrigin =
	'default' | 'gps' | 'map' | 'search' | 'coordinates' | 'bookmark' | 'summit';

/** Normalised web-mercator bounds, 0..1 */
export interface MercatorBounds {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

/** A place returned by the Nominatim search API */
export interface Place extends LatLon {
	id: string;
	name: string;
}
