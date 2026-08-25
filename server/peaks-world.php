<?php
declare(strict_types=1);

/**
 * Loads every named summit on Earth into the local database.
 *
 *   php peaks-world.php
 *
 * The data comes from QLever, a SPARQL engine running over the full OSM planet.
 * One query returns all ~690,000 named peaks and volcanoes as CSV in a few
 * seconds, which is why this replaced the old Overpass crawler: that walked the
 * map cell by cell, took hours for one mountain range, and was throttled
 * constantly.
 *
 * The download is cached, so a re-run only reloads the database unless you pass
 * --refresh.
 */

require __DIR__ . '/db.php';

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("This is a command line tool.\n");
}

$config = require __DIR__ . '/config.php';
$options = getopt('', ['refresh', 'keep-csv', 'help']);

if (isset($options['help'])) {
    echo "Usage: php peaks-world.php [options]\n\n"
        . "  --refresh    Re-download even if the cached CSV is present.\n"
        . "  --keep-csv   Leave the downloaded CSV in data/ afterwards.\n";
    exit(0);
}

$csvPath = dirname($config['database']) . '/peaks-world.csv';

/**
 * Every named peak and volcano, with its OSM id, elevation tag and geometry.
 * `ele` is optional because a good third of summits are not tagged with one.
 */
const QUERY = <<<'SPARQL'
    PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:>
    PREFIX geo: <http://www.opengis.net/ont/geosparql#>
    SELECT ?o ?kind ?name ?ele ?geom WHERE {
      VALUES ?kind { "peak" "volcano" }
      ?o osmkey:natural ?kind .
      ?o osmkey:name ?name .
      ?o geo:hasGeometry/geo:asWKT ?geom .
      OPTIONAL { ?o osmkey:ele ?ele }
    }
    SPARQL;

/* Download
------------------------------------------------- */

if (isset($options['refresh']) || !is_file($csvPath) || filesize($csvPath) === 0) {
    echo "Querying the OSM planet ... ";
    $handle = fopen($csvPath, 'wb');
    if ($handle === false) {
        exit("\nCannot write to {$csvPath}\n");
    }

    $started = microtime(true);
    $curl = curl_init($config['sparql_endpoint'] . '?query=' . urlencode(QUERY));
    $curlOptions = [
        CURLOPT_FILE => $handle,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => 900,
        CURLOPT_HTTPHEADER => ['Accept: text/csv'],
        CURLOPT_USERAGENT => 'limina-peaks/1.0',
    ];
    if (($config['ca_bundle'] ?? null) !== null) {
        $curlOptions[CURLOPT_CAINFO] = $config['ca_bundle'];
    }
    curl_setopt_array($curl, $curlOptions);
    curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    $error = curl_error($curl);
    $errorNumber = curl_errno($curl);
    curl_close($curl);
    fclose($handle);

    if ($status !== 200) {
        @unlink($csvPath);
        if ($errorNumber === CURLE_SSL_CACERT || $errorNumber === CURLE_PEER_FAILED_VERIFICATION) {
            exit("\nTLS verification failed: {$error}\nSet 'ca_bundle' in config.php - see README.md.\n");
        }
        exit("\nThe query failed (HTTP {$status}) {$error}\n");
    }

    printf("%.1f MB in %.1fs\n", filesize($csvPath) / 1048576, microtime(true) - $started);
} else {
    printf("Using cached %s (%.1f MB) - pass --refresh to re-download.\n", basename($csvPath), filesize($csvPath) / 1048576);
}

/* Load
------------------------------------------------- */

$db = peaks_db($config['database']);
// The planet dump is authoritative and complete, so it replaces the table
// wholesale rather than merging into whatever was there before.
$db->exec('PRAGMA synchronous = OFF');
$db->exec('DROP TABLE IF EXISTS peaks');
peaks_db($config['database']);

$insert = $db->prepare(
    'INSERT OR REPLACE INTO peaks (id, name, lat, lon, elevation, kind)
          VALUES (:id, :name, :lat, :lon, :elevation, :kind)'
);

$handle = fopen($csvPath, 'rb');
if ($handle === false) {
    exit("Cannot read {$csvPath}\n");
}
fgetcsv($handle); // header

echo 'Loading ... ';
$started = microtime(true);
$loaded = 0;
$skipped = 0;

$db->beginTransaction();
while (($row = fgetcsv($handle)) !== false) {
    if (count($row) < 5) {
        $skipped++;
        continue;
    }
    if (!preg_match('~openstreetmap\.org/([a-z]+)/(\d+)~', $row[0], $reference)) {
        $skipped++;
        continue;
    }

    $point = wkt_centre($row[4]);
    if ($point === null) {
        $skipped++;
        continue;
    }

    $insert->execute([
        ':id' => $reference[1] . '/' . $reference[2],
        ':name' => $row[2],
        ':lat' => $point[0],
        ':lon' => $point[1],
        ':elevation' => parse_elevation($row[3]),
        ':kind' => $row[1] === 'volcano' ? 'volcano' : 'peak',
    ]);

    // Commit periodically so one enormous transaction never has to be replayed.
    if (++$loaded % 100000 === 0) {
        $db->commit();
        $db->beginTransaction();
    }
}
$db->commit();
fclose($handle);

$db->exec('CREATE INDEX IF NOT EXISTS peaks_lat_lon ON peaks (lat, lon)');
$db->exec('PRAGMA synchronous = NORMAL');

if (!isset($options['keep-csv'])) {
    @unlink($csvPath);
}

printf("%d summits in %.1fs (%d skipped)\n", $loaded, microtime(true) - $started, $skipped);
printf(
    "Database holds %d summits, %d with an elevation tag, %d volcanoes.\n",
    (int) $db->query('SELECT COUNT(*) FROM peaks')->fetchColumn(),
    (int) $db->query('SELECT COUNT(*) FROM peaks WHERE elevation IS NOT NULL')->fetchColumn(),
    (int) $db->query("SELECT COUNT(*) FROM peaks WHERE kind = 'volcano'")->fetchColumn()
);

/**
 * Mean of every coordinate pair in a WKT geometry.
 *
 * Almost every summit is a POINT, where this is simply the point itself. The
 * few mapped as ways or relations get the average of their vertices, which for
 * something the size of a summit is within metres of the middle.
 *
 * @return array{0: float, 1: float}|null Latitude and longitude, or null.
 */
function wkt_centre(string $wkt): ?array
{
    $pattern = '~(-?\d+\.?\d*(?:[eE][-+]?\d+)?) (-?\d+\.?\d*(?:[eE][-+]?\d+)?)~';
    if (!preg_match_all($pattern, $wkt, $pairs, PREG_SET_ORDER)) {
        return null;
    }

    $lon = 0.0;
    $lat = 0.0;
    foreach ($pairs as $pair) {
        $lon += (float) $pair[1];
        $lat += (float) $pair[2];
    }
    $lon /= count($pairs);
    $lat /= count($pairs);

    return abs($lat) > 90 || abs($lon) > 180 ? null : [$lat, $lon];
}

/** OSM `ele` is usually plain metres, but stray units and commas turn up. */
function parse_elevation(string $value): ?float
{
    if (trim($value) === '') {
        return null;
    }
    $metres = (float) str_replace(',', '.', trim($value));

    return is_finite($metres) && $metres > -500 && $metres < 9000 ? $metres : null;
}
