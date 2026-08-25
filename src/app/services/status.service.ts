import { computed, Injectable, signal } from '@angular/core';
import { Status } from '@interfaces';

export interface StatusMessage {
	text: string;
	kind: Status;
	/** Milliseconds before it clears; zero stays */
	duration: number;
}

/** The line along the bottom of the landscape */
@Injectable({ providedIn: 'root' })
export class StatusService {
	private readonly current = signal<StatusMessage | null>(null);
	private timer: ReturnType<typeof setTimeout> | null = null;

	readonly message = this.current.asReadonly();
	readonly kind = computed(() => this.current()?.kind ?? 'info');

	show(text: string, kind: Status = 'info', duration = 4000): void {
		this.clearTimer();
		this.current.set({ text, kind, duration });

		if (duration > 0) {
			this.timer = setTimeout(() => this.current.set(null), duration);
		}
	}

	/** A message that stands until replaced */
	hold(text: string, kind: Status = 'info'): void {
		this.show(text, kind, 0);
	}

	clear(): void {
		this.clearTimer();
		this.current.set(null);
	}

	private clearTimer(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}
}
