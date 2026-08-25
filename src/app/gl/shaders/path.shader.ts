/** Sun and moon track */

export const PATH_VERTEX = /* glsl */ `#version 300 es
precision highp float;

/** Direction to this point on the track, ENU */
in vec3 aDirection;
/** The next point along, for the heading */
in vec3 aNext;
/** Which side of the line: -1 or +1 */
in float aSide;
/** Radians since the run dropped below the horizon */
in float aAlong;

uniform mat4 uViewProjection;
uniform float uDistance;
uniform vec2 uViewport;
uniform float uWidth;

out float vAlong;
/** Degrees above the horizon */
out float vAltitude;

void main() {
	vAlong = aAlong;
	vAltitude = degrees(asin(clamp(aDirection.z, -1.0, 1.0)));

	vec4 here = uViewProjection * vec4(aDirection * uDistance, 1.0);
	vec4 next = uViewProjection * vec4(aNext * uDistance, 1.0);

	vec2 screenHere = (here.xy / here.w) * uViewport;
	vec2 screenNext = (next.xy / next.w) * uViewport;
	vec2 heading = screenNext - screenHere;
	vec2 across = length(heading) > 0.0001
		? normalize(vec2(-heading.y, heading.x))
		: vec2(0.0, 1.0);

	here.xy += (across * aSide * uWidth * 0.5 / uViewport) * here.w;
	gl_Position = here;
}
`;

export const PATH_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

uniform vec3 uPathColour;
/** Dashes per radian; zero draws it solid */
uniform float uDashes;
/** Arrival of the tracks, nought to one */
uniform float uFade;

in float vAlong;
in float vAltitude;

layout(location = 0) out vec4 oColour;
layout(location = 1) out vec4 oSurface;

/**
 * Below the true horizon the terrain has nothing left to say about the track:
 * the ground the app knows about has run out, or fallen away. The stretch is
 * still worth drawing — it is where the body actually went — but it is drawn
 * broken, the way an inferred line always is.
 */
void main() {
	if (uDashes > 0.0 && vAltitude < -0.833 && fract(vAlong * uDashes) > 0.6) {
		discard;
	}
	oColour = vec4(uPathColour, uFade);
	oSurface = vec4(0.5, 0.5, 0.25, 0.0);
}
`;
