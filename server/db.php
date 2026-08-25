<?php
declare(strict_types=1);

/**
 * Opens the peaks database, creating the schema on first use.
 *
 * Ids are OSM references like `node/26863417`. They are text rather than
 * integers because a handful of summits are mapped as ways or relations, whose
 * ids share a numbering space with nodes and would otherwise collide.
 *
 * There is no R*Tree module in every PHP SQLite build, so proximity queries run
 * off a plain (lat, lon) index and a bounding box. At the scale of OSM's summit
 * data that is comfortably fast.
 */
function peaks_db(string $path): PDO
{
    $directory = dirname($path);
    if (!is_dir($directory) && !mkdir($directory, 0o777, true) && !is_dir($directory)) {
        throw new RuntimeException('Cannot create the database directory.');
    }

    $db = new PDO('sqlite:' . $path, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);

    $db->exec('PRAGMA journal_mode = WAL');
    $db->exec('PRAGMA synchronous = NORMAL');
    $db->exec(
        'CREATE TABLE IF NOT EXISTS peaks (
            id        TEXT PRIMARY KEY,
            name      TEXT NOT NULL,
            lat       REAL NOT NULL,
            lon       REAL NOT NULL,
            elevation REAL,
            kind      TEXT NOT NULL DEFAULT \'peak\'
        )'
    );
    $db->exec('CREATE INDEX IF NOT EXISTS peaks_lat_lon ON peaks (lat, lon)');

    // Translated names, kept apart because hardly any summit has one: fewer than
    // one in fourteen carries even an English name, so columns on `peaks` would
    // be mostly empty. Keyed by language so a lookup touches only the one asked
    // for.
    $db->exec(
        'CREATE TABLE IF NOT EXISTS peak_names (
            id   TEXT NOT NULL,
            lang TEXT NOT NULL,
            name TEXT NOT NULL,
            PRIMARY KEY (id, lang)
        ) WITHOUT ROWID'
    );

    return $db;
}
