<?php
$ca = __DIR__ . '/data/windows-roots.pem';

function head(string $url, string $ca): array {
    $h = curl_init($url);
    curl_setopt_array($h, [
        CURLOPT_NOBODY => true, CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 40,
        CURLOPT_CAINFO => $ca, CURLOPT_USERAGENT => 'limina/1.0',
    ]);
    curl_exec($h);
    $r = [
        'status' => (int) curl_getinfo($h, CURLINFO_RESPONSE_CODE),
        'bytes'  => (float) curl_getinfo($h, CURLINFO_CONTENT_LENGTH_DOWNLOAD),
        'err'    => curl_error($h),
    ];
    curl_close($h);
    return $r;
}

foreach ([
    'geonames allCountries' => 'https://download.geonames.org/export/dump/allCountries.zip',
    'geonames readme'       => 'https://download.geonames.org/export/dump/readme.txt',
    'qlever osm-planet'     => 'https://qlever.cs.uni-freiburg.de/api/osm-planet',
] as $label => $url) {
    $r = head($url, $ca);
    printf("%-24s status=%-4d size=%-12s %s\n", $label, $r['status'],
        $r['bytes'] > 0 ? round($r['bytes'] / 1048576, 1) . ' MB' : '-', $r['err']);
}
