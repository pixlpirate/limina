import { inject, Pipe, PipeTransform } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

/** The sixteen points, spelled with whichever letters the language uses. */
const POINTS = [
	'n',
	'nne',
	'ne',
	'ene',
	'e',
	'ese',
	'se',
	'sse',
	's',
	'ssw',
	'sw',
	'wsw',
	'w',
	'wnw',
	'nw',
	'nnw',
];

/** Turns a bearing in degrees into a 16-point compass label. */
@Pipe({ name: 'bearing', pure: false })
export class BearingPipe implements PipeTransform {
	private readonly translate = inject(TranslateService);

	transform(degrees: number | null | undefined): string {
		if (degrees === null || degrees === undefined || !Number.isFinite(degrees)) {
			return '—';
		}
		const index = Math.round((((degrees % 360) + 360) % 360) / 22.5) % POINTS.length;
		return [...POINTS[index]]
			.map((letter) => this.translate.instant(`compass.points.${letter}`) as string)
			.join('');
	}
}
