import { LatLon, MercatorBounds } from '@interfaces';
import {
	clamp,
	curvatureDrop,
	DEG,
	latToMercatorY,
	lonToMercatorX,
	METRES_PER_DEGREE_LAT,
	metresPerDegreeLon,
} from '@utils';

/** Metres per unit of normalised mercator at the equator */
const MERCATOR_CIRCUMFERENCE = 40_075_016.686;

/** A place on the ground, in the viewer's frame */
export interface SurfacePoint {
	east: number;
	north: number;
	up: number;
	distance: number;
}

/** Texels ignored at each end of a sight line */
const OBSERVER_SKIRT = 3;

/** A decoded elevation raster around a viewpoint */
export class HeightField {
	constructor(
		readonly origin: LatLon,
		readonly bounds: MercatorBounds,
		readonly width: number,
		readonly height: number,
		readonly data: Float32Array,
		/** Radius this raster covers, in metres */
		readonly radius = 0,
	) {}

	/** Ground resolution of one texel, in metres */
	get resolution(): number {
		const span = (this.bounds.x1 - this.bounds.x0) / this.width;
		return span * MERCATOR_CIRCUMFERENCE * Math.cos(this.origin.lat * DEG);
	}

	/** Bilinear elevation, in metres above sea level */
	elevationAt(lat: number, lon: number): number {
		const u = (lonToMercatorX(lon) - this.bounds.x0) / (this.bounds.x1 - this.bounds.x0);
		const v = (latToMercatorY(lat) - this.bounds.y0) / (this.bounds.y1 - this.bounds.y0);

		const x = clamp(u * this.width - 0.5, 0, this.width - 1);
		const y = clamp(v * this.height - 0.5, 0, this.height - 1);
		const x0 = Math.floor(x);
		const y0 = Math.floor(y);
		const x1 = Math.min(x0 + 1, this.width - 1);
		const y1 = Math.min(y0 + 1, this.height - 1);
		const fx = x - x0;
		const fy = y - y0;

		const top = this.texel(x0, y0) * (1 - fx) + this.texel(x1, y0) * fx;
		const bottom = this.texel(x0, y1) * (1 - fx) + this.texel(x1, y1) * fx;
		return top * (1 - fy) + bottom * fy;
	}

	/** Elevation at an ENU offset, in metres */
	elevationAtLocal(east: number, north: number): number {
		return this.elevationAt(
			this.origin.lat + north / METRES_PER_DEGREE_LAT,
			this.origin.lon + east / metresPerDegreeLon(this.origin.lat),
		);
	}

	/** Highest ground within `radius` of the origin */
	highestWithin(radius: number, samples = 16): number {
		let peak = this.elevationAtLocal(0, 0);

		for (let i = 0; i < samples; i++) {
			const angle = (i / samples) * 2 * Math.PI;
			const east = Math.sin(angle);
			const north = Math.cos(angle);
			for (const fraction of [0.33, 0.66, 1]) {
				const distance = radius * fraction;
				peak = Math.max(peak, this.elevationAtLocal(east * distance, north * distance));
			}
		}
		return peak;
	}

	/**
	 * Walks the ground between the eye and a target, returning `false` as soon as
	 * the terrain rises above the sight line. Both endpoints are ENU metres.
	 */
	hasLineOfSight(
		eyeAltitude: number,
		target: { east: number; north: number; up: number },
	): boolean {
		return hasLineOfSightAcross([this], eyeAltitude, target);
	}

	/** Where a line of sight first meets the ground */
	firstHit(
		eyeAltitude: number,
		direction: { east: number; north: number; up: number },
		range: number,
	): SurfacePoint | null {
		return firstHitAcross([this], eyeAltitude, direction, range);
	}

	/**
	 * Elevation angle of the skyline, in degrees, for each of `bins` azimuths running clockwise
	 * from north.
	 */
	horizonProfile(eyeAltitude: number, range: number, bins = 720): Float32Array {
		const profile = new Float32Array(bins);
		const start = OBSERVER_SKIRT * this.resolution;

		for (let bin = 0; bin < bins; bin++) {
			const azimuth = (bin / bins) * 2 * Math.PI;
			const east = Math.sin(azimuth);
			const north = Math.cos(azimuth);
			let highest = -90;

			for (
				let distance = start;
				distance < range;
				distance += Math.max(this.resolution, distance * 0.02)
			) {
				const ground =
					this.elevationAtLocal(east * distance, north * distance) -
					curvatureDrop(distance);
				const angle = Math.atan2(ground - eyeAltitude, distance) / DEG;
				if (angle > highest) {
					highest = angle;
				}
			}
			profile[bin] = highest;
		}
		return profile;
	}

