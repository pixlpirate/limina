import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ToastService } from '@services';
import { statusIcon } from '@utils';

@Component({
	selector: 'app-toast-stack',
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './toast-stack.html',
	styleUrl: './toast-stack.scss',
})
export class ToastStack {
	protected readonly icon = statusIcon;
	private readonly toasts = inject(ToastService).toasts;

	protected readonly polite = computed(() => this.toasts().filter((toast) => !toast.assertive));
	protected readonly assertive = computed(() => this.toasts().filter((toast) => toast.assertive));
}
