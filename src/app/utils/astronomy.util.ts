import { LatLon } from '@interfaces';

import { DEG } from './geo.util';
import { Vec3 } from './mat4.util';

/** Where a celestial body sits in the sky, from a particular place and moment. */
export interface SkyPosition {
	/** Degrees clockwise from north. */
	azimuth: number;
	/** Degrees above the horizon; negative is below it. */
	altitude: number;
}

export type CelestialBody = 'sun' | 'moon';

const J2000 = Date.UTC(2000, 0, 1, 12);
const MS_PER_DAY = 86_400_000;
/**
 * Tilt of the Earth's axis, in degrees, at a moment.
 *
 * It is not a constant: the axis is straightening by about a second of arc a
 * decade, and the small nodding term is what keeps declinations honest to the
 * arcminute.
 */
function obliquity(days: number): number {
	const t = days / 36525;
	const node = wrap(125.04 - 1934.136 * t);
	return 23.439291 - 0.0130042 * t - 0.00000016 * t * t + 0.00256 * cos(node);
}

/** Days since the J2000.0 epoch. */
function daysSinceEpoch(when: Date): number {
	return (when.getTime() - J2000) / MS_PER_DAY;
}

function sin(degrees: number): number {
	return Math.sin(degrees * DEG);
}

function cos(degrees: number): number {
	return Math.cos(degrees * DEG);
}

/** Wraps an angle into 0..360. */
function wrap(degrees: number): number {
	return ((degrees % 360) + 360) % 360;
}

/** Equatorial coordinates, in degrees. */
interface Equatorial {
	rightAscension: number;
	declination: number;
}

/** Converts ecliptic longitude and latitude to right ascension and declination. */
function toEquatorial(longitude: number, latitude: number, days: number): Equatorial {
	const tilt = obliquity(days);
	const rightAscension =
		Math.atan2(
			sin(longitude) * cos(tilt) - Math.tan(latitude * DEG) * sin(tilt),
			cos(longitude),
		) / DEG;
	const declination =
		Math.asin(sin(latitude) * cos(tilt) + cos(latitude) * sin(tilt) * sin(longitude)) / DEG;

	return { rightAscension: wrap(rightAscension), declination };
}

/**
 * Greenwich mean sidereal time, in degrees.
 *
 * Both the epoch value and the rate matter: the rounded pair this used to carry
 * put the whole sky a third of a degree out at J2000 and over half a degree out
 * by 2030 — better than two minutes of time on every rise and set, and growing.
 */
function siderealTime(days: number): number {
	const t = days / 36525;
	return wrap(
		280.46061837 + 360.98564736629 * days + 0.000387933 * t * t - (t * t * t) / 38_710_000,
	);
}

/** Turns equatorial coordinates into an observer's azimuth and altitude. */
function toHorizontal(equatorial: Equatorial, days: number, place: LatLon): SkyPosition {
	const hourAngle = wrap(siderealTime(days) + place.lon - equatorial.rightAscension);
	const declination = equatorial.declination;

	const altitude =
		Math.asin(
			sin(place.lat) * sin(declination) + cos(place.lat) * cos(declination) * cos(hourAngle),
		) / DEG;

	const azimuth = wrap(
		Math.atan2(
			-sin(hourAngle),
			cos(place.lat) * Math.tan(declination * DEG) - sin(place.lat) * cos(hourAngle),
		) / DEG,
	);

	return { azimuth, altitude };
}

/**
 * Position of the sun. Low-precision series from Meeus, good to roughly a
 * minute of arc — far tighter than a horizon drawing can show.
 */
export function sunPosition(when: Date, place: LatLon): SkyPosition {
	const days = daysSinceEpoch(when);
	return toHorizontal(toEquatorial(sunLongitudeAt(days), 0, days), days, place);
}

