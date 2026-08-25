import { computed, effect, inject, Injectable, linkedSignal, signal } from '@angular/core';
import { CameraPose } from '@interfaces';
import { clamp } from '@utils';

import { OrientationService } from './orientation.service';
import { SettingsService } from './settings.service';
import { TerrainService } from './terrain.service';
import { ViewpointService } from './viewpoint.service';

/** Eye height above the ground, in metres */
const EYE_LEVEL = 2;
const MIN_EYE_HEIGHT = EYE_LEVEL;
const MAX_EYE_HEIGHT = 8000;
const METRES_PER_FOOT = 0.3048;

const MIN_PITCH = -60;
const MAX_PITCH = 60;
const STORAGE_KEY = 'limina.camera';

/** Stillness before saving, in milliseconds */
const SAVE_DELAY = 500;

const MIN_FOV = 15;
const MAX_FOV = 90;
/** Easing time constant, in seconds */
const EASE_TAU = 0.09;

/** Eases an angle the short way round */
function approachAngle(from: number, to: number, factor: number): number {
	let delta = ((to - from + 540) % 360) - 180;
	return (from + delta * factor + 360) % 360;
}

/** Where the viewer looks from and towards */
@Injectable({ providedIn: 'root' })
export class CameraService {
	private readonly terrain = inject(TerrainService);
	private readonly viewpoint = inject(ViewpointService);
	private readonly orientation = inject(OrientationService);
	private readonly settings = inject(SettingsService);

	private readonly restored = restore();

	/** Where the view is being pointed */
	private readonly targetYaw = signal(this.restored.yaw);
	private readonly targetPitch = signal(this.restored.pitch);

	/** Where the view has got to */
	readonly yaw = signal(this.restored.yaw);
	readonly pitch = signal(this.restored.pitch);
	readonly fov = signal(this.restored.fov);

	private saveTimer: ReturnType<typeof setTimeout> | null = null;

	/** Whether the device is steering */
	readonly followCompass = signal(false);

	/** Manual offset on the device heading, in degrees */
	private readonly panOffset = signal(0);

	/**
	 * Arriving somewhere new puts the viewer back on the ground, at eye level.
	 * Any height they had climbed to belongs to the viewpoint they left.
	 */
	readonly eyeHeight = linkedSignal({
		source: () => this.viewpoint.position(),
		computation: () => EYE_LEVEL,
	});

	/** Eye altitude above sea level, in metres */
	readonly altitude = computed(() => this.terrain.ground() + this.eyeHeight());

	/**
	 * One notch of the elevation buttons, in metres: a single unit of whatever
	 * heights are being read in, so one press moves the figure by exactly one.
	 */
	readonly heightStep = computed(() =>
		this.settings.units() === 'imperial' ? METRES_PER_FOOT : 1,
	);

	readonly pose = computed<CameraPose>(() => ({
		yaw: this.yaw(),
		pitch: this.pitch(),
		fov: this.fov(),
		altitude: this.altitude(),
	}));

	constructor() {
		// After the view settles, not on the way: easing retimes both angles every
		// frame and local storage is synchronous.
		effect(() => {
			const view: StoredCamera = { yaw: this.yaw(), pitch: this.pitch(), fov: this.fov() };
			if (this.saveTimer !== null) {
				clearTimeout(this.saveTimer);
			}
			this.saveTimer = setTimeout(() => {
				try {
					localStorage.setItem(STORAGE_KEY, JSON.stringify(view));
				} catch {}
			}, SAVE_DELAY);
		});
	}

	/**
	 * Drag deltas in degrees. While the device is steering, a sideways drag moves
	 * the offset it is measured from rather than the view itself, so turning on
	 * the spot still works and the landscape can be lined up with it by hand.
	 * Tilting is the device's alone.
	 */
	turn(deltaYaw: number, deltaPitch: number): void {
		if (this.followCompass()) {
			this.panOffset.update((offset) => (offset + deltaYaw + 360) % 360);
			return;
		}

		this.targetYaw.update((yaw) => (yaw + deltaYaw + 360) % 360);
		this.targetPitch.update((pitch) => clamp(pitch + deltaPitch, MIN_PITCH, MAX_PITCH));
	}

	/**
	 * Points the view at a bearing, and at an elevation angle when one is given.
	 * Eased like any other turn, so the landscape swings round rather than jumps.
	 */
	lookAt(bearing: number, pitch?: number): void {
		if (this.followCompass()) {
			void this.setFollowCompass(false);
		}

		this.targetYaw.set(((bearing % 360) + 360) % 360);
		if (pitch !== undefined) {
			this.targetPitch.set(clamp(pitch, MIN_PITCH, MAX_PITCH));
		}
	}

	/**
	 * Eases the view towards where it is pointed. Driven by the render loop, so
	 * the rate is tied to elapsed time rather than to frame rate.
	 */
	advance(seconds: number): void {
		if (this.followCompass()) {
			const heading = this.orientation.heading();
			if (heading !== null) {
				this.targetYaw.set((heading + this.panOffset() + 360) % 360);
			}

			// Clamped like any other tilt, so pointing the phone at your feet
			// stops where dragging would.
			const pitch = this.orientation.pitch();
			if (pitch !== null) {
				this.targetPitch.set(clamp(pitch, MIN_PITCH, MAX_PITCH));
			}
		}

		const factor = 1 - Math.exp(-Math.max(seconds, 0) / EASE_TAU);
		this.yaw.update((yaw) => approachAngle(yaw, this.targetYaw(), factor));
		this.pitch.update((pitch) => pitch + (this.targetPitch() - pitch) * factor);
	}

	/** Turns device steering on, asking for the sensor */
	async setFollowCompass(follow: boolean): Promise<boolean> {
		this.panOffset.set(0);
		if (!follow) {
			this.followCompass.set(false);
			this.orientation.stop();
			return false;
		}

		// With no compass, readings hang off where the view already looks.
		const started = await this.orientation.start(this.targetYaw());
		this.followCompass.set(started);
		return started;
	}

	zoom(deltaFov: number): void {
		this.fov.update((fov) => clamp(fov + deltaFov, MIN_FOV, MAX_FOV));
	}

	/** Sets the zoom outright, for a pinch */
	setFov(fov: number): void {
		this.fov.set(clamp(fov, MIN_FOV, MAX_FOV));
	}

	/** Raises the eye by `step` metres */
	raise(step = this.heightStep()): number {
		return this.shift(step);
	}

	lower(step = this.heightStep()): number {
		return this.shift(-step);
	}

	private shift(delta: number): number {
		this.eyeHeight.update((height) => clamp(height + delta, MIN_EYE_HEIGHT, MAX_EYE_HEIGHT));
		return this.altitude();
	}
}

/** The bearing, tilt and zoom last looked at */
interface StoredCamera {
	yaw: number;
	pitch: number;
	fov: number;
}

const DEFAULT_CAMERA: StoredCamera = { yaw: 0, pitch: 0, fov: 55 };

/** The stored view, clamped */
function restore(): StoredCamera {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) {
			return DEFAULT_CAMERA;
		}
		const stored = { ...DEFAULT_CAMERA, ...(JSON.parse(raw) as Partial<StoredCamera>) };
		if (![stored.yaw, stored.pitch, stored.fov].every(Number.isFinite)) {
			return DEFAULT_CAMERA;
		}
		return {
			yaw: ((stored.yaw % 360) + 360) % 360,
			pitch: clamp(stored.pitch, MIN_PITCH, MAX_PITCH),
			fov: clamp(stored.fov, MIN_FOV, MAX_FOV),
		};
	} catch {
		return DEFAULT_CAMERA;
	}
}
