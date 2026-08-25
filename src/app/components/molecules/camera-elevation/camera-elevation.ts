import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { LengthPipe } from '@pipes';
import { CameraService, ToastService } from '@services';

/** Hold before repeating, in seconds */
const HOLD_DELAY = 0.35;
/** Units per second the moment repeating begins */
const START_RATE = 8;
/**
 * Seconds for that rate to multiply by e. Chosen so a long press covers the
 * whole range in about six seconds while a short one still moves gently.
 */
const RAMP_TAU = 0.9;
/** Toast update interval while held, in seconds */
const ANNOUNCE_EVERY = 0.1;

/** Raise and lower the viewpoint */
@Component({
	selector: 'app-camera-elevation',
	changeDetection: ChangeDetectionStrategy.OnPush,
	providers: [LengthPipe],
	imports: [TranslatePipe],
	templateUrl: './camera-elevation.html',
	styleUrl: './camera-elevation.scss',
})
export class CameraElevation {
	private readonly camera = inject(CameraService);
	private readonly toast = inject(ToastService);
	private readonly length = inject(LengthPipe);

	private frame = 0;
	private direction = 0;
	private pressedAt = 0;
	private lastFrame = 0;
	private announcedAt = 0;
	/** Fractional units carried between frames */
	private carried = 0;
	/** Altitude after the last move */
	private after = 0;

	constructor() {
		inject(DestroyRef).onDestroy(() => this.release());
	}

	protected press(direction: number, event: PointerEvent): void {
		(event.target as HTMLElement).setPointerCapture(event.pointerId);
		event.preventDefault();
		this.begin(direction);
	}

	/**
	 * Buttons are driven by pointer events, so keyboard activation is wired up separately rather
	 * than through the click that would otherwise fire twice.
	 */
	protected onKeyDown(direction: number, event: KeyboardEvent): void {
		if (event.key !== 'Enter' && event.key !== ' ') {
			return;
		}
		event.preventDefault();
		if (!event.repeat) {
			this.begin(direction);
		}
	}

	protected release(): void {
		if (!this.frame) {
			return;
		}
		cancelAnimationFrame(this.frame);
		this.frame = 0;
		this.announce();
	}

	private begin(direction: number): void {
		this.release();
		this.direction = direction;
		this.pressedAt = performance.now() / 1000;
		this.lastFrame = this.pressedAt;
		this.announcedAt = 0;
		this.carried = 0;
		this.shift(1, this.pressedAt);
		this.frame = requestAnimationFrame((time) => this.repeat(time));
	}

	private repeat(time: number): void {
		const now = time / 1000;
		const elapsed = Math.min(now - this.lastFrame, 0.1);
		this.lastFrame = now;

		const held = now - this.pressedAt - HOLD_DELAY;
		if (held > 0) {
			this.carried += START_RATE * Math.exp(held / RAMP_TAU) * elapsed;
			const whole = Math.floor(this.carried);
			if (whole >= 1) {
				this.carried -= whole;
				this.shift(whole, now);
			}
		}

		this.frame = requestAnimationFrame((next) => this.repeat(next));
	}

	private shift(units: number, now: number): void {
		const step = units * this.camera.heightStep();
		this.after = this.direction > 0 ? this.camera.raise(step) : this.camera.lower(step);

		if (now - this.announcedAt >= ANNOUNCE_EVERY) {
			this.announcedAt = now;
			this.announce();
		}
	}

	/**
	 * Repeating the same altitude would make a clamped button look broken, so say
	 * plainly when there is nowhere left to go.
	 */
	private announce(): void {
		const height = this.length.transform(this.after, 'altitude');
		this.toast.show(height, { channel: 'eye-altitude' });
	}
}