/**
 * Apparent ecliptic longitude of the sun, in degrees.
 *
 * The mean longitude has to advance on its own terms rather than be recovered
 * from the mean anomaly and a fixed perihelion: the perihelion itself moves, so
 * holding it still put the sun half a degree behind by the middle of the 2020s
 * and would keep going. The last line is aberration and nutation, which are
 * what separate the sun's true place from the one it appears in.
 */
function sunLongitudeAt(days: number): number {
	const t = days / 36525;
	const meanLongitude = wrap(280.46646 + 36000.76983 * t + 0.0003032 * t * t);
	const meanAnomaly = wrap(357.52911 + 35999.05029 * t - 0.0001537 * t * t);

	const centre =
		(1.914602 - 0.004817 * t - 0.000014 * t * t) * sin(meanAnomaly) +
		(0.019993 - 0.000101 * t) * sin(2 * meanAnomaly) +
		0.000289 * sin(3 * meanAnomaly);

	const node = wrap(125.04 - 1934.136 * t);
	return wrap(meanLongitude + centre - 0.00569 - 0.00478 * sin(node));
}

/** Earth's equatorial radius, in kilometres. Sets the size of the parallax. */
const EARTH_RADIUS_KM = 6378.14;

/**
 * Periodic terms for the moon's longitude and distance, from Meeus' abridgement
 * of ELP2000-82. Each row is the multiple of D, M, M' and F, then the
 * coefficient of the sine term in millionths of a degree, then the coefficient
 * of the cosine term in metres.
 */
const MOON_LONGITUDE: [number, number, number, number, number, number][] = [
	[0, 0, 1, 0, 6288774, -20905355],
	[2, 0, -1, 0, 1274027, -3699111],
	[2, 0, 0, 0, 658314, -2955968],
	[0, 0, 2, 0, 213618, -569925],
	[0, 1, 0, 0, -185116, 48888],
	[0, 0, 0, 2, -114332, -3149],
	[2, 0, -2, 0, 58793, 246158],
	[2, -1, -1, 0, 57066, -152138],
	[2, 0, 1, 0, 53322, -170733],
	[2, -1, 0, 0, 45758, -204586],
	[0, 1, -1, 0, -40923, -129620],
	[1, 0, 0, 0, -34720, 108743],
	[0, 1, 1, 0, -30383, 104755],
	[2, 0, 0, -2, 15327, 10321],
	[0, 0, 1, 2, -12528, 0],
	[0, 0, 1, -2, 10980, 79661],
	[4, 0, -1, 0, 10675, -34782],
	[0, 0, 3, 0, 10034, -23210],
	[4, 0, -2, 0, 8548, -21636],
	[2, 1, -1, 0, -7888, 24208],
	[2, 1, 0, 0, -6766, 30824],
	[1, 0, -1, 0, -5163, -8379],
	[1, 1, 0, 0, 4987, -16675],
	[2, -1, 1, 0, 4036, -12831],
	[2, 0, 2, 0, 3994, -10445],
	[4, 0, 0, 0, 3861, -11650],
	[2, 0, -3, 0, 3665, 14403],
	[0, 1, -2, 0, -2689, -7003],
	[2, 0, -1, 2, -2602, 0],
	[2, -1, -2, 0, 2390, 10056],
	[1, 0, 1, 0, -2348, 6322],
	[2, -2, 0, 0, 2236, -9884],
	[0, 1, 2, 0, -2120, 5751],
	[0, 2, 0, 0, -2069, 0],
	[2, -2, -1, 0, 2048, -4950],
	[2, 0, 1, -2, -1773, 4130],
	[2, 0, 0, 2, -1595, 0],
	[4, -1, -1, 0, 1215, -3958],
	[0, 0, 2, 2, -1110, 0],
	[3, 0, -1, 0, -892, 3258],
	[2, 1, 1, 0, -810, 2616],
	[4, -1, -2, 0, 759, -1897],
	[0, 2, -1, 0, -713, -2117],
	[2, 2, -1, 0, -700, 2354],
	[2, 1, -2, 0, 691, 0],
	[2, -1, 0, -2, 596, 0],
	[4, 0, 1, 0, 549, -1423],
	[0, 0, 4, 0, 537, -1117],
	[4, -1, 0, 0, 520, -1571],
	[1, 0, -2, 0, -487, -1739],
	[2, 1, 0, -2, -399, 0],
	[0, 0, 2, -2, -381, -4421],
	[1, 1, 1, 0, 351, 0],
	[3, 0, -2, 0, -340, 0],
	[4, 0, -3, 0, 330, 0],
	[2, -1, 2, 0, 327, 0],
	[0, 2, 1, 0, -323, 1165],
	[1, 1, -1, 0, 299, 0],
	[2, 0, 3, 0, 294, 0],
	[2, 0, -1, -2, 0, 8752],
];

