import {
	ChangeDetectionStrategy,
	Component,
	computed,
	DestroyRef,
	ElementRef,
	forwardRef,
	inject,
	input,
	signal,
	viewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/** Hold before repeating, in seconds */
const HOLD_DELAY = 0.4;
/** Steps per second the moment repeating begins */
const START_RATE = 6;
/** Seconds for the repeat rate to multiply by e */
const RAMP_TAU = 1.1;

/**
 * A custom number field with steppers
 */
@Component({
	selector: 'app-number-field',
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './number-field.html',
	styleUrl: './number-field.scss',
	providers: [
		{
			provide: NG_VALUE_ACCESSOR,
			useExisting: forwardRef(() => NumberField),
			multi: true,
		},
	],
})
export class NumberField implements ControlValueAccessor {
	readonly min = input<number>();
	readonly max = input<number>();
	/** Amount one press moves the value by */
	readonly step = input(1);
	/** Minimum width, in figures */
	readonly minWidth = input(2);
	/** Fills the width it is given instead of sizing to the figures in it */
	readonly fill = input(false);
	/**
	 * Named for assistive technology, since what shows beside the box is a unit
	 * mark rather than a word. Already translated by the caller.
	 */
	readonly label = input('');

	private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

	protected readonly value = signal<number | null>(null);
	protected readonly disabled = signal(false);

	/** Text currently in the box */
	private readonly text = signal('');

	/**
	 * What the box is told to show. Only ever set from outside — a write from the
	 * form, or a stepper — and never while typing.
	 *
	 * Binding the parsed number back would undo the typing as it happens: `7.`
	 * parses to `7`, so the moment the decimal point is typed it is written back
	 * out of the box again and no fractional value can ever be entered.
	 */
	protected readonly display = signal('');

	/**
	 * Figures the box is drawn to hold. A number input takes no `size`, so the
	 * width is measured off the text and handed to the stylesheet.
	 */
	protected readonly width = computed(() => Math.max(this.minWidth(), this.text().length));

	private frame = 0;
	private direction = 0;
	private pressedAt = 0;
	private lastFrame = 0;
	/** Fractional steps carried between frames */
	private carried = 0;

	private onChange: (value: number | null) => void = () => {};
	private onTouched: () => void = () => {};

	constructor() {
		inject(DestroyRef).onDestroy(() => this.release());
	}

	writeValue(value: number | null): void {
		const shown = value === null || value === undefined ? '' : String(value);
		this.value.set(value ?? null);
		this.text.set(shown);
		this.display.set(shown);
	}

	registerOnChange(fn: (value: number | null) => void): void {
		this.onChange = fn;
	}

	registerOnTouched(fn: () => void): void {
		this.onTouched = fn;
	}

	setDisabledState(disabled: boolean): void {
		this.disabled.set(disabled);
	}

	protected onInput(event: Event): void {
		const field = event.target as HTMLInputElement;
		const raw = field.value;
		const next = raw === '' ? null : Number(raw);
		this.value.set(next !== null && Number.isFinite(next) ? next : null);

		// A number input reports an empty value for anything it cannot parse, and
		// half a decimal — `42.` — is exactly that. The box still shows those
		// characters, so measuring the width from the empty string would snap it
		// shut between one keystroke and the next.
		if (raw !== '' || !field.validity.badInput) {
			this.text.set(raw);
		}
		this.onChange(this.value());
	}

	protected onBlur(): void {
		this.onTouched();
	}

	protected press(direction: number, event: PointerEvent): void {
		(event.target as HTMLElement).setPointerCapture(event.pointerId);
		event.preventDefault();
		this.begin(direction);
	}

	/**
	 * Steppers are driven by pointer events, so keyboard activation is wired up separately rather
	 * than through a click that would fire twice.
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
	}

	private begin(direction: number): void {
		this.release();
		this.direction = direction;
		this.pressedAt = performance.now() / 1000;
		this.lastFrame = this.pressedAt;
		this.carried = 0;
		this.shift(1);
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
				this.shift(whole);
			}
		}

		this.frame = requestAnimationFrame((next) => this.repeat(next));
	}

	private shift(steps: number): void {
		const step = this.step();
		const min = this.min();
		const max = this.max();

		let next = (this.value() ?? 0) + this.direction * steps * step;
		next = Math.round(next / step) * step;
		if (min !== undefined) {
			next = Math.max(next, min);
		}
		if (max !== undefined) {
			next = Math.min(next, max);
		}

		this.value.set(next);
		this.text.set(String(next));
		this.display.set(String(next));
		this.field().nativeElement.value = String(next);
		this.onChange(next);
	}
}
