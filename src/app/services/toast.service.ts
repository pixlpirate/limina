import { Injectable, signal, untracked } from '@angular/core';
import { Status, Toast } from '@interfaces';

const DEFAULT_DURATION = 2000;

export interface ToastOptions {
	/** Milliseconds before it clears; nothing stays */
	duration?: number;
	/** Interrupts screen readers */
	assertive?: boolean;
	/** Replaces any toast on the same channel */
	channel?: string;
	/** Status colour and icon */
	status?: Status;
	/** Shows a spinner beside the message */
	spinner?: boolean;
}

/** Transient centred messages, none dismissible */
@Injectable({ providedIn: 'root' })
export class ToastService {
	private readonly items = signal<Toast[]>([]);
	private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
	private nextId = 0;

	readonly toasts = this.items.asReadonly();

	show(message: string, options: ToastOptions = {}): void {
		const {
			duration = DEFAULT_DURATION,
			assertive = false,
			channel,
			status,
			spinner = false,
		} = options;

		if (channel !== undefined) {
			this.clearChannel(channel);
		}

		const id = this.nextId++;
		this.items.update((toasts) => [
			...toasts,
			{ id, message, assertive, channel, status, spinner },
		]);

		// A duration of nothing means it stays: something is still happening, and
		// only whatever started it knows when that stops.
		if (duration > 0) {
			this.timers.set(
				id,
				setTimeout(() => this.dismiss(id), duration),
			);
		}
	}

	dismiss(id: number): void {
		this.clearTimer(id);
		this.remove((toast) => toast.id !== id);
	}

	/** Clears a channel and its timer */
	clearChannel(channel: string): void {
		for (const toast of untracked(this.items)) {
			if (toast.channel === channel) {
				this.clearTimer(toast.id);
			}
		}
		this.remove((toast) => toast.channel !== channel);
	}

	private clearTimer(id: number): void {
		const timer = this.timers.get(id);
		if (timer !== undefined) {
			clearTimeout(timer);
			this.timers.delete(id);
		}
	}

	/**
	 * Keeps only the toasts `keep` accepts, and only touches the signal if that
	 * actually drops one. Filtering unconditionally would hand out a fresh array
	 * every time and wake everything reading it, which is enough on its own to
	 * spin an effect that both clears a channel and watches for the result.
	 */
	private remove(keep: (toast: Toast) => boolean): void {
		const toasts = untracked(this.items);
		const left = toasts.filter(keep);
		if (left.length !== toasts.length) {
			this.items.set(left);
		}
	}
}
