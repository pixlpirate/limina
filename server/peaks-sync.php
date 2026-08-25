<?php
declare(strict_types=1);

/**
 * Imports named summits from OpenStreetMap into the local database.
 *
 *   php peaks-sync.php --bbox=5.5,44.0,11.5,48.0 --step=0.5
 *
 * The area is walked as a grid of small cells, because one big Overpass query
 * for a whole region is exactly what gets throttled. Each finished cell is
 * recorded, so re-running the same command resumes rather than starting over.
 *
 * This is a one-off job: summits do not move. Run it again only to widen the
 * area covered, or to pick up newer OSM edits.
 */

require __DIR__ . '/db.php';

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("This is a command line tool.\n");
}

$config = require __DIR__ . '/config.php';

$options = getopt('', ['bbox::', 'step::', 'sleep::', 'retries::', 'force', 'help']);

if (isset($options['help'])) {
    echo "Usage: php peaks-sync.php [options]\n\n"
        . "  --bbox=W,S,E,N   Area to import, in degrees. Default: the Alps.\n"
        . "  --step=0.5       Grid cell size in degrees. Smaller is slower but safer.\n"
        . "  --sleep=2        Seconds to wait between requests.\n"
        . "  --retries=5      Attempts per cell before giving up on it.\n"
        . "  --force          Re-import cells that were already done.\n";
    exit(0);
}

// Default area: the Alps, which is a sensible first import.
[$west, $south, $east, $north] = array_map(
    floatval(...),
    explode(',', (string) ($options['bbox'] ?? '5.0,43.5,16.0,48.0'))
);
$step = max(0.05, (float) ($options['step'] ?? 0.5));
$pause = max(0.0, (float) ($options['sleep'] ?? 2));
$retries = max(1, (int) ($options['retries'] ?? 5));
$force = isset($options['force']);

if ($west >= $east || $south >= $north) {
    exit("The bounding box must be W,S,E,N with W<E and S<N.\n");
}

$db = peaks_db($config['database']);
$endpoints = $config['overpass_endpoints'];
$caBundle = $config['ca_bundle'] ?? null;

$upsert = $db->prepare(
    'INSERT INTO peaks (id, name, lat, lon, elevation, kind)
          VALUES (:id, :name, :lat, :lon, :elevation, :kind)
     ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          lat = excluded.lat,
          lon = excluded.lon,
          elevation = excluded.elevation,
          kind = excluded.kind'
);
$markCell = $db->prepare(
    'INSERT INTO import_cells (cell, imported_at, found)
          VALUES (:cell, :at, :found)
     ON CONFLICT(cell) DO UPDATE SET imported_at = excluded.imported_at, found = excluded.found'
);
$cellDone = $db->prepare('SELECT 1 FROM import_cells WHERE cell = :cell');

