import {
	ChangeDetectionStrategy,
	Component,
	ElementRef,
	effect,
	inject,
	viewChildren,
} from '@angular/core';
import { ModalService } from '@services';
import { statusIcon } from '@utils';

/** The one place a modal is drawn */
@Component({
	selector: 'app-modal',
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './modal.html',
	styleUrl: './modal.scss',
	host: {
		'(document:keydown.escape)': 'dismiss()',
	},
})
export class Modal {
	protected readonly icon = statusIcon;
	private readonly modal = inject(ModalService);
	private readonly choices = viewChildren<ElementRef<HTMLButtonElement>>('choice');

	protected readonly request = this.modal.pending;
	protected readonly remembered = this.modal.remembered;

	constructor() {
		effect(() => {
			if (this.request()) {
				this.choices()[0]?.nativeElement.focus();
			}
		});
	}

	protected answer(id: string): void {
		this.modal.answer(id);
	}

	protected dismiss(): void {
		this.modal.dismiss();
	}
}
