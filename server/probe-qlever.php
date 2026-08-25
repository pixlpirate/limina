<?php
$ca = __DIR__ . '/data/windows-roots.pem';
$sparql = 'PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
SELECT ?name ?ele ?geom WHERE {
  ?o osmkey:natural "peak" .
  ?o osmkey:name ?name .
  ?o geo:hasGeometry/geo:asWKT ?geom .
  OPTIONAL { ?o osmkey:ele ?ele }
} LIMIT 5';

$url = 'https://qlever.cs.uni-freiburg.de/api/osm-planet?query=' . urlencode($sparql);
$h = curl_init($url);
curl_setopt_array($h, [
    CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 120, CURLOPT_CAINFO => $ca,
    CURLOPT_HTTPHEADER => ['Accept: text/csv'], CURLOPT_USERAGENT => 'limina/1.0',
]);
$body = curl_exec($h);
printf("status=%d err=%s\n", (int) curl_getinfo($h, CURLINFO_RESPONSE_CODE), curl_error($h));
echo substr((string) $body, 0, 700), "\n";
