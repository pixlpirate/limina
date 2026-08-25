<?php
declare(strict_types=1);

/**
 * Loads every named summit on Earth into the local database.
 *
 *   php world-peaks.php
 *
 * The data comes from QLever, a SPARQL engine running over the full OSM planet.
 * One query returns all ~690,000 named peaks and volcanoes as CSV in a few
 * seconds. That is why this replaced the earlier Overpass crawler, which walked
 * the map cell by cell, took hours for a single mountain range, and spent most
 * of that time being throttled.
 *
 * The download is cached, so a re-run only reloads the database unless you pass
 * --refresh.
 */

require __DIR__ . '/db.php';

/** Everything that is not a plain summit, and so keeps its own kind. */
const KINDS = ['volcano', 'mountain_range', 'ridge', 'hill', 'region'];

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("This is a command line tool.\n");
}

$config = require __DIR__ . '/config.php';
$options = getopt('', ['refresh', 'keep-csv', 'help']);

if (isset($options['help'])) {
    echo "Usage: php world-peaks.php [options]\n\n"
        . "  --refresh    Re-download even if the cached CSV is present.\n"
        . "  --keep-csv   Leave the downloaded CSV in data/ afterwards.\n";
    exit(0);
}

$csvPath = dirname($config['database']) . '/peaks-world.csv';

/**
 * Every named summit and named landform, with its OSM id, elevation tag and
 * geometry.
 *
 * `ele` is OPTIONAL because roughly a quarter of summits are not tagged with one
 * and landforms never are — they cover ground rather than standing at a height.
 * All of them are tagged on plain nodes just as summits are, so they need
 * nothing special here beyond being asked for.
 */
const QUERY = <<<'SPARQL'
    PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:>
    PREFIX geo: <http://www.opengis.net/ont/geosparql#>
    SELECT ?o ?kind ?name ?ele ?geom WHERE {
      {
        VALUES ?kind { "peak" "volcano" "mountain_range" "ridge" "hill" }
        ?o osmkey:natural ?kind .
      } UNION {
        # Massifs are widely tagged as plain regions rather than as ranges, which
        # is where names like "Massif de la Chartreuse" actually live.
        VALUES ?kind { "region" }
        ?o osmkey:place ?kind .
      }
      ?o osmkey:name ?name .
      ?o geo:hasGeometry/geo:asWKT ?geom .
      OPTIONAL { ?o osmkey:ele ?ele }
    }
    SPARQL;

/* Download
------------------------------------------------- */

if (isset($options['refresh']) || !is_file($csvPath) || filesize($csvPath) === 0) {
    echo 'Querying the OSM planet ... ';
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
            exit("\nTLS verification failed: {$error}\n"
                . "Set 'ca_bundle' in config.php - see README.md.\n");
        }
        exit("\nThe query failed (HTTP {$status}) {$error}\n");
    }

    printf("%.1f MB in %.1fs\n", filesize($csvPath) / 1048576, microtime(true) - $started);
} else {
    printf(
        "Using cached %s (%.1f MB) - pass --refresh to re-download.\n",
        basename($csvPath),
        filesize($csvPath) / 1048576
    );
}

/* Load
------------------------------------------------- */

$db = peaks_db($config['database']);
// The planet dump is complete in itself, so it replaces the table wholesale
// rather than merging into whatever happened to be there before.
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
    if (count($row) < 5 || !preg_match('~openstreetmap\.org/([a-z]+)/(\d+)~', $row[0], $reference)) {
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
        // Anything unexpected falls back to a summit, which is what the whole
        // table held before ranges were asked for.
        ':kind' => in_array($row[1], KINDS, true) ? $row[1] : 'peak',
    ]);

    // Commit in batches so a single transaction never grows unmanageable.
    if (++$loaded % 100000 === 0) {
        $db->commit();
        $db->beginTransaction();
    }
}
$db->commit();
fclose($handle);

$db->exec('CREATE INDEX IF NOT EXISTS peaks_lat_lon ON peaks (lat, lon)');
$db->exec('PRAGMA synchronous = NORMAL');
$db->exec('VACUUM');

if (!isset($options['keep-csv'])) {
    @unlink($csvPath);
}

printf("%d summits in %.1fs (%d skipped)\n", $loaded, microtime(true) - $started, $skipped);
printf(
    "Database holds %d features, %d with an elevation tag.\n",
    (int) $db->query('SELECT COUNT(*) FROM peaks')->fetchColumn(),
    (int) $db->query('SELECT COUNT(*) FROM peaks WHERE elevation IS NOT NULL')->fetchColumn()
);
foreach ($db->query('SELECT kind, COUNT(*) n FROM peaks GROUP BY kind ORDER BY n DESC') as $row) {
    printf("  %-16s %d
", $row['kind'], $row['n']);
}

/**
 * Mean of every coordinate pair in a WKT geometry.
 *
 * Almost every summit is a POINT, where this is simply the point itself. The
 * hundred-odd mapped as ways or relations get the average of their vertices,
 * which at the size of a summit is within metres of the middle.
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
