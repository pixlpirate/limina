import {
	ChangeDetectionStrategy,
	Component,
	ElementRef,
	effect,
	inject,
	linkedSignal,
	viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { MenuService } from '@services';
import { filter, map } from 'rxjs';

/**
 * Full-height navigation pane down the left edge. Not modal — the landscape
 * behind it stays live — so it only manages its own focus rather than trapping it.
 */
@Component({
	selector: 'app-menu-pane',
	changeDetection: ChangeDetectionStrategy.OnPush,
	imports: [TranslatePipe, RouterLink, RouterLinkActive],
	templateUrl: './menu-pane.html',
	styleUrl: './menu-pane.scss',
	host: {
		'(keydown.escape)': 'close()',
	},
})
export class MenuPane {
	private readonly menu = inject(MenuService);
	private readonly router = inject(Router);
	private readonly firstLink = viewChild<ElementRef<HTMLElement>>('firstLink');

	protected readonly open = this.menu.open;

	private readonly url = toSignal(
		this.router.events.pipe(
			filter((event): event is NavigationEnd => event instanceof NavigationEnd),
			map((event) => event.urlAfterRedirects),
		),
		{ initialValue: this.router.url },
	);

	/**
	 * Open on arrival when one of its screens is already showing, and free to be
	 * opened or closed by hand from there.
	 */
	protected readonly viewpointOpen = linkedSignal(() => this.url().startsWith('/viewpoint'));

	constructor() {
		effect(() => {
			if (this.open()) {
				this.firstLink()?.nativeElement.focus();
			}
		});
	}

	protected toggleViewpoint(): void {
		this.viewpointOpen.update((open) => !open);
	}

	/** Following a link only stands the pane aside; coming back restores it. */
	protected leave(): void {
		this.menu.stepAside();
	}

	protected close(): void {
		this.menu.close();
	}
}
