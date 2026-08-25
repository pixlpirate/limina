<?php
declare(strict_types=1);

/**
 * GET peaks.php?lat=45.87&lon=6.88&radius=60000
 *
 * Returns every named summit within `radius` metres of the point, nearest
 * first. Read-only: the data comes from import.php.
 */

require __DIR__ . '/db.php';

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
// The summit list changes only when the database is re-imported.
header('Cache-Control: public, max-age=3600');

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
$radius = filter_input(INPUT_GET, 'radius', FILTER_VALIDATE_FLOAT);

if ($lat === false || $lat === null || abs($lat) > 90) {
    fail(400, 'A `lat` between -90 and 90 is required.');
}
if ($lon === false || $lon === null || abs($lon) > 180) {
    fail(400, 'A `lon` between -180 and 180 is required.');
}
if ($radius === false || $radius === null || $radius <= 0) {
    fail(400, 'A positive `radius`, in metres, is required.');
}
$radius = min($radius, (float) $config['max_radius']);

if (!is_file($config['database'])) {
    fail(503, 'The summit database has not been imported yet. Run server/import.php.');
}

const METRES_PER_DEGREE_LAT = 111320.0;

$latSpan = $radius / METRES_PER_DEGREE_LAT;
// Longitude degrees shrink towards the poles; guard against cos() reaching zero.
$lonScale = max(cos(deg2rad($lat)), 1e-6) * METRES_PER_DEGREE_LAT;
$lonSpan = $radius / $lonScale;

try {
    $db = peaks_db($config['database']);
    $statement = $db->prepare(
        'SELECT id, name, lat, lon, elevation, kind
           FROM peaks
          WHERE lat BETWEEN :minLat AND :maxLat
            AND lon BETWEEN :minLon AND :maxLon'
    );
    $statement->execute([
        ':minLat' => $lat - $latSpan,
        ':maxLat' => $lat + $latSpan,
        ':minLon' => $lon - $lonSpan,
        ':maxLon' => $lon + $lonSpan,
    ]);
    $rows = $statement->fetchAll();
} catch (Throwable) {
    fail(500, 'The summit database could not be read.');
}

// The box query is a coarse filter; trim it to a true circle and sort by range.
$peaks = [];
foreach ($rows as $row) {
    $east = ((float) $row['lon'] - $lon) * $lonScale;
    $north = ((float) $row['lat'] - $lat) * METRES_PER_DEGREE_LAT;
    $distance = sqrt($east * $east + $north * $north);
    if ($distance > $radius) {
        continue;
    }
    $peaks[] = [
        'id' => (string) $row['id'],
        'name' => $row['name'],
        'lat' => (float) $row['lat'],
        'lon' => (float) $row['lon'],
        'elevation' => $row['elevation'] === null ? null : (float) $row['elevation'],
        'kind' => $row['kind'],
        'distance' => round($distance, 1),
    ];
}

usort($peaks, static fn (array $a, array $b): int => $a['distance'] <=> $b['distance']);
$peaks = array_slice($peaks, 0, (int) $config['max_results']);

echo json_encode(['peaks' => $peaks], JSON_UNESCAPED_UNICODE);
