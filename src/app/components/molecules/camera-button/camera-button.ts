import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { CameraViewService, ToastService } from '@services';

/** Shows the device camera behind the landscape, and hides it again. */
@Component({
	selector: 'app-camera-button',
	changeDetection: ChangeDetectionStrategy.OnPush,
	imports: [TranslatePipe],
	templateUrl: './camera-button.html',
	styleUrl: './camera-button.scss',
})
export class CameraButton {
	private readonly camera = inject(CameraViewService);
	private readonly toast = inject(ToastService);
	private readonly translate = inject(TranslateService);

	protected readonly showing = computed(() => this.camera.stream() !== null);

	protected async toggle(): Promise<void> {
		const wanted = !this.showing();
		const got = await this.camera.toggle();

		if (wanted && !got) {
			this.toast.show(this.translate.instant('landscape.cameraUnavailable'), {
				status: 'warning',
			});
		}
	}
}
