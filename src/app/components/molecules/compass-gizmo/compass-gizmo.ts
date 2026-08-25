import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { CameraService, OrientationService, StatusService } from '@services';

/**
 * Compass in the top corner, and the switch between dragging and letting the phone's compass
 * steer.
 */
@Component({
	selector: 'app-compass-gizmo',
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './compass-gizmo.html',
	styleUrl: './compass-gizmo.scss',
})
export class CompassGizmo {
	private readonly camera = inject(CameraService);
	private readonly orientation = inject(OrientationService);
	private readonly status = inject(StatusService);
	private readonly translate = inject(TranslateService);

	protected readonly following = this.camera.followCompass;

	/**
	 * Negated: the needle holds still against the ground while the view swings
	 * around it, which is how a compass behaves in the hand.
	 */
	protected readonly rotation = computed(() => -this.camera.yaw());

	protected readonly label = computed(() => {
		this.translate.currentLang();
		return this.translate.instant(this.following() ? 'compass.following' : 'compass.manual');
	});

	protected async toggle(): Promise<void> {
		const wanted = !this.following();
		const got = await this.camera.setFollowCompass(wanted);

		if (wanted && !got) {
			this.status.show(
				this.translate.instant(
					this.orientation.supported ? 'compass.noReading' : 'compass.unsupported',
				),
				'warning',
			);
		}
	}
}
