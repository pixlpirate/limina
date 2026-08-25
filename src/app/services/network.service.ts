import { DestroyRef, inject, Injectable, signal } from '@angular/core';

/** Whether the browser can reach the network */
@Injectable({ providedIn: 'root' })
export class NetworkService {
	private readonly reachable = signal(navigator.onLine !== false);

	readonly online = this.reachable.asReadonly();

	constructor() {
		const update = () => this.reachable.set(navigator.onLine !== false);
		globalThis.addEventListener('online', update);
		globalThis.addEventListener('offline', update);

		inject(DestroyRef).onDestroy(() => {
			globalThis.removeEventListener('online', update);
			globalThis.removeEventListener('offline', update);
		});
	}
}