/**
 * The same, for the moon's ecliptic latitude. The coefficient is again in
 * millionths of a degree.
 */
const MOON_LATITUDE: [number, number, number, number, number][] = [
	[0, 0, 0, 1, 5128122],
	[0, 0, 1, 1, 280602],
	[0, 0, 1, -1, 277693],
	[2, 0, 0, -1, 173237],
	[2, 0, -1, 1, 55413],
	[2, 0, -1, -1, 46271],
	[2, 0, 0, 1, 32573],
	[0, 0, 2, 1, 17198],
	[2, 0, 1, -1, 9266],
	[0, 0, 2, -1, 8822],
	[2, -1, 0, -1, 8216],
	[2, 0, -2, -1, 4324],
	[2, 0, 1, 1, 4200],
	[2, 1, 0, -1, -3359],
	[2, -1, -1, 1, 2463],
	[2, -1, 0, 1, 2211],
	[2, -1, -1, -1, 2065],
	[0, 1, -1, -1, -1870],
	[4, 0, -1, -1, 1828],
	[0, 1, 0, 1, -1794],
	[0, 0, 0, 3, -1749],
	[0, 1, -1, 1, -1565],
	[1, 0, 0, 1, -1491],
	[0, 1, 1, 1, -1475],
	[0, 1, 1, -1, -1410],
	[0, 1, 0, -1, -1344],
	[1, 0, 0, -1, -1335],
	[0, 0, 3, 1, 1107],
	[4, 0, 0, -1, 1021],
	[4, 0, -1, 1, 833],
	[0, 0, 1, -3, 777],
	[4, 0, -2, 1, 671],
	[2, 0, 0, -3, 607],
	[2, 0, 2, -1, 596],
	[2, -1, 1, -1, 491],
	[2, 0, -2, 1, -451],
	[0, 0, 3, -1, 439],
	[2, 0, 2, 1, 422],
	[2, 0, -3, -1, 421],
	[2, 1, -1, 1, -366],
	[2, 1, 0, 1, -351],
	[4, 0, 0, 1, 331],
	[2, -1, 1, 1, 315],
	[2, -2, 0, -1, 302],
	[0, 0, 1, 3, -283],
	[2, 1, 1, -1, -229],
	[1, 1, 0, -1, 223],
	[1, 1, 0, 1, 223],
	[0, 1, -2, -1, -220],
	[2, 1, -1, -1, -220],
	[1, 0, 1, 1, -185],
	[2, -1, -2, -1, 181],
	[0, 1, 2, 1, -177],
	[4, 0, -2, -1, 176],
	[4, -1, -1, -1, 166],
	[1, 0, 1, -1, -164],
	[4, 0, 1, -1, 132],
	[1, 0, -1, -1, -119],
	[4, -1, 0, -1, 115],
	[2, -2, 0, 1, 107],
];

/** Ecliptic position and distance of the moon, seen from the Earth's centre. */
interface MoonVector {
	longitude: number;
	latitude: number;
	/** Centre to centre, in kilometres. */
	distance: number;
}

/**
 * Where the moon is, from Meeus' abridgement of ELP2000-82.
 *
 * Sixty terms of longitude and distance and sixty of latitude, which is enough
 * for about ten arcseconds — three orders of magnitude finer than the two-term
 * approximation this replaces, and well past anything the app can draw.
 */
