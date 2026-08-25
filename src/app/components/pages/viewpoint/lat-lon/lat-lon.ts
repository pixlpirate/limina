import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MenuService, ToastService, ViewpointService } from '@services';
import { isValidLat, isValidLon } from '@utils';

import { NumberField, Panel } from '../../../molecules';

/**
 * Plain signed degrees, the form coordinates are usually copied in. The other
 * screen splits the sign out into hemisphere switches instead.
 */
@Component({
	selector: 'app-viewpoint-lat-lon',
	changeDetection: ChangeDetectionStrategy.OnPush,
	imports: [NumberField, Panel, ReactiveFormsModule, TranslatePipe],
	templateUrl: './lat-lon.html',
	styleUrl: './lat-lon.scss',
})
export class ViewpointLatLon {
	private readonly viewpoint = inject(ViewpointService);
	private readonly toast = inject(ToastService);
	private readonly router = inject(Router);
	private readonly menu = inject(MenuService);
	private readonly translate = inject(TranslateService);

	protected readonly form = inject(FormBuilder).nonNullable.group({
		lat: [0, [Validators.required, Validators.min(-90), Validators.max(90)]],
		lon: [0, [Validators.required, Validators.min(-180), Validators.max(180)]],
	});

	constructor() {
		this.form.setValue(this.viewpoint.position());
	}

	protected flyTo(): void {
		if (this.form.invalid) {
			this.form.markAllAsTouched();
			return;
		}

		const { lat, lon } = this.form.getRawValue();
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
