import { ChangeDetectionStrategy, Component, ElementRef, inject, viewChild } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { MenuService } from '@services';

@Component({
	selector: 'app-menu-button',
	changeDetection: ChangeDetectionStrategy.OnPush,
	imports: [TranslatePipe],
	templateUrl: './menu-button.html',
	styleUrl: './menu-button.scss',
})
export class MenuButton {
	private readonly menu = inject(MenuService);
	private readonly button = viewChild.required<ElementRef<HTMLButtonElement>>('button');

	protected readonly open = this.menu.open;

	protected toggle(): void {
		this.menu.toggle(this.button().nativeElement);
	}
}
