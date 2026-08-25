import { inject, Injectable, signal } from '@angular/core';

import { ModalService } from './modal.service';

const STORAGE_KEY = 'limina.dataWarning';

/** Connection types that cost nothing to use. Anything else is worth a word. */
const UNMETERED = ['wifi', 'ethernet', 'none'];

/**
 * Holds the app back until the viewer has agreed to spend the data, on a connection where that
 * is worth asking about.
 */
@Injectable({ providedIn: 'root' })
export class DataWarningService {
	private readonly modal = inject(ModalService);

	/**
	 * False until the question is settled. Everything that fetches reads this, so
	 * nothing is downloaded behind the modal.
	 */
	readonly permitted = signal(false);

	/** Asked once at startup, and only where the answer could be no. */
	async settle(): Promise<void> {
		if (!this.shouldAsk()) {
			this.permitted.set(true);
			return;
		}

		const outcome = await this.modal.open({
			title: 'dataWarning.title',
			status: 'warning',
			message: 'dataWarning.message',
			dismissId: 'continue',
			remember: 'dataWarning.remember',
			actions: [{ id: 'continue', label: 'modal.continue' }],
		});

		if (outcome.remembered) {
			try {
				localStorage.setItem(STORAGE_KEY, 'silenced');
			} catch {}
		}
		this.permitted.set(true);
	}

	/** Anywhere the connection is metered, or not known to be otherwise. */
	private shouldAsk(): boolean {
		try {
			if (localStorage.getItem(STORAGE_KEY)) {
				return false;
			}
		} catch {
			return false;
		}

		const connection = (
			navigator as Navigator & {
				connection?: { type?: string; effectiveType?: string; saveData?: boolean };
			}
		).connection;
		if (!connection || connection.saveData) {
			return true;
		}

		if (connection.type && connection.type !== 'unknown') {
			return !UNMETERED.includes(connection.type);
		}

		if (!connection.effectiveType) {
			return true;
		}
		return connection.effectiveType === '2g' || connection.effectiveType === '3g';
	}
}