	private texel(x: number, y: number): number {
		return this.data[y * this.width + x];
	}
}

/**
 * Where a ray from the viewer first meets the ground, marched across nested
 * rasters innermost first.
 *
 * Each sample comes from the finest raster still covering it, and the march
 * stops at the outermost edge. Reading a five-kilometre raster at forty
 * kilometres clamps to whatever sits on its boundary, so the ray strikes a
 * phantom wall and reports a point in plain view as tens of kilometres away.
 */
export function firstHitAcross(
	rings: HeightField[],
	eyeAltitude: number,
	direction: { east: number; north: number; up: number },
	range: number,
): SurfacePoint | null {
	const outer = rings[rings.length - 1];
	const horizontal = Math.hypot(direction.east, direction.north);
	if (!outer || horizontal <= 0) {
		return null;
	}

	const east = direction.east / horizontal;
	const north = direction.north / horizontal;
	const climb = direction.up / horizontal;

	const fieldAt = (distance: number) =>
		rings.find((ring) => ring.radius > 0 && distance < ring.radius) ?? outer;
	const groundAt = (distance: number) =>
		fieldAt(distance).elevationAtLocal(east * distance, north * distance);

	const limit = outer.radius > 0 ? Math.min(range, outer.radius) : range;

	let previous = 0;
	let previousGap = eyeAltitude - groundAt(0);

	for (let distance = rings[0].resolution; distance < limit;) {
		const field = fieldAt(distance);
		const ground = field.elevationAtLocal(east * distance, north * distance);
		const ray = eyeAltitude + climb * distance - curvatureDrop(distance);
		const gap = ray - ground;

		if (gap <= 0) {
			const span = previousGap - gap;
			const t = span === 0 ? 0 : previousGap / span;
			const hit = previous + (distance - previous) * t;
			return {
				east: east * hit,
				north: north * hit,
				up: groundAt(hit),
				distance: hit,
			};
		}

		previous = distance;
		previousGap = gap;
		distance += Math.max(field.resolution, distance * 0.01);
	}
	return null;
}

/**
 * Whether a target can be seen from the viewpoint, marched across nested
 * rasters innermost first.
 *
 * The ground that hides things is mostly the ground you are standing on, and
 * that is the ground the outermost raster describes worst: at fifty kilometres
 * a texel spans forty metres, which rounds a summit into a hill and lets every
 * peak behind it through. The fine ring holds the same slope at a few metres,
 * so the near part of the sight line is walked against that instead.
 *
 * The step follows the raster carrying it, growing with distance once past the
 * close ground — fine where the occlusion happens, no finer than the data is
 * out where it does not.
 */
export function hasLineOfSightAcross(
	rings: HeightField[],
	eyeAltitude: number,
	target: { east: number; north: number; up: number },
): boolean {
	const outer = rings[rings.length - 1];
	const range = Math.hypot(target.east, target.north);
	if (!outer || range < rings[0].resolution) {
		return true;
	}

	const fieldAt = (distance: number) =>
		rings.find((ring) => ring.radius > 0 && distance < ring.radius) ?? outer;

	const apparentTarget = target.up - curvatureDrop(range);

	// Texels ignored at each end, measured against whichever raster covers that
	// end: the observer's own summit at one, the target's at the other.
	const start = OBSERVER_SKIRT * rings[0].resolution;
	const end = range - OBSERVER_SKIRT * fieldAt(range).resolution;
	if (start >= end) {
		return true;
	}

	for (let distance = start; distance < end;) {
		const field = fieldAt(distance);
		const t = distance / range;
		const sightLine = eyeAltitude + (apparentTarget - eyeAltitude) * t;
		const ground =
			field.elevationAtLocal(target.east * t, target.north * t) - curvatureDrop(distance);

		if (ground > sightLine + 1) {
			return false;
		}
		// Full raster detail over the close ground, where the ridge you are
		// standing on does the hiding, then opening out with distance. Sampling
		// the whole line at the near ring's spacing costs five times as much and
		// changes nothing past the first few hundred metres.
		distance += Math.max(field.resolution, distance * 0.01);
	}
	return true;
}

/** Azimuth bins in a horizon mask */
const MASK_BINS = 720;

