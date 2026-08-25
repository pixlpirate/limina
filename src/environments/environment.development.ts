import { defaults } from './environment.defaults';

/**
 * Local development overrides. Point these at wherever you are serving the PHP
 * API from — see server/README.md. The values below assume PHP's built-in
 * server started from inside `server/`:
 *
 *   php -S 127.0.0.1:8801 -t .
 */
export const environment = {
	...defaults,
	peaksApiUrl: 'http://127.0.0.1:8801/peaks.php',
	timezoneApiUrl: 'http://127.0.0.1:8801/timezone.php',
};
