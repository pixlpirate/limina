import {
	ChangeDetectionStrategy,
	Component,
	ElementRef,
	afterNextRender,
	input,
	viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

/** Shell for the routed screens that sit on top of the landscape. */
@Component({
	selector: 'app-panel',
	changeDetection: ChangeDetectionStrategy.OnPush,
	imports: [RouterLink, TranslatePipe],
	templateUrl: './panel.html',
	styleUrl: './panel.scss',
})
export class Panel {
	readonly heading = input.required<string>();
	/** Drops the body padding, for a screen that runs to its own edges. */
	readonly flush = input(false);
	/** Stands the content in the middle, for a screen that is one small form. */
	readonly centred = input(false);

	private readonly headingElement = viewChild.required<ElementRef<HTMLElement>>('title');

	constructor() {
		afterNextRender(() => this.headingElement().nativeElement.focus({ preventScroll: true }));
	}
}
