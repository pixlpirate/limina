/** Viewer orientation and eye position, relative to the current viewpoint. */
export interface CameraPose {
	/** Degrees clockwise from north. */
	yaw: number;
	/** Degrees above the horizon, negative looks down. */
	pitch: number;
	/** Vertical field of view, in degrees. */
	fov: number;
	/** Eye altitude above sea level, in metres. */
	altitude: number;
}

/** A peak projected onto the canvas, in CSS pixels. */
export interface ProjectedPoint {
	x: number;
	y: number;
	/** Distance from the eye, in metres. */
	depth: number;
}
