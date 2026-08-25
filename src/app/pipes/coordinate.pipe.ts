import { inject, Pipe, PipeTransform } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

export type CoordinateAxis = 'lat' | 'lon';

/** Renders a decimal degree the way coordinates are normally written: `51°30'26.64"N`. */
@Pipe({ name: 'coordinate', pure: false })
export class CoordinatePipe implements PipeTransform {
	private readonly translate = inject(TranslateService);

	transform(value: number | null | undefined, axis: CoordinateAxis): string {
		if (value === null || value === undefined || !Number.isFinite(value)) {
			return '—';
		}

		const point = axis === 'lat' ? (value < 0 ? 's' : 'n') : value < 0 ? 'w' : 'e';
		const hemisphere = this.translate.instant(`compass.points.${point}`) as string;
		const absolute = Math.abs(value);
		const degrees = Math.floor(absolute);
		const minutesTotal = (absolute - degrees) * 60;
		const minutes = Math.floor(minutesTotal);
		const seconds = ((minutesTotal - minutes) * 60).toFixed(2);

		return `${degrees}°${minutes}'${seconds}"${hemisphere}`;
	}
}