/** Runs one Overpass query, rotating mirrors and backing off on rejection. */
function overpass(
    string $query,
    array $endpoints,
    int $retries,
    float $pause,
    ?string $caBundle
): ?array {
    for ($attempt = 0; $attempt < $retries; $attempt++) {
        $endpoint = $endpoints[$attempt % count($endpoints)];
        $handle = curl_init($endpoint);
        $curlOptions = [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => http_build_query(['data' => $query]),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 180,
            CURLOPT_USERAGENT => 'limina-peaks-import/1.0',
        ];
        if ($caBundle !== null) {
            $curlOptions[CURLOPT_CAINFO] = $caBundle;
        }
        curl_setopt_array($handle, $curlOptions);

        $body = curl_exec($handle);
        $errorNumber = curl_errno($handle);
        $errorText = curl_error($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        curl_close($handle);

        if ($status === 200 && is_string($body)) {
            $decoded = json_decode($body, true);
            if (is_array($decoded) && isset($decoded['elements'])) {
                return $decoded['elements'];
            }
        }

        // Retrying a certificate problem only wastes time; it will never pass.
        if ($errorNumber === CURLE_SSL_CACERT || $errorNumber === CURLE_PEER_FAILED_VERIFICATION) {
            fwrite(STDERR, "\n  TLS verification failed: {$errorText}\n");
            fwrite(STDERR, "  Set 'ca_bundle' in config.php - see README.md.\n");

            return null;
        }

        // 429 and 504 are the throttle and the overload; both want patience.
        $reason = $errorNumber !== 0 ? $errorText : "HTTP {$status}";
        $wait = $pause * (2 ** $attempt);
        fwrite(STDERR, sprintf(
            "  %s from %s, waiting %.0fs\n",
            $reason,
            (string) parse_url($endpoint, PHP_URL_HOST),
            $wait
        ));
        usleep((int) ($wait * 1000000));
    }

    return null;
}

/** OSM `ele` is usually plain metres, but stray units and commas turn up. */
function parse_elevation(?string $value): ?float
{
    if ($value === null || $value === '') {
        return null;
    }
    $metres = (float) str_replace(',', '.', trim($value));

    return is_finite($metres) && $metres > -500 && $metres < 9000 ? $metres : null;
}

// The epsilon matters: (7.2 - 6.6) / 0.3 lands just above 2 in binary floating
// point, and a bare ceil() would then add a whole column of zero-width cells,
// each costing a rate-limited request that can only return nothing.
$columns = max(1, (int) ceil((($east - $west) / $step) - 1e-9));
$rows = max(1, (int) ceil((($north - $south) / $step) - 1e-9));
$total = $columns * $rows;
printf(
    "Importing %d cells of %.2f deg over %.2f,%.2f..%.2f,%.2f\n",
    $total,
    $step,
    $west,
    $south,
    $east,
    $north
);

$seen = 0;
$skipped = 0;
$failed = [];
$index = 0;

for ($row = 0; $row < $rows; $row++) {
    for ($column = 0; $column < $columns; $column++) {
        $cellSouth = $south + $row * $step;
        $cellWest = $west + $column * $step;
        $cellNorth = min($cellSouth + $step, $north);
        $cellEast = min($cellWest + $step, $east);

        // Belt and braces against a sliver cell at the far edge of the grid.
        if ($cellEast - $cellWest < 1e-6 || $cellNorth - $cellSouth < 1e-6) {
            $total--;
            continue;
        }
        $index++;

        $cell = sprintf('%.4f,%.4f,%.4f,%.4f', $cellWest, $cellSouth, $cellEast, $cellNorth);

        if (!$force) {
            $cellDone->execute([':cell' => $cell]);
            if ($cellDone->fetchColumn() !== false) {
                $skipped++;
                continue;
            }
        }

        // Overpass takes bounding boxes as south,west,north,east.
        $query = sprintf(
            '[out:json][timeout:180];node["natural"~"^(peak|volcano)$"]["name"]'
                . '(%.4f,%.4f,%.4f,%.4f);out body;',
            $cellSouth,
            $cellWest,
            $cellNorth,
            $cellEast
        );

        printf("[%d/%d] %s ... ", $index, $total, $cell);
        $elements = overpass($query, $endpoints, $retries, $pause, $caBundle);

        if ($elements === null) {
            $failed[] = $cell;
            echo "failed\n";
            continue;
        }

        $db->beginTransaction();
        foreach ($elements as $element) {
            if (!isset($element['id'], $element['lat'], $element['lon'], $element['tags']['name'])) {
                continue;
            }
            $upsert->execute([
                ':id' => (int) $element['id'],
                ':name' => (string) $element['tags']['name'],
                ':lat' => (float) $element['lat'],
                ':lon' => (float) $element['lon'],
                ':elevation' => parse_elevation($element['tags']['ele'] ?? null),
                ':kind' => ($element['tags']['natural'] ?? 'peak') === 'volcano' ? 'volcano' : 'peak',
            ]);
        }
        $markCell->execute([
            ':cell' => $cell,
            ':at' => gmdate('c'),
            ':found' => count($elements),
        ]);
        $db->commit();

        $seen += count($elements);
        printf("%d summits\n", count($elements));
        usleep((int) ($pause * 1000000));
    }
}

$stored = (int) $db->query('SELECT COUNT(*) FROM peaks')->fetchColumn();
printf(
    "\nDone. %d summits seen, %d cells skipped, %d cells failed. Database holds %d summits.\n",
    $seen,
    $skipped,
    count($failed),
    $stored
);
if ($failed !== []) {
    echo "Re-run the same command to retry the failed cells.\n";
}
