import { DestroyRef, inject, Injectable, signal } from '@angular/core';

/**
 * Sensors that are not the photo camera. A phone lists depth, infrared and
 * monochrome modules alongside it, and any of them satisfies a plain request for
 * the back camera — which is how the picture comes out grey.
 */
const NOT_A_CAMERA = /mono|infrar|\bir\b|depth|tof|time.?of.?flight/i;

/** Lenses that are the photo camera, but not the one a viewer expects. */
const SECONDARY = /ultra|tele|macro|zoom|fisheye/i;

/** Rear-facing, in the wordings the browsers use. */
const REAR = /back|rear|environment/i;

/**
 * The device camera, shown behind the landscape so the drawing can be held up
 * against the real skyline.
 */
@Injectable({ providedIn: 'root' })
export class CameraViewService {
	private readonly feed = signal<MediaStream | null>(null);

	/** Settled on once, then reused, so the picture does not change on reopening */
	private chosen: string | null = null;

	/** The live stream, or null while off */
	readonly stream = this.feed.asReadonly();

	constructor() {
		inject(DestroyRef).onDestroy(() => this.stop());
	}

	get supported(): boolean {
		return !!navigator.mediaDevices?.getUserMedia;
	}

	/** False with no camera, or permission refused */
	async start(): Promise<boolean> {
		if (this.feed()) {
			return true;
		}
		if (!this.supported) {
			return false;
		}

		try {
			const stream = await this.open(this.chosen);
			this.feed.set(stream);

			// Only now are the labels readable: a browser hides them until it has
			// been given permission, so the right camera cannot be picked first.
			if (!this.chosen) {
				await this.reopenOnBestCamera();
			}
			return true;
		} catch {
			return false;
		}
	}

	stop(): void {
		const stream = this.feed();
		if (!stream) {
			return;
		}
		for (const track of stream.getTracks()) {
			track.stop();
		}
		this.feed.set(null);
	}

	async toggle(): Promise<boolean> {
		if (this.feed()) {
			this.stop();
			return false;
		}
		return this.start();
	}

	private open(deviceId: string | null): Promise<MediaStream> {
		const video: MediaTrackConstraints = deviceId
			? { deviceId: { exact: deviceId } }
			: { facingMode: { ideal: 'environment' } };

		return navigator.mediaDevices.getUserMedia({
			video: { ...video, width: { ideal: 1920 }, height: { ideal: 1080 } },
			audio: false,
		});
	}

	/** Swaps to the photo camera where the browser handed us something else. */
	private async reopenOnBestCamera(): Promise<void> {
		const stream = this.feed();
		if (!stream) {
			return;
		}

		const current = stream.getVideoTracks()[0]?.getSettings().deviceId ?? null;
		const best = await bestRearCamera();
		this.chosen = best ?? current;

		if (!best || best === current) {
			return;
		}

		try {
			const better = await this.open(best);
			for (const track of stream.getTracks()) {
				track.stop();
			}
			this.feed.set(better);
		} catch {
			// Whatever we already have is better than nothing.
			this.chosen = current;
		}
	}
}

/**
 * The rear camera a viewer would take a photograph with.
 *
 * Judged by label, which is all a browser offers. Android numbers its modules
 * and the photo camera is the lowest of them; iOS names them outright, and the
 * plain "Back Camera" is the one. Anything that cannot see colour is dropped.
 */
async function bestRearCamera(): Promise<string | null> {
	if (!navigator.mediaDevices?.enumerateDevices) {
		return null;
	}

	const devices = await navigator.mediaDevices.enumerateDevices();
	const cameras = devices.filter((device) => device.kind === 'videoinput' && device.label);
	if (!cameras.length) {
		return null;
	}

	const rear = cameras.filter((device) => REAR.test(device.label));
	const usable = (rear.length ? rear : cameras).filter(
		(device) => !NOT_A_CAMERA.test(device.label),
	);
	if (!usable.length) {
		return null;
	}

	const ranked = [...usable].sort((a, b) => score(a.label) - score(b.label));
	return ranked[0].deviceId;
}

/** Lower is better. */
function score(label: string): number {
	const index = /(\d+)/.exec(label);
	return (SECONDARY.test(label) ? 100 : 0) + (index ? Number(index[1]) : 0);
}
