import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { DataWarningService, MenuService } from '@services';
import { filter, map } from 'rxjs';

import {
	CameraElevation,
	CompassGizmo,
	ConditionsDrawer,
	LocateButton,
	MapButton,
	CameraButton,
	MenuButton,
	MenuPane,
	Modal,
	StatusBar,
	ToastStack,
} from '../../molecules';
import { TerrainView } from '../../organisms/terrain-view/terrain-view';

/**
 * Shell for the whole app: the landscape stays mounted underneath while routed
 * screens come and go on top of it.
 */
@Component({
	selector: 'app-root',
	changeDetection: ChangeDetectionStrategy.OnPush,
	imports: [
		RouterOutlet,
		TerrainView,
		CameraButton,
		MenuButton,
		MenuPane,
		StatusBar,
		CameraElevation,
		CompassGizmo,
		ConditionsDrawer,
		Modal,
		LocateButton,
		MapButton,
		ToastStack,
	],
	templateUrl: './app.html',
	styleUrl: './app.scss',
})
export class App {
	private readonly router = inject(Router);

	private readonly url = toSignal(
		this.router.events.pipe(
			filter((event): event is NavigationEnd => event instanceof NavigationEnd),
			map((event) => event.urlAfterRedirects),
		),
		{ initialValue: this.router.url },
	);

	/**
	 * True with nothing routed on top. While a screen is open its own back arrow
	 * stands in the same corner, so two controls would otherwise overlap there.
	 */
	protected readonly onLandscape = computed(() => this.url() === '/');

	constructor() {
		void inject(DataWarningService).settle();

		const menu = inject(MenuService);
		effect(() => {
			if (this.onLandscape()) {
				menu.resume();
			}
		});
	}
}
