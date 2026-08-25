import { LatLon } from './geo.interface';

/**
 * A place the viewer marked from where they were standing. Kept on the device
 * only — there is no account to sync it to and nowhere to send it.
 */
export interface Bookmark extends LatLon {
	id: string;
	name: string;
	/** Eye altitude when it was marked, in metres above sea level. */
	altitude: number;
	/** Milliseconds since the epoch, so the list can stay in the order made. */
	created: number;
}

/** A bookmark worked out against the current viewpoint, ready to be drawn. */
export interface PlacedBookmark extends Bookmark {
	/** Great-circle distance from the viewpoint, in metres. */
	distance: number;
	/** Compass bearing from the viewpoint, in degrees clockwise from north. */
	bearing: number;
	/** Local ENU position relative to the viewer, in metres. */
	east: number;
	north: number;
	up: number;
	/** False when the terrain between the viewer and the mark occludes it. */
	visible: boolean;
}
