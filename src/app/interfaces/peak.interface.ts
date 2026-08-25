import { LatLon } from './geo.interface';

/** What a named feature is. */
export type PeakKind = 'peak' | 'volcano' | 'mountain_range' | 'ridge' | 'hill' | 'region';

/** True for anything that covers ground rather than standing at a point. */
export function isLandform(kind: PeakKind): boolean {
	return kind !== 'peak' && kind !== 'volcano';
}

/** A summit as returned by Overpass, enriched with viewer-relative geometry. */
export interface Peak extends LatLon {
	id: string;
	name: string;
	kind: PeakKind;
	/** Metres above sea level. */
	elevation: number;
	/** Great-circle distance from the viewpoint, in metres. */
	distance: number;
	/** Compass bearing from the viewpoint, in degrees clockwise from north. */
	bearing: number;
	/** Local ENU position relative to the viewer, in metres. */
	east: number;
	north: number;
	up: number;
	/** False when the terrain between the viewer and the summit occludes it. */
	visible: boolean;
}