/**
 * The skyline from one spot: how high the ground has risen, by direction and by
 * how far out you have looked.
 *
 * Testing each summit on its own walks the same near ground thousands of times
 * over, and the near ground is what does nearly all the hiding — so nearly all
 * of that work is repeated. Walking it once per direction instead answers most
 * summits with a lookup.
 *
 * Each bin holds the greatest angle found in it *or in either neighbour*. That
 * over-states the skyline, which is what makes it safe to trust in one
 * direction only: a summit standing above it is above the ground along every
 * bearing the bin could stand for, so it is genuinely in view. A summit below
 * it has settled nothing and is walked properly.
 */
export interface HorizonMask {
	bins: number;
	/** Distance ladder shared by every bin, in metres */
	steps: Float32Array;
	/**
	 * `bins × steps`: the highest angle reached by that distance, in degrees,
	 * taken at its greatest across the bin and its two neighbours. Standing above
	 * this is standing above the ground along every bearing the bin covers.
	 */
	angles: Float32Array;
	/** The same at its least: below this is behind it */
	floors: Float32Array;
	/** How far the mask was built to, in metres */
	range: number;
}

/** Builds the skyline for a viewpoint */
export function buildHorizonMask(
	rings: HeightField[],
	eyeAltitude: number,
	range: number,
	bins = MASK_BINS,
): HorizonMask | null {
	const outer = rings[rings.length - 1];
	if (!outer) {
		return null;
	}

	const fieldAt = (distance: number) =>
		rings.find((ring) => ring.radius > 0 && distance < ring.radius) ?? outer;

	const limit = outer.radius > 0 ? Math.min(range, outer.radius) : range;
	const ladder: number[] = [];
	for (
		let distance = OBSERVER_SKIRT * rings[0].resolution;
		distance < limit;
		distance += Math.max(fieldAt(distance).resolution, distance * 0.01)
	) {
		ladder.push(distance);
	}

	const steps = new Float32Array(ladder);
	const count = steps.length;
	const raw = new Float32Array(bins * count);

	for (let bin = 0; bin < bins; bin++) {
		const azimuth = (bin * 360) / bins;
		const east = Math.sin(azimuth * DEG);
		const north = Math.cos(azimuth * DEG);
		let highest = -90;

		for (let i = 0; i < count; i++) {
			const distance = steps[i];
			const ground =
				fieldAt(distance).elevationAtLocal(east * distance, north * distance) -
				curvatureDrop(distance);
			const angle = Math.atan2(ground - eyeAltitude, distance) / DEG;
			if (angle > highest) {
				highest = angle;
			}
			raw[bin * count + i] = highest;
		}
	}

	// Widened across neighbouring directions, so that clearing the skyline means
	// clearing it for every bearing the bin stands for and not just its centre.
	const angles = new Float32Array(bins * count);
	const floors = new Float32Array(bins * count);
	for (let bin = 0; bin < bins; bin++) {
		const before = (bin - 1 + bins) % bins;
		const after = (bin + 1) % bins;
		for (let i = 0; i < count; i++) {
			const a = raw[before * count + i];
			const b = raw[bin * count + i];
			const c = raw[after * count + i];
			angles[bin * count + i] = Math.max(a, b, c);
			floors[bin * count + i] = Math.min(a, b, c);
		}
	}

	return { bins, steps, angles, floors, range: limit };
}

/**
 * What the skyline can settle about a target on its own.
 *
 * `unsure` means the answer lies between the highest and the lowest the ground
 * reaches across the directions this bin stands for, so the sight line has to be
 * walked properly. The other two answers are certain.
 */
export type MaskVerdict = 'visible' | 'hidden' | 'unsure';

export function maskVerdict(
	mask: HorizonMask,
	bearing: number,
	distance: number,
	angle: number,
): MaskVerdict {
	const count = mask.steps.length;
	if (count === 0 || distance <= mask.steps[0]) {
		return 'visible';
	}

	const bin = ((Math.round((bearing / 360) * mask.bins) % mask.bins) + mask.bins) % mask.bins;

	// The last rung the eye passes before reaching the target.
	let low = 0;
	let high = count - 1;
	while (low < high) {
		const middle = (low + high + 1) >> 1;
		if (mask.steps[middle] < distance) {
			low = middle;
		} else {
			high = middle - 1;
		}
	}

	if (angle > mask.angles[bin * count + low]) {
		return 'visible';
	}
	if (angle < mask.floors[bin * count + low]) {
		return 'hidden';
	}
	return 'unsure';
}
