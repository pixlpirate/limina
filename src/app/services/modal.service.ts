import { inject, Injectable, signal } from '@angular/core';
import { Status } from '@interfaces';
import { TranslateService } from '@ngx-translate/core';

/** One choice offered by a modal */
export interface ModalAction {
	/** Returned by `open` when this one is taken */
	id: string;
	/** Translation key for the wording on the button */
	label: string;
	/** Marks the destructive choice */
	danger?: boolean;
}

/** A modal's wording, as translation keys */
export interface ModalRequest {
	title: string;
	status?: Status;
	message: string;
	actions: ModalAction[];
	/** Taken on Escape or a backdrop click */
	dismissId: string;
	/** Key for an optional tick box */
	remember?: string;
	/** Placeholder values */
	params?: Record<string, unknown>;
}

/** The action taken, and the tick box */
export interface ModalOutcome {
	action: string;
	remembered: boolean;
}

/** Modal dialogs, rendered in one place */
@Injectable({ providedIn: 'root' })
export class ModalService {
	private readonly translate = inject(TranslateService);

	private readonly request = signal<ModalRequest | null>(null);
	private settle: ((outcome: ModalOutcome) => void) | null = null;

	readonly pending = this.request.asReadonly();
	/** State of the tick box while a modal is open */
	readonly remembered = signal(false);

	/** Resolves with the action and the tick box */
	open(request: ModalRequest): Promise<ModalOutcome> {
		this.settle?.({ action: this.request()?.dismissId ?? '', remembered: false });
		this.remembered.set(false);
		this.request.set(this.render(request));

		return new Promise<ModalOutcome>((resolve) => {
			this.settle = resolve;
		});
	}

	/** A question with one way to go through with it */
	async confirm(
		message: string,
		params: Record<string, unknown> = {},
		action = 'modal.delete',
		title = 'modal.confirm',
	): Promise<boolean> {
		const taken = await this.open({
			title,
			message,
			params,
			dismissId: 'cancel',
			actions: [
				{ id: 'cancel', label: 'modal.cancel' },
				{ id: 'confirm', label: action, danger: true },
			],
		});
		return taken.action === 'confirm';
	}

	/** Translates the keys a caller handed over */
	private render(request: ModalRequest): ModalRequest {
		const say = (key: string) => this.translate.instant(key, request.params) as string;
		return {
			...request,
			title: say(request.title),
			message: say(request.message),
			remember: request.remember ? say(request.remember) : undefined,
			actions: request.actions.map((action) => ({ ...action, label: say(action.label) })),
		};
	}

	answer(id: string): void {
		const remembered = this.remembered();
		this.request.set(null);
		this.settle?.({ action: id, remembered });
		this.settle = null;
	}

	dismiss(): void {
		const request = this.request();
		if (request) {
			this.answer(request.dismissId);
		}
	}
}
