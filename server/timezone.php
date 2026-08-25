<?php
declare(strict_types=1);

/**
 * GET timezone.php?lat=45.87&lon=6.88
 *
 * Returns the civil timezone at a point, so the app can show sunrise on the
 * clock the people who live there read rather than on the visitor's own.
 *
 * Two ways of answering, in order of preference:
 *
 * 1. `data/timezones.geojson`, if it is there: the real zone boundaries, so the
 *    answer is exact. See README.md for the one command that fetches it.
 * 2. Otherwise the nearest zone by PHP's own timezone database, which carries
 *    one representative point per zone. That is a centroid test rather than a
 *    boundary test: it is right for most of the world and wrong near borders —
 *    Delhi comes back as Kathmandu, three quarters of an hour out.
 *
 * The response says which was used, so a caller can tell an exact answer from
 * an approximate one.
 */

$config = require __DIR__ . '/config.php';

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed = $config['allowed_origins'];
if (in_array('*', $allowed, true)) {
    header('Access-Control-Allow-Origin: *');
} elseif ($origin !== '' && in_array($origin, $allowed, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}
header('Content-Type: application/json; charset=utf-8');
// Boundaries move rarely. The offset inside one moves twice a year, which is
// why the transitions travel with the answer rather than being recomputed.
header('Cache-Control: public, max-age=86400');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

/** Sends a JSON error and stops. */
function fail(int $status, string $message): never
{
    http_response_code($status);
    echo json_encode(['error' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

$lat = filter_input(INPUT_GET, 'lat', FILTER_VALIDATE_FLOAT);
$lon = filter_input(INPUT_GET, 'lon', FILTER_VALIDATE_FLOAT);

if ($lat === null || $lat === false || $lat < -90 || $lat > 90) {
    fail(400, 'lat must be a number between -90 and 90.');
}
if ($lon === null || $lon === false || $lon < -180 || $lon > 180) {
    fail(400, 'lon must be a number between -180 and 180.');
}

/** Great-circle distance between two points, in kilometres. */
function distance(float $lat1, float $lon1, float $lat2, float $lon2): float
{
    $phi1 = deg2rad($lat1);
    $phi2 = deg2rad($lat2);
    $dPhi = deg2rad($lat2 - $lat1);
    $dLambda = deg2rad($lon2 - $lon1);

    $a = sin($dPhi / 2) ** 2 + cos($phi1) * cos($phi2) * sin($dLambda / 2) ** 2;
    return 6371.0 * 2 * atan2(sqrt($a), sqrt(1 - $a));
}

/** Ray casting: is the point inside this ring of [lon, lat] pairs? */
function insideRing(float $lat, float $lon, array $ring): bool
{
    $inside = false;
    $count = count($ring);

    for ($i = 0, $j = $count - 1; $i < $count; $j = $i++) {
        $xi = $ring[$i][0];
        $yi = $ring[$i][1];
        $xj = $ring[$j][0];
        $yj = $ring[$j][1];

        if (($yi > $lat) !== ($yj > $lat)) {
            $crossing = $xi + ($lat - $yi) / ($yj - $yi) * ($xj - $xi);
            if ($lon < $crossing) {
                $inside = !$inside;
            }
        }
    }
    return $inside;
}

/** A polygon is its outline minus any holes. */
function insidePolygon(float $lat, float $lon, array $polygon): bool
{
    if (!insideRing($lat, $lon, $polygon[0])) {
        return false;
    }
    for ($i = 1; $i < count($polygon); $i++) {
        if (insideRing($lat, $lon, $polygon[$i])) {
            return false;
        }
    }
    return true;
}

/** The zone whose boundary contains the point, or null without the data. */
function zoneFromBoundaries(float $lat, float $lon): ?string
{
    $path = __DIR__ . '/data/timezones.geojson';
    if (!is_readable($path)) {
        return null;
    }

    $data = json_decode((string) file_get_contents($path), true);
    if (!is_array($data) || !isset($data['features'])) {
        return null;
    }

    foreach ($data['features'] as $feature) {
        $name = $feature['properties']['tzid'] ?? $feature['properties']['tz_name1st'] ?? null;
        $geometry = $feature['geometry'] ?? null;
        if ($name === null || $geometry === null) {
            continue;
        }

        $polygons = $geometry['type'] === 'MultiPolygon'
            ? $geometry['coordinates']
            : [$geometry['coordinates']];

        foreach ($polygons as $polygon) {
            if (insidePolygon($lat, $lon, $polygon)) {
                return (string) $name;
            }
        }
    }
    return null;
}

/** The zone whose representative point is closest. Always answers something. */
function nearestZone(float $lat, float $lon): ?string
{
    $best = null;
    $bestDistance = INF;

    foreach (DateTimeZone::listIdentifiers(DateTimeZone::ALL) as $name) {
        $location = (new DateTimeZone($name))->getLocation();
        if ($location === false) {
            continue;
        }

        $gap = distance($lat, $lon, $location['latitude'], $location['longitude']);
        if ($gap < $bestDistance) {
            $bestDistance = $gap;
            $best = $name;
        }
    }
    return $best;
}

$exact = zoneFromBoundaries($lat, $lon);
$name = $exact ?? nearestZone($lat, $lon);

if ($name === null) {
    fail(500, 'No timezone could be determined.');
}

$zone = new DateTimeZone($name);
$now = new DateTimeImmutable('now', $zone);

// The clock changes either side of now travel with the answer, so a client
// holding this offline can still place a date on the far side of one.
$transitions = [];
foreach ($zone->getTransitions($now->getTimestamp(), $now->getTimestamp() + 400 * 86400) as $transition) {
    $transitions[] = [
        'at' => gmdate('c', $transition['ts']),
        'offset' => $transition['offset'],
        'abbreviation' => $transition['abbr'],
    ];
}

echo json_encode([
    'zone' => $name,
    'offset' => $now->getOffset(),
    'abbreviation' => $now->format('T'),
    'exact' => $exact !== null,
    'transitions' => $transitions,
], JSON_UNESCAPED_UNICODE);
