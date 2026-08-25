/** Terrain pass */

/** Sampling helpers shared by both stages */
const SAMPLING = /* glsl */ `
uniform sampler2D uRingNear;
uniform sampler2D uRingMid;
uniform sampler2D uRingFar;
uniform vec4 uBoundsNear;
uniform vec4 uBoundsMid;
uniform vec4 uBoundsFar;
/** Outer radius of the near and mid rasters */
uniform vec2 uRingRadius;
/** Where a ring gives way to the next */
uniform float uRingBlend;

/** Metres per texel of each raster */
uniform vec3 uTexelMetres;
/**
 * x: metres out to which the height lookup is softened, zero to leave it alone.
 * y: width of that softening, in texels of the finest raster.
 */
uniform vec2 uSmoothing;

uniform vec2 uOrigin;
uniform vec2 uMetresPerDegree;

const float PI = 3.141592653589793;

vec2 localToUv(vec2 en, vec4 bounds) {
	float lon = uOrigin.x + en.x / uMetresPerDegree.x;
	float lat = uOrigin.y + en.y / uMetresPerDegree.y;
	float x = (lon + 180.0) / 360.0;
	float s = sin(radians(clamp(lat, -85.05, 85.05)));
	float y = 0.5 - log((1.0 + s) / (1.0 - s)) / (4.0 * PI);
	return (vec2(x, y) - bounds.xy) / (bounds.zw - bounds.xy);
}

float readRing(sampler2D ring, vec4 bounds, vec2 en) {
	return texture(ring, clamp(localToUv(en, bounds), 0.0, 1.0)).r;
}

/** Four taps on the diagonals */
float softRing(sampler2D ring, vec4 bounds, vec2 en, float spread) {
	return 0.25 * (
		readRing(ring, bounds, en + vec2(spread, spread))
		+ readRing(ring, bounds, en + vec2(spread, -spread))
		+ readRing(ring, bounds, en + vec2(-spread, spread))
		+ readRing(ring, bounds, en + vec2(-spread, -spread))
	);
}

/**
 * Height at a local offset, taking the finest raster that still covers it and
 * fading into the next so no seam shows.
 */
float altitudeAt(vec2 en, float radius) {
	float height = readRing(uRingFar, uBoundsFar, en);

	if (uRingRadius.y > 0.0 && radius < uRingRadius.y) {
		float mid = readRing(uRingMid, uBoundsMid, en);
		height = mix(mid, height, smoothstep(uRingRadius.y * uRingBlend, uRingRadius.y, radius));
	}
	if (uRingRadius.x > 0.0 && radius < uRingRadius.x) {
		float near = readRing(uRingNear, uBoundsNear, en);
		height = mix(near, height, smoothstep(uRingRadius.x * uRingBlend, uRingRadius.x, radius));
	}

	if (uSmoothing.x > 0.0 && radius < uSmoothing.x) {
		float amount = 1.0 - smoothstep(0.0, uSmoothing.x, radius);
		float spread = uTexelMetres.x * uSmoothing.y;
		height = mix(height, softRing(uRingNear, uBoundsNear, en, spread), amount);
	}
	return height;
}
`;

export const TERRAIN_VERTEX = /* glsl */ `#version 300 es
precision highp float;

/** Angle around the viewer, 0..1 for a full turn */
in float aAngle;
/** Radius of this vertex' ring, in metres */
in float aRadius;

uniform mat4 uViewProjection;
uniform float uEyeAltitude;

${SAMPLING}

/** Earth radius inflated for refraction */
const float EARTH_RADIUS = 7435843.6;

out vec3 vToEye;
out vec2 vLocal;
out float vRadius;

void main() {
	float angle = aAngle * 2.0 * PI;
	vec2 en = vec2(sin(angle), cos(angle)) * aRadius;

	float drop = (aRadius * aRadius) / (2.0 * EARTH_RADIUS);
	vec3 position = vec3(en, altitudeAt(en, aRadius) - uEyeAltitude - drop);

	vToEye = -position;
	vLocal = en;
	vRadius = aRadius;

	gl_Position = uViewProjection * vec4(position, 1.0);
}
`;

export const TERRAIN_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec3 vToEye;
in vec2 vLocal;
in float vRadius;

uniform vec3 uGroundColour;
/** Radians per screen pixel */
uniform float uPixelAngle;
/**
 * How far out the ground has been revealed, in metres. A radius past the whole
 * view means everything is showing.
 */
uniform float uReveal;
/** Metres over which the wash falls away */
uniform float uTrail;

${SAMPLING}

layout(location = 0) out vec4 oColour;
layout(location = 1) out vec4 oSurface;

/** Sample spacing of the raster carrying this fragment */
float texelFor(float radius) {
	if (uRingRadius.x > 0.0 && radius < uRingRadius.x) {
		return uTexelMetres.x;
	}
	if (uRingRadius.y > 0.0 && radius < uRingRadius.y) {
		return uTexelMetres.y;
	}
	return uTexelMetres.z;
}

void main() {
	float distance = length(vToEye);

	float step = max(texelFor(vRadius), distance * uPixelAngle);

	float h = altitudeAt(vLocal, vRadius);
	float hE = altitudeAt(vLocal + vec2(step, 0.0), vRadius);
	float hW = altitudeAt(vLocal - vec2(step, 0.0), vRadius);
	float hN = altitudeAt(vLocal + vec2(0.0, step), vRadius);
	float hS = altitudeAt(vLocal - vec2(0.0, step), vRadius);

	vec2 slope = vec2(-(hE - hW), -(hN - hS)) / (2.0 * step);

	vec3 normal = normalize(vec3(slope, 1.0));

	float roughness = clamp(abs(hE + hW + hN + hS - 4.0 * h) / step, 0.0, 1.0);

	// A clean cut, not a fade: the composite reads anything beyond it as sky, so
	// the edge picks up the same outline a skyline gets. Alpha is spare here and
	// the composite is its only reader — nothing means unrevealed, anything above
	// a half means ground, and how far above says how long ago the edge passed.
	float settled = clamp((uReveal - vRadius) / max(uTrail, 1.0), 0.0, 1.0);
	float revealed = vRadius <= uReveal ? mix(0.6, 1.0, settled) : 0.0;

	// Flat: the shading is put on in the composite, after the lines, so the ground
	// and the drawing over it take the light together.
	oColour = vec4(uGroundColour, revealed);
	oSurface = vec4(normal * 0.5 + 0.5, roughness);
}
`;
