import { Status } from './status.interface';

export interface Toast {
	id: number;
	message: string;
	/** Status colour and icon */
	status?: Status;
	/** Shows a spinner beside the message */
	spinner?: boolean;
	/** Politeness of the live region announcement */
	assertive: boolean;
	/**
	 * Optional channel. A new toast on a channel replaces the one already there,
	 * so repeated presses of the same control never stack up.
	 */
	channel?: string;
}
