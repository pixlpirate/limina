import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { statusIcon } from '@utils';
import { StatusService } from '@services';

/**
 * The one line along the bottom of the landscape: what the app is waiting on, or why it could
 * not do something.
 */
@Component({
	selector: 'app-status-bar',
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './status-bar.html',
	styleUrl: './status-bar.scss',
})
export class StatusBar {
	protected readonly icon = statusIcon;
	protected readonly message = inject(StatusService).message;
}
