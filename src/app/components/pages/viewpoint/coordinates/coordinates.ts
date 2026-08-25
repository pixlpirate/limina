import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MenuService, ToastService, ViewpointService } from '@services';
import { isValidLat, isValidLon } from '@utils';

import { NumberField, Panel } from '../../../molecules';

/**
 * Coordinates as they are read aloud: a hemisphere, then degrees, minutes and
 * seconds. The other screen takes the same place as one signed number.
 */
@Component({
	selector: 'app-viewpoint-coordinates',
	changeDetection: ChangeDetectionStrategy.OnPush,
	imports: [NumberField, Panel, ReactiveFormsModule, TranslatePipe],
	templateUrl: './coordinates.html',
	styleUrl: './coordinates.scss',
})
export class ViewpointCoordinates {
	private readonly viewpoint = inject(ViewpointService);
	private readonly toast = inject(ToastService);
	private readonly router = inject(Router);
	private readonly menu = inject(MenuService);
	private readonly translate = inject(TranslateService);

	protected readonly form = inject(FormBuilder).nonNullable.group({
		latitudeSign: ['N' as 'N' | 'S'],
		latDegrees: [0, [Validators.required, Validators.min(0), Validators.max(90)]],
		latMinutes: [0, [Validators.required, Validators.min(0), Validators.max(59)]],
		latSeconds: [0, [Validators.required, Validators.min(0), Validators.max(59.999)]],
		longitudeSign: ['E' as 'E' | 'W'],
		lonDegrees: [0, [Validators.required, Validators.min(0), Validators.max(180)]],
		lonMinutes: [0, [Validators.required, Validators.min(0), Validators.max(59)]],
		lonSeconds: [0, [Validators.required, Validators.min(0), Validators.max(59.999)]],
	});

	constructor() {
		const { lat, lon } = this.viewpoint.position();
		const latitude = split(lat);
		const longitude = split(lon);

		this.form.setValue({
			latitudeSign: lat < 0 ? 'S' : 'N',
			latDegrees: latitude.degrees,
			latMinutes: latitude.minutes,
			latSeconds: latitude.seconds,
			longitudeSign: lon < 0 ? 'W' : 'E',
			lonDegrees: longitude.degrees,
			lonMinutes: longitude.minutes,
			lonSeconds: longitude.seconds,
		});
	}

	protected flyTo(): void {
		if (this.form.invalid) {
			this.form.markAllAsTouched();
			return;
		}

		const value = this.form.getRawValue();
		const lat =
			combine(value.latDegrees, value.latMinutes, value.latSeconds) *
			(value.latitudeSign === 'S' ? -1 : 1);
		const lon =
			combine(value.lonDegrees, value.lonMinutes, value.lonSeconds) *
			(value.longitudeSign === 'W' ? -1 : 1);

		if (!isValidLat(lat) || !isValidLon(lon)) {
			this.toast.show(this.translate.instant('coordinates.outOfRange'), {
				assertive: true,
			});
			return;
		}

		this.menu.forget();
		this.viewpoint.moveTo({ lat, lon }, 'coordinates');
		void this.router.navigate(['/']);
	}
}

/** Decimal degrees into degrees, minutes and seconds */
function split(value: number): { degrees: number; minutes: number; seconds: number } {
	const absolute = Math.abs(value);
	let degrees = Math.floor(absolute);
	const minutesTotal = (absolute - degrees) * 60;
	let minutes = Math.floor(minutesTotal);
	let seconds = Math.round((minutesTotal - minutes) * 60 * 100) / 100;

	// Rounding to two decimals can land on a whole minute, and floating point
	// gets there on its own: 6.1 degrees comes out as 5.9999... minutes. Carrying
	// is what stops it reading 6° 5' 60".
	if (seconds >= 60) {
		seconds -= 60;
		minutes += 1;
	}
	if (minutes >= 60) {
		minutes -= 60;
		degrees += 1;
	}

	return { degrees, minutes, seconds };
}

function combine(degrees: number, minutes: number, seconds: number): number {
	return degrees + minutes / 60 + seconds / 3600;
}