function moonVector(days: number): MoonVector {
	const t = days / 36525;

	const meanLongitude = wrap(
		218.3164477 + 481267.88123421 * t - 0.0015786 * t * t + (t * t * t) / 538841,
	);
	const elongation = wrap(
		297.8501921 + 445267.1114034 * t - 0.0018819 * t * t + (t * t * t) / 545868,
	);
	const sunAnomaly = wrap(357.5291092 + 35999.0502909 * t - 0.0001536 * t * t);
	const moonAnomaly = wrap(
		134.9633964 + 477198.8675055 * t + 0.0087414 * t * t + (t * t * t) / 69699,
	);
	const latitudeArgument = wrap(
		93.272095 + 483202.0175233 * t - 0.0036539 * t * t - (t * t * t) / 3526000,
	);

	// The Earth's orbit is slowly rounding off, which weakens every term that
	// depends on the sun's anomaly.
	const eccentricity = 1 - 0.002516 * t - 0.0000074 * t * t;
	const damping = (m: number) =>
		m === 0 ? 1 : Math.abs(m) === 1 ? eccentricity : eccentricity * eccentricity;

	let sumLongitude = 0;
	let sumRadius = 0;
	for (const [d, m, mp, f, l, r] of MOON_LONGITUDE) {
		const angle = d * elongation + m * sunAnomaly + mp * moonAnomaly + f * latitudeArgument;
		sumLongitude += l * damping(m) * sin(angle);
		sumRadius += r * damping(m) * cos(angle);
	}

	let sumLatitude = 0;
	for (const [d, m, mp, f, b] of MOON_LATITUDE) {
		const angle = d * elongation + m * sunAnomaly + mp * moonAnomaly + f * latitudeArgument;
		sumLatitude += b * damping(m) * sin(angle);
	}

	// Venus, Jupiter and the flattening of the Earth, as three extra angles.
	const a1 = wrap(119.75 + 131.849 * t);
	const a2 = wrap(53.09 + 479264.29 * t);
	const a3 = wrap(313.45 + 481266.484 * t);
	sumLongitude += 3958 * sin(a1) + 1962 * sin(meanLongitude - latitudeArgument) + 318 * sin(a2);
	sumLatitude +=
		-2235 * sin(meanLongitude) +
		382 * sin(a3) +
		175 * sin(a1 - latitudeArgument) +
		175 * sin(a1 + latitudeArgument) +
		127 * sin(meanLongitude - moonAnomaly) -
		115 * sin(meanLongitude + moonAnomaly);

	return {
		longitude: wrap(meanLongitude + sumLongitude / 1_000_000),
		latitude: sumLatitude / 1_000_000,
		distance: 385000.56 + sumRadius / 1000,
	};
}

/**
 * Position of the moon, corrected for where on the Earth it is seen from.
 *
 * The moon is close enough that the observer's own offset from the centre of
 * the Earth moves it against the sky — by up to a degree at the horizon, which
 * is twice the width of the disc and enough to shift moonrise by minutes.
 */
export function moonPosition(when: Date, place: LatLon): SkyPosition {
	const days = daysSinceEpoch(when);
	const moon = moonVector(days);
	const geocentric = toHorizontal(toEquatorial(moon.longitude, moon.latitude, days), days, place);

	return {
		azimuth: geocentric.azimuth,
		altitude: topocentric(geocentric.altitude, moon.distance),
	};
}

/** Lowers an altitude by the parallax of a body at `distance` kilometres. */
function topocentric(altitude: number, distance: number): number {
	const parallax = Math.asin(EARTH_RADIUS_KM / distance) / DEG;
	return altitude - parallax * cos(altitude);
}

export function bodyPosition(body: CelestialBody, when: Date, place: LatLon): SkyPosition {
	return body === 'sun' ? sunPosition(when, place) : moonPosition(when, place);
}

