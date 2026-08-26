import { Vec3 } from '@utils';

/**
 * The whole look of the landscape, deliberately kept to the few things that actually draw it:
 * the ground, the sky, the fresnel rim that gives ridges their volume, the outlines that trace
 * them, and the two celestial bodies.
 */
export interface RenderStyle {
	groundColour: Vec3;
	skyColour: Vec3;

	fresnelColour: Vec3;
	fresnelPower: number;
	fresnelStrength: number;

	/** Exaggeration applied to the shading normal */
	normalStrength: number;

	/**
	 * Distance out to which the height lookup is softened, in metres, and the width of that
	 * softening in texels of the finest raster.
	 */
	smoothingRadius: number;
	smoothingTexels: number;

	outlineColour: Vec3;
	outlineStrength: number;
	/** Edge sampling distance, in device pixels */
	outlineWidth: number;
	/**
	 * Multiplier on that while the camera shows through. Lines there are drawn as
	 * coverage rather than as paint on dark ground, so the same width reads
	 * thinner against a bright picture.
	 */
	passthroughOutline: number;
	/** The skyline where terrain meets sky */
	silhouetteColour: Vec3;
	silhouetteStrength: number;
	/** Line strength on smooth ground, rising with roughness */
	roughnessFloor: number;
	/** Wash behind the opening edge, and its strength */
	trailColour: Vec3;
	trailStrength: number;
	/** How quickly the wash gives way behind the edge */
	trailPower: number;

	sunColour: Vec3;
	moonColour: Vec3;
	/** Angular radius of a disc, in degrees */
	discRadius: number;
	/** How quickly the sky fades */
	skyFadePower: number;
	/** Track colours across the sky */
	sunPathColour: Vec3;
	moonPathColour: Vec3;
	/** The galactic equator, when it is switched on */
	milkyWayPathColour: Vec3;
	/** The same over the camera picture, where a dark grey would not show */
	milkyWayPassthroughColour: Vec3;
	/** Thickness of the outlines, in screen pixels */
	milkyWayWidth: number;
	/** Thickness of the track, in screen pixels */
	pathWidth: number;
}

const GROUND: Vec3 = [0.05, 0.05, 0.05];
const SKY: Vec3 = [0.075, 0.075, 0.075];
const SUN_COLOUR: Vec3 = [1.0, 0.792, 0.513];
const MOON_COLOUR: Vec3 = [0.631, 0.858, 1.0];

export const RENDER_STYLE: RenderStyle = {
	groundColour: GROUND,
	skyColour: SKY,

	fresnelColour: [0.5, 0.5, 0.5],
	fresnelPower: 5,
	fresnelStrength: 0.1,

	normalStrength: 1.0,

	smoothingRadius: 300,
	smoothingTexels: 1,

	outlineColour: [1, 1, 1],
	outlineStrength: 0.5,
	outlineWidth: 1,
	passthroughOutline: 1.5,
	silhouetteColour: [1, 1, 1],
	silhouetteStrength: 1,
	roughnessFloor: 0.05,
	trailColour: [1, 1, 1],
	trailStrength: 0.85,
	trailPower: 1.6,

	sunColour: SUN_COLOUR,
	moonColour: MOON_COLOUR,
	discRadius: 0.5,
	skyFadePower: 3,
	sunPathColour: SUN_COLOUR,
	moonPathColour: MOON_COLOUR,
	pathWidth: 5,

	milkyWayPathColour: [0.15, 0.15, 0.15],
	milkyWayPassthroughColour: [1, 1, 1],
	milkyWayWidth: 3,
};
