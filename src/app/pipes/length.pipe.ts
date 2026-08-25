import { inject, Pipe, PipeTransform } from '@angular/core';
import { SettingsService } from '@services';

const FEET_PER_METRE = 3.280839895;
const FEET_PER_MILE = 5280;

export type LengthKind = 'altitude' | 'distance';

/** Formats a length in metres using the unit the user picked in settings. */
@Pipe({ name: 'length' })
export class LengthPipe implements PipeTransform {
	private readonly settings = inject(SettingsService);

	transform(metres: number | null | undefined, kind: LengthKind = 'altitude'): string {
		if (metres === null || metres === undefined || !Number.isFinite(metres)) {
			return '—';
		}

		if (this.settings.units() === 'imperial') {
			const feet = metres * FEET_PER_METRE;
			return kind === 'distance' && feet >= FEET_PER_MILE
				? `${round(feet / FEET_PER_MILE, 1)} mi`
				: `${round(feet, 0)} ft`;
		}

		return kind === 'distance' && metres >= 1000
			? `${round(metres / 1000, 1)} km`
			: `${round(metres, 0)} m`;
	}
}

function round(value: number, decimals: number): string {
	return value.toFixed(decimals);
}
