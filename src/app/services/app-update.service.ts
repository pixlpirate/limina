import { inject, Injectable } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';

import { ModalService } from './modal.service';

/**
 * Offers a new version once the worker has one ready. The download has already
 * happened by then; the running app carries on until the reload is agreed to.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
	private readonly updates = inject(SwUpdate);
	private readonly modal = inject(ModalService);
	private asking = false;

	watch(): void {
		if (!this.updates.isEnabled) {
			return;
		}

		this.updates.versionUpdates
			.pipe(filter((event): event is VersionReadyEvent => event.type === 'VERSION_READY'))
			.subscribe(() => void this.offer());
	}

	private async offer(): Promise<void> {
		if (this.asking) {
			return;
		}
		this.asking = true;

		try {
			const taken = await this.modal.open({
				title: 'update.title',
				status: 'info',
				message: 'update.message',
				dismissId: 'later',
				actions: [
					{ id: 'later', label: 'update.later' },
					{ id: 'install', label: 'update.install' },
				],
			});

			if (taken.action === 'install') {
				await this.updates.activateUpdate();
				globalThis.location.reload();
			}
		} catch {
			// A worker that will not activate is no reason to break the app.
		} finally {
			this.asking = false;
		}
	}
}
