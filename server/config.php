<?php
declare(strict_types=1);

/**
 * Deployment settings for the peaks API. Everything here is safe to edit by
 * hand; nothing in it is secret.
 */
return [
    // SQLite file holding the imported summits. Created on first import.
    'database' => __DIR__ . '/data/peaks.sqlite',

    // Browser origins allowed to call the API. The Angular dev server moves
    // between ports, so list the ones you actually use, or '*' while developing.
    'allowed_origins' => ['*'],

    // Guard rails for a single request.
    'max_radius' => 200000,   // metres
    'max_results' => 5000,

    // Certificate bundle curl should verify the SPARQL endpoint against. Leave
    // null to use whatever PHP is configured with. Where antivirus or a corporate
    // proxy intercepts HTTPS, PHP's own bundle will not contain that interception
    // root and every request fails with "unable to get local issuer certificate";
    // point this at a bundle that does. See README.md.
    'ca_bundle' => is_file(__DIR__ . '/data/windows-roots.pem')
        ? __DIR__ . '/data/windows-roots.pem'
        : null,

    // SPARQL engine holding the OSM planet, queried once by peaks-world.php.
    'sparql_endpoint' => 'https://qlever.dev/api/osm-planet',
];