/** A sampled point on a track. */
export interface TrackPoint extends SkyPosition {
	time: Date;
}

/** Altitude a track has to reach before its end can be left hanging, in degrees. */
const BURIED = -3;
/** How far the search may run to find the arc, in minutes. */
const REACH = 36 * 60;

/**
 * The single arc a body traces from rise to set around `when`, sampled every `stepMinutes` and
 * carried a little under the horizon at both ends so the terrain hides where it stops.
 */
export function bodyPath(
	body: CelestialBody,
	when: Date,
	place: LatLon,
	stepMinutes = 10,
): TrackPoint[] {
	const at = (minutes: number): TrackPoint => {
		const time = new Date(when.getTime() + minutes * 60_000);
		return { time, ...bodyPosition(body, time, place) };
	};

	let inside = 0;
	while (inside < REACH && at(inside).altitude <= BURIED) {
		inside += stepMinutes;
	}

	let first = inside;
	while (first > inside - REACH && at(first).altitude > BURIED) {
		first -= stepMinutes;
	}
	let last = inside;
	while (last < inside + REACH && at(last).altitude > BURIED) {
		last += stepMinutes;
	}

	const path: TrackPoint[] = [];
	for (let minutes = first; minutes <= last; minutes += stepMinutes) {
		path.push(at(minutes));
	}
	return path;
}

/** Moment a body passes `altitude` degrees, searching outwards from `when`. */
function crossing(
	body: CelestialBody,
	when: Date,
	place: LatLon,
	altitude: number,
	rising: boolean,
	direction: 1 | -1,
): Date | null {
	const step = 5;
	const at = (minutes: number) =>
		bodyPosition(body, new Date(when.getTime() + minutes * 60_000), place).altitude;

	let previous = at(0);
	for (let minutes = step; minutes <= REACH; minutes += step) {
		const current = at(minutes * direction);
		const [low, high] = direction === 1 ? [previous, current] : [current, previous];
		const crossed = rising
			? low <= altitude && high > altitude
			: low > altitude && high <= altitude;

		if (crossed) {
			return new Date(
				when.getTime() + refine(at, minutes - step, minutes, direction, altitude) * 60_000,
			);
		}
		previous = current;
	}
	return null;
}

/**
 * Bisects a bracketed crossing down to about a second.
 *
 * The altitude curve flattens as a body grazes the horizon, which is exactly
 * where rise and set matter and exactly where reading straight across the
 * bracket is worst — minutes out at high latitudes near the solstice.
 */
function refine(
	at: (minutes: number) => number,
	low: number,
	high: number,
	direction: 1 | -1,
	altitude: number,
): number {
	let start = low;
	let end = high;
	const above = (minutes: number) => at(minutes * direction) > altitude;
	const endsAbove = above(end);

	for (let step = 0; step < 20; step++) {
		const middle = (start + end) / 2;
		if (above(middle) === endsAbove) {
			end = middle;
		} else {
			start = middle;
		}
	}
	return ((start + end) / 2) * direction;
}

/** Next time the body climbs through `altitude`, or null if it never does. */
export function nextRise(
	body: CelestialBody,
	when: Date,
	place: LatLon,
	altitude = -0.833,
): Date | null {
	return crossing(body, when, place, altitude, true, 1);
}

/** Next time the body drops through `altitude`. */
export function nextSet(
	body: CelestialBody,
	when: Date,
	place: LatLon,
	altitude = -0.833,
): Date | null {
	return crossing(body, when, place, altitude, false, 1);
}

/** When the sun is highest, and how high, on the day containing `when`. */
export function solarNoon(when: Date, place: LatLon): { time: Date; altitude: number } {
	const start = new Date(when);
	start.setHours(0, 0, 0, 0);

	let best = { time: start, altitude: -90 };
	for (let minutes = 0; minutes <= 24 * 60; minutes += 10) {
		const time = new Date(start.getTime() + minutes * 60_000);
		const { altitude } = sunPosition(time, place);
		if (altitude > best.altitude) {
			best = { time, altitude };
		}
	}
	for (let offset = -10; offset <= 10; offset++) {
		const time = new Date(best.time.getTime() + offset * 60_000);
		const { altitude } = sunPosition(time, place);
		if (altitude > best.altitude) {
			best = { time, altitude };
		}
	}
	return best;
}

