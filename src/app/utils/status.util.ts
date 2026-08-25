import { Status } from '@interfaces';

/** The icon for a status */
export function statusIcon(status: Status | undefined): string {
	switch (status) {
		case 'success':
			return 'icon-circle-check';
		case 'warning':
			return 'icon-circle-exclamation';
		case 'danger':
			return 'icon-circle-xmark';
		default:
			return 'icon-circle-info';
	}
}
