# Summit database and API

A small read-only PHP service that answers "which named summits are within
_n_ metres of this point?", plus a companion endpoint for the civil timezone at
a point. Both are used by the Limina web app.

Summit data comes from OpenStreetMap. It is loaded once into a local SQLite
file and served from there, so the app never queries a public API at runtime.

```
server/
  config.php        settings: database path, CORS origins, limits, endpoint
  db.php            opens the database and creates the schema on first use
  world-peaks.php   command line loader: every named summit on Earth
  peaks.php         the summit API
  timezone.php      the timezone API
  data/             SQLite file and downloads (not committed)
```

## Requirements

- PHP 8.1 or newer, with the `pdo_sqlite`, `curl` and `json` extensions
- About 200 MB of free disk space
- Any web server that can run PHP, or PHP's built-in server for local use

Check the extensions with:

```bash
php -m | grep -E "pdo_sqlite|curl|json"
```

## 1. Configure

Open `config.php`. Every value is safe to edit and none of it is secret.

| Setting            | Purpose                                                        |
| ------------------ | -------------------------------------------------------------- |
| `database`         | Where the SQLite file is written. Created on first load.         |
| `allowed_origins`  | Browser origins allowed to call the API. `['*']` while developing. |
| `max_radius`       | Largest radius a single request may ask for, in metres.          |
| `max_results`      | Most summits a single response may contain.                      |
| `ca_bundle`        | Certificate bundle for the download step. `null` uses PHP's own. |
| `sparql_endpoint`  | SPARQL service holding the OSM planet.                           |

For a public deployment, set `allowed_origins` to the exact origin of your app
rather than leaving it at `*`.

## 2. Load the summit database

From inside the `server` directory:

```bash
php world-peaks.php
```

This downloads one CSV of every named summit and landform on Earth and writes
it to SQLite. Expect roughly 760,000 rows, a 265 MB download, and about 86 MB on
disk. It takes well under a minute on a reasonable connection.

Translated names are fetched at the same time, into a `peak_names` table keyed
by summit and language. The languages asked for are listed in `LANGUAGES` at the
top of `world-peaks.php`; add or remove one there and re-run the loader.

Options:

| Flag         | Effect                                              |
| ------------ | --------------------------------------------------- |
| `--refresh`  | Re-download even when a cached CSV is present.       |
| `--keep-csv` | Leave the downloaded CSV in `data/` afterwards.      |
| `--help`     | Print usage and exit.                                |

The query asks for `natural=peak`, `volcano`, `mountain_range`, `ridge` and
`hill`, plus named regions, which is where massif names are usually tagged.
Summits mapped as ways or relations are reduced to the mean of their vertices.
Around a quarter of summits carry no `ele` tag; those rows store no elevation,
and the app samples its own elevation data instead.

Re-run the same command whenever you want fresher data. It is safe to run over
an existing database.

## 3. Serve it

Point any PHP-capable web server at this directory. For a quick local check:

```bash
php -S 127.0.0.1:8801 -t .
```

Then:

```
http://127.0.0.1:8801/peaks.php?lat=45.8786&lon=6.8874&radius=20000
```

## 4. Point the app at it

The Angular app reads the two endpoint URLs from
`src/environments/environment.defaults.ts`:

```ts
peaksApiUrl: 'api/peaks.php',
timezoneApiUrl: 'api/timezone.php',
```

These are relative by default, which assumes the server directory is published
as `api/` alongside the built app. Change them to absolute URLs if you host the
API somewhere else.

## API reference

### `GET peaks.php`

| Parameter | Required | Meaning                                   |
| --------- | -------- | ----------------------------------------- |
| `lat`     | yes      | Latitude, −90 to 90                       |
| `lon`     | yes      | Longitude, −180 to 180                    |
| `radius`  | yes      | Metres, capped at `max_radius`            |
| `lang`    | no       | Two-letter code, for translated names     |

```json
{
  "peaks": [
    {
      "id": "node/26863417",
      "name": "Aiguille du Midi",
      "lat": 45.8788,
      "lon": 6.8873,
      "elevation": 3842,
      "kind": "peak",
      "distance": 16
    }
  ]
}
```

Results are nearest first, trimmed to a true circle, and capped at
`max_results`. `elevation` is `null` where OSM has no value. Ids are OSM
references such as `node/…` or `way/…`, because those id spaces overlap and
bare numbers would collide.

`lang` returns the `name:xx` OpenStreetMap carries for a summit, falling back to
its local name — so `lang=fr` gives `Cervin` for the Matterhorn but leaves the
Aiguille du Midi alone. An unknown code is ignored rather than refused.
Translations are sparse by nature: of 760,000 features, about 81,000 carry one,
and English is the best served at 46,000. For most mountains the local name is
the only name there is, which is usually the one you want anyway.

Indicative timings against the full planet database, in dense terrain:

| Radius | Peaks returned | Time   | With `lang` |
| ------ | -------------- | ------ | ----------- |
| 20 km  | 406            | 35 ms  | 41 ms       |
| 60 km  | 3,353          | 18 ms  | 31 ms       |
| 200 km | 5,000 (capped) | 379 ms | 395 ms      |

### `GET timezone.php`

| Parameter | Required | Meaning                |
| --------- | -------- | ---------------------- |
| `lat`     | yes      | Latitude, −90 to 90    |
| `lon`     | yes      | Longitude, −180 to 180 |

```json
{ "timezone": "Europe/Paris", "offset": 7200, "exact": true }
```

By default the answer comes from PHP's own timezone database by matching the
nearest of its representative points. That is correct for most of the world but
can pick the wrong zone near a border, and the response reports
`"exact": false`.

For exact answers, add real zone boundaries as `data/timezones.geojson`:

```bash
curl -L -o data/timezones.zip \
  https://github.com/evansiroky/timezone-boundary-builder/releases/latest/download/timezones-1970.geojson.zip
unzip -p data/timezones.zip combined.json > data/timezones.geojson
rm data/timezones.zip
```

The endpoint uses the file automatically when present and reports
`"exact": true`. It is about 100 MB unpacked and is not committed. It is never
sent to the browser; the app requests a point and caches the small answer.

### Errors

| Status | Meaning                                     |
| ------ | ------------------------------------------- |
| `400`  | A parameter is missing or out of range       |
| `503`  | The database has not been loaded yet         |

Both return a JSON body with an `error` field.

## Troubleshooting

**`503` from `peaks.php`.** The database does not exist yet. Run
`php world-peaks.php`.

**Empty results everywhere.** Confirm the load actually finished:

```bash
php -r '$db = new PDO("sqlite:data/peaks.sqlite"); echo $db->query("SELECT COUNT(*) FROM peaks")->fetchColumn(), PHP_EOL;'
```

**`unable to get local issuer certificate` during the load.** PHP's curl cannot
verify the download because the trust chain it is configured with does not
contain the issuing root, which happens where a proxy or security product
terminates TLS. Point `ca_bundle` in `config.php` at a bundle that includes that
root, then re-run the loader.

**CORS errors in the browser.** Add the app's exact origin to
`allowed_origins` in `config.php`.

## Notes on the data

- Summits do not move, so the database only needs refreshing when you want
  newly mapped peaks or corrected names.
- `data/` holds generated files only. Everything in it can be deleted and
  rebuilt by re-running the loader.