/** How the moon is lit, and which way its bright limb faces. */
export interface MoonPhase {
	/** 0 is new, 0.5 is full, approaching 1 is waning back to new. */
	fraction: number;
	/** Lit portion of the disc, 0 to 1. */
	illumination: number;
	/** Angle from the moon's celestial north to the bright limb, in degrees. */
	brightLimbAngle: number;
	/** Centre-to-centre distance from Earth, in kilometres. */
	distance: number;
	name: string;
}

/** Phase, illumination and distance of the moon. */
export function moonPhase(when: Date): MoonPhase {
	const days = daysSinceEpoch(when);

	const sunLongitude = sunLongitudeAt(days);
	const moon = moonVector(days);

	const elongation = wrap(moon.longitude - sunLongitude);
	const illumination = (1 - cos(elongation)) / 2;
	const distance = moon.distance;

	return {
		fraction: elongation / 360,
		illumination,
		brightLimbAngle: elongation < 180 ? 90 : 270,
		distance,
		name: phaseName(illumination, elongation < 180),
	};
}

/** Named by how much of the disc is lit rather than by bands of elongation. */
function phaseName(illumination: number, waxing: boolean): string {
	if (illumination < 0.02) {
		return 'moonPhase.new';
	}
	if (illumination > 0.98) {
		return 'moonPhase.full';
	}
	if (Math.abs(illumination - 0.5) < 0.02) {
		return waxing ? 'moonPhase.firstQuarter' : 'moonPhase.lastQuarter';
	}
	if (illumination < 0.5) {
		return waxing ? 'moonPhase.waxingCrescent' : 'moonPhase.waningCrescent';
	}
	return waxing ? 'moonPhase.waxingGibbous' : 'moonPhase.waningGibbous';
}

/**
 * North galactic pole and the galactic longitude of the celestial pole, J2000.
 * These three numbers are the whole of the galactic-to-equatorial rotation.
 */
const GALACTIC_POLE_RA = 192.85948;
const GALACTIC_POLE_DEC = 27.12825;
const GALACTIC_NODE = 122.93192;

/**
 * The galactic equator: the line the Milky Way traces across the sky, sampled every `step`
 * degrees of galactic longitude.
 */
export function milkyWayPath(when: Date, place: LatLon, step = 2): SkyPosition[] {
	const days = daysSinceEpoch(when);
	const path: SkyPosition[] = [];

	for (let longitude = 0; longitude <= 360; longitude += step) {
		const offset = GALACTIC_NODE - longitude;
		const declination = Math.asin(cos(GALACTIC_POLE_DEC) * cos(offset)) / DEG;
		const rightAscension = wrap(
			GALACTIC_POLE_RA + Math.atan2(sin(offset), -sin(GALACTIC_POLE_DEC) * cos(offset)) / DEG,
		);
		path.push(toHorizontal({ rightAscension, declination }, days, place));
	}
	return path;
}

/**
 * Where a fixed point on the celestial sphere sits for an observer. Used for the
 * Milky Way, whose outlines are catalogued in equatorial coordinates.
 */
export function skyPositionOf(
	rightAscension: number,
	declination: number,
	when: Date,
	place: LatLon,
): SkyPosition {
	return toHorizontal({ rightAscension, declination }, daysSinceEpoch(when), place);
}

/** Unit vector towards a sky position, in the viewer's east/north/up frame. */
export function skyDirection({ azimuth, altitude }: SkyPosition): Vec3 {
	return [sin(azimuth) * cos(altitude), cos(azimuth) * cos(altitude), sin(altitude)];
}
