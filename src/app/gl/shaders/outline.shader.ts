/** Composite pass */

export const OUTLINE_VERTEX = /* glsl */ `#version 300 es
precision highp float;

in vec2 aPosition;
out vec2 vUv;

void main() {
	vUv = aPosition * 0.5 + 0.5;
	gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const OUTLINE_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uColour;
uniform sampler2D uSurface;
uniform sampler2D uDepth;
uniform mat4 uInverseViewProjection;
/** Reversed depth: (far, near) */
uniform vec2 uClipRange;
uniform vec3 uSkyColour;
uniform vec3 uOutlineColour;
uniform float uOutlineStrength;
/** Edge sampling distance, in texels */
uniform vec2 uOutlineStep;
uniform vec3 uSilhouetteColour;
uniform float uSilhouetteStrength;
uniform float uRoughnessFloor;
uniform vec3 uFresnelColour;
uniform float uFresnelPower;
uniform float uFresnelStrength;
uniform float uNormalStrength;
uniform vec3 uSunDirection;
uniform vec3 uSunColour;
/** Disc radius and antialiasing width, in radians */
uniform vec2 uSunDisc;
uniform vec3 uMoonDirection;
uniform vec3 uMoonColour;
uniform vec2 uMoonDisc;
/** One output pixel, in uv */
uniform vec2 uPixelSize;
/** How far the overlays have arrived */
uniform float uBodyFade;
/** Wash behind the opening edge, and its strength */
uniform vec3 uTrailColour;
uniform float uTrailStrength;
/** Falloff shape of that wash */
uniform float uTrailPower;
/** One while the camera shows through */
uniform float uPassthrough;

out vec4 oColour;

float linearise(float depth) {
	float ndc = depth * 2.0 - 1.0;
	return (2.0 * uClipRange.x * uClipRange.y)
		/ (uClipRange.y + uClipRange.x - ndc * (uClipRange.y - uClipRange.x));
}

/**
 * What is at a pixel, read from the surface buffer's z rather than from depth.
 *
 * Depth cannot answer this: reversed depth clears to zero and geometry at the
 * far plane lands barely a millionth above it, which phones round away — taking
 * every distant ridge and the whole sun and moon track with it. The surface
 * buffer has three plain bands instead: cleared for sky, a quarter for a track,
 * and at least a half for ground, whose normals always face somewhat upwards.
 */
bool isSky(vec4 surface) {
	return surface.z < 0.125;
}

/**
 * True where a track was drawn rather than ground. Such pixels are passed
 * through rather than outlined like a ridge.
 */
bool isOverlay(vec4 surface) {
	return surface.z < 0.4;
}

/**
 * Ground that is both there and revealed. Ground still waiting counts as sky, so
 * the edge detection below outlines the leading edge like any other skyline.
 */
bool isGround(vec2 uv) {
	return !isOverlay(texture(uSurface, uv)) && texture(uColour, uv).a > 0.5;
}

/** View ray through a pixel, from the eye */
vec3 rayThrough(vec2 uv) {
	vec4 far = uInverseViewProjection * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
	return normalize(far.xyz / far.w);
}

/**
 * Coverage of one disc at this pixel, 0..1. A plain disc, no halo: the only
 * softening is a pixel-wide edge so the circle does not come out jagged.
 */
float discMask(vec3 ray, vec3 direction, vec2 disc) {
	if (disc.x <= 0.0) {
		return 0.0;
	}
	float angle = acos(clamp(dot(ray, direction), -1.0, 1.0));
	return 1.0 - smoothstep(disc.x - disc.y, disc.x + disc.y, angle);
}

/** How much of a pixel a disc covers */
float discCoverage(vec2 uv) {
	vec3 ray = rayThrough(uv);
	return max(
		discMask(ray, uSunDirection, uSunDisc) * uBodyFade,
		discMask(ray, uMoonDirection, uMoonDisc) * uBodyFade
	);
}

/** Paints whichever discs are showing */
vec3 withBodies(vec3 colour, vec2 uv) {
	vec3 ray = rayThrough(uv);
	colour = mix(colour, uSunColour, discMask(ray, uSunDirection, uSunDisc) * uBodyFade);
	colour = mix(colour, uMoonColour, discMask(ray, uMoonDirection, uMoonDisc) * uBodyFade);
	return colour;
}

vec4 shade(vec2 vUv) {
	float depth = texture(uDepth, vUv).r;
	vec4 colour = texture(uColour, vUv);
	vec4 surface = texture(uSurface, vUv);
	vec3 normal = surface.xyz * 2.0 - 1.0;

	bool solid = isGround(vUv);
	bool overlay = !solid && !isSky(surface) && isOverlay(surface);
	bool sky = !solid && !overlay;

	float trail = solid ? pow(clamp((1.0 - colour.a) / 0.4, 0.0, 1.0), uTrailPower) : 0.0;
	vec3 base = solid
		? mix(colour.rgb, uTrailColour, trail * uTrailStrength)
		: withBodies(sky ? uSkyColour : colour.rgb, vUv);

	if (!solid) {
		// Sky is nothing but sky, so it goes entirely; a track drawn on it is
		// ink and stays. The discs come through withBodies either way.
		float ink = sky ? discCoverage(vUv) : 1.0;
		return vec4(base, ink);
	}

	vec2 offsets[8] = vec2[8](
		vec2(uOutlineStep.x, 0.0),
		vec2(-uOutlineStep.x, 0.0),
		vec2(0.0, uOutlineStep.y),
		vec2(0.0, -uOutlineStep.y),
		vec2(uOutlineStep.x, uOutlineStep.y),
		vec2(uOutlineStep.x, -uOutlineStep.y),
		vec2(-uOutlineStep.x, uOutlineStep.y),
		vec2(-uOutlineStep.x, -uOutlineStep.y)
	);

	float centre = linearise(depth);
	vec3 normalSum = vec3(0.0);
	float depthSum = 0.0;
	float solidCount = 0.0;
	float open = 0.0;

	for (int i = 0; i < 8; i++) {
		vec2 uv = vUv + offsets[i];
		float neighbourDepth = texture(uDepth, uv).r;
		vec4 neighbourSurface = texture(uSurface, uv);
		bool neighbourSolid = isGround(uv);

		if (!neighbourSolid) {
			open += 1.0;
			continue;
		}

		normalSum += neighbourSurface.xyz * 2.0 - 1.0;
		depthSum += linearise(neighbourDepth);
		solidCount += 1.0;
	}

	float silhouette = smoothstep(0.0, 0.375, open / 8.0);

	float weight = mix(uRoughnessFloor, 1.0, surface.w);
	float relief = 0.0;

	if (solidCount > 0.0) {
		vec3 meanNormal = normalSum / solidCount;
		float meanDepth = depthSum / solidCount;
		float normalCrease = length(meanNormal - normal);
		float depthCrease = abs(meanDepth - centre) / max(centre, 1.0);

		relief = clamp(
			(normalCrease * 6.0 + depthCrease * 24.0) * weight * uOutlineStrength,
			0.0,
			1.0
		);
	}

	vec3 lined = mix(base, uOutlineColour, relief);
	float shaded = silhouette * uSilhouetteStrength;
	vec3 marked = mix(lined, uSilhouetteColour, shaded);

	// Lit last, so the lines are part of the hillside rather than laid on top of
	// it: a line on ground turned away from you dims with the ground it is on.
	// The shading normal is rebuilt from the stored one, the same tilt the
	// terrain pass used to apply.
	vec2 slope = normal.xy / max(normal.z, 1e-4);
	vec3 shadingNormal = normalize(vec3(slope * uNormalStrength, 1.0));
	float fresnel = pow(1.0 - clamp(dot(shadingNormal, -rayThrough(vUv)), 0.0, 1.0), uFresnelPower);

	// Hillsides are the fill; the lines over them are the drawing. Only the
	// drawing survives when the camera is showing through.
	return vec4(marked + uFresnelColour * fresnel * uFresnelStrength, max(relief, shaded));
}

void main() {
	vec4 total = vec4(0.0);
	for (int y = 0; y < 2; y++) {
		for (int x = 0; x < 2; x++) {
			vec2 jitter = (vec2(float(x), float(y)) - 0.5) * 0.5 * uPixelSize;
			total += shade(vUv + jitter);
		}
	}

	total *= 0.25;
	float alpha = mix(1.0, total.a, uPassthrough);

	// Premultiplied on purpose. Where nothing is drawn the colour goes to black
	// as well as transparent, so the page behind shows through untouched however
	// the browser chooses to composite the canvas — leaving the sky colour in
	// place there washes the camera picture out and drains it of colour.
	oColour = vec4(total.rgb * alpha, alpha);
}
`;
