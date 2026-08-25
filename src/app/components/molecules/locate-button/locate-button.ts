import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { GeolocationService, ToastService, ViewpointService } from '@services';

@Component({
	selector: 'app-locate-button',
	changeDetection: ChangeDetectionStrategy.OnPush,
	imports: [TranslatePipe],
	templateUrl: './locate-button.html',
	styleUrl: './locate-button.scss',
})
export class LocateButton {
	private readonly translate = inject(TranslateService);
	private readonly geolocation = inject(GeolocationService);
	private readonly viewpoint = inject(ViewpointService);
	private readonly toast = inject(ToastService);

	protected readonly locating = this.geolocation.locating;

	protected async locate(): Promise<void> {
		try {
			const here = await this.geolocation.locate();
			this.viewpoint.moveTo(here, 'gps', this.translate.instant('landscape.myPosition'));
		} catch (error) {
			this.toast.show((error as Error).message, { assertive: true, duration: 4000 });
		}
	}
}
