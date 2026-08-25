import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { DEG } from '@utils';

/** Milliseconds to wait for a first reading */
const FIRST_READING_TIMEOUT = 1500;

/** Share of each new reading that is taken */
const SMOOTHING = 0.15;

/** Degrees a reading must differ by to count */
const DEADBAND = 0.75;

/** Horizontal length below which the phone is flat */
const FLAT_BELOW = 0.35;

/** iOS gates the sensor behind a prompt */
interface PermissionCapableDeviceOrientation {
	requestPermission?: () => Promise<'granted' | 'denied' | 'default'>;
}

/** A bearing and an elevation, sensor frame */
interface Reading {
	yaw: number;
	pitch: number;
}

/**
 * Which way the phone is pointed.
 *
 * Relative, never magnetic. The compass proved unreliable, so zero is simply
 * wherever the view was looking when following began and everything is measured
 * from there.
 */
@Injectable({ providedIn: 'root' })
export class OrientationService {
	private readonly value = signal<number | null>(null);
	private readonly tilt = signal<number | null>(null);
	private readonly active = signal(false);
	private listener: ((event: DeviceOrientationEvent) => void) | null = null;

	/** Added to every reading, for the view's frame */
	private offset = 0;
	private anchored = false;
	private anchorYaw = 0;

	/** Degrees clockwise, null until a reading arrives */
	readonly heading = this.value.asReadonly();
	/** Degrees above the horizon, null until a reading */
	readonly pitch = this.tilt.asReadonly();
	readonly listening = this.active.asReadonly();

	constructor() {
		inject(DestroyRef).onDestroy(() => this.stop());
	}

	get supported(): boolean {
		return typeof globalThis.DeviceOrientationEvent !== 'undefined';
	}

	/**
	 * False when the sensor is missing, permission was refused, or nothing reports
	 * in. `anchorYaw` is where the view points now, which the first reading is
	 * pinned to so the landscape does not jump.
	 */
	async start(anchorYaw = 0): Promise<boolean> {
		if (!this.supported) {
			return false;
		}
		if (this.active()) {
			return true;
		}

		const orientation =
			globalThis.DeviceOrientationEvent as unknown as PermissionCapableDeviceOrientation;
		if (typeof orientation.requestPermission === 'function') {
			try {
				if ((await orientation.requestPermission()) !== 'granted') {
					return false;
				}
			} catch {
				return false;
			}
		}

		this.anchorYaw = anchorYaw;
		this.anchored = false;

		const firstReading = new Promise<boolean>((resolve) => {
			const timer = setTimeout(() => resolve(false), FIRST_READING_TIMEOUT);

			this.listener = (event) => {
				const reading = readOrientation(event);
				if (!reading) {
					return;
				}

				if (!this.anchored) {
					this.offset = this.anchorYaw - reading.yaw;
					this.anchored = true;
				}

				const heading = (reading.yaw + this.offset + 360) % 360;
				this.value.update((previous) => settleAngle(previous, heading));
				this.tilt.update((previous) => settle(previous, reading.pitch));
				clearTimeout(timer);
				resolve(true);
			};
		});

		globalThis.addEventListener('deviceorientation', this.listener as EventListener);

		if (!(await firstReading)) {
			this.stop();
			return false;
		}

		this.active.set(true);
		return true;
	}

	stop(): void {
		if (this.listener) {
			globalThis.removeEventListener('deviceorientation', this.listener as EventListener);
			this.listener = null;
		}
		this.active.set(false);
		this.anchored = false;
		this.value.set(null);
		this.tilt.set(null);
	}
}

/** Eases a plain angle towards a new one */
function settle(previous: number | null, next: number): number {
	if (previous === null) {
		return next;
	}
	if (Math.abs(next - previous) < DEADBAND) {
		return previous;
	}
	return previous + (next - previous) * SMOOTHING;
}

/** Eases a bearing the short way round */
function settleAngle(previous: number | null, heading: number): number {
	if (previous === null) {
		return heading;
	}

	const delta = ((heading - previous + 540) % 360) - 180;
	if (Math.abs(delta) < DEADBAND) {
		return previous;
	}
	return (previous + delta * SMOOTHING + 360) % 360;
}

/**
 * Bearing and elevation of the phone's back, where you are looking.
 *
 * Alpha alone will not do: it turns about the screen's normal, which only reads
 * as a bearing while the phone lies flat. Composing all three angles gives the
 * rotation into the world, and both figures come off that one direction so they
 * stay consistent however it is turned or tipped. The top edge is faded in as
 * the back runs out of horizontal length, for the phone held flat.
 */
function readOrientation(event: DeviceOrientationEvent): Reading | null {
	const { alpha, beta, gamma } = event;
	if (alpha === null || !Number.isFinite(alpha)) {
		return null;
	}

	const ca = Math.cos(alpha * DEG);
	const sa = Math.sin(alpha * DEG);
	const cb = Math.cos((beta ?? 0) * DEG);
	const sb = Math.sin((beta ?? 0) * DEG);
	const cg = Math.cos((gamma ?? 0) * DEG);
	const sg = Math.sin((gamma ?? 0) * DEG);

	const backEast = -(ca * sg + sa * sb * cg);
	const backNorth = -(sa * sg - ca * sb * cg);
	const backUp = -(cb * cg);

	const screenAngle = globalThis.screen?.orientation?.angle ?? 0;
	const cs = Math.cos(screenAngle * DEG);
	const ss = Math.sin(screenAngle * DEG);
	const upEast = -ss * (ca * cg - sa * sb * sg) + cs * -(sa * cb);
	const upNorth = -ss * (sa * cg + ca * sb * sg) + cs * (ca * cb);

	const flatness = Math.max(0, (FLAT_BELOW - Math.hypot(backEast, backNorth)) / FLAT_BELOW);
	const east = backEast + upEast * flatness;
	const north = backNorth + upNorth * flatness;
	if (east === 0 && north === 0) {
		return null;
	}

	return {
		yaw: (Math.atan2(east, north) / DEG + 360) % 360,
		pitch: Math.asin(Math.max(-1, Math.min(1, backUp))) / DEG,
	};
}
