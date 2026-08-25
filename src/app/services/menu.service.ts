import { Injectable, signal } from '@angular/core';

/**
 * Open state of the navigation pane, shared by the button that opens it and the
 * pane itself so neither has to reach for the other.
 */
@Injectable({ providedIn: 'root' })
export class MenuService {
	private readonly opened = signal(false);
	/** Element to hand focus back to when the pane closes. */
	private trigger: HTMLElement | null = null;
	/** Set when the pane was closed only to get out of its own way. */
	private resumeOnReturn = false;

	readonly open = this.opened.asReadonly();

	toggle(trigger: HTMLElement): void {
		this.trigger = trigger;
		this.resumeOnReturn = false;
		this.opened.update((open) => !open);
	}

	/** Stands the pane down while a screen is showing, remembering that it was up. */
	stepAside(): void {
		this.resumeOnReturn = this.opened();
		this.opened.set(false);
	}

	/** Drops any claim on coming back. */
	forget(): void {
		this.resumeOnReturn = false;
	}

	/** Called on returning to the landscape. */
	resume(): void {
		if (this.resumeOnReturn) {
			this.resumeOnReturn = false;
			this.opened.set(true);
		}
	}

	close(): void {
		this.resumeOnReturn = false;
		this.opened.set(false);
		this.trigger?.focus();
	}
}
