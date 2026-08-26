import {
	afterNextRender,
	ChangeDetectionStrategy,
	Component,
	computed,
	DestroyRef,
	effect,
	ElementRef,
	inject,
	signal,
	untracked,
	viewChild,
} from '@angular/core';
import { firstHitAcross, RENDER_STYLE, TerrainRenderer } from '@gl';
import { isLandform, LatLon, LightSource, PeakKind } from '@interfaces';
import { TranslateService } from '@ngx-translate/core';
import { LengthPipe } from '@pipes';
import {
	BookmarksService,
	CameraService,
	CameraViewService,
	PeaksService,
	SettingsService,
	SkyService,
	StatusService,
	TerrainService,
	TimezoneService,
	ToastService,
} from '@services';
import { clamp, skyDirection } from '@utils';

/** A rise or set time, placed on the skyline */
interface SkyLabel {
	id: string;
	text: string;
	x: number;
	y: number;
	colour: string;
	/** Marked by the horizon rather than the ground */
	horizon: boolean;
}

/** A summit name and its leader line */
interface PeakLabel {
	id: string;
	name: string;
	/** Kind, for styling */
	kind: LabelKind;
	/** Icon before the name */
	icon: string;
	/** Height beside the name */
	detail: string;
	/**
	 * Horizontal position of the name and its leader, in CSS pixels. Never eased:
	 * the leader is vertical, so any lag here would swing its foot off the summit.
	 */
	x: number;
	/** Eased vertical position of the name */
	textY: number;
	/** Leader length down to the summit */
	leader: number;
	/** Fades up once the edge passes the summit */
	opacity: number;
}

/** Icon shown before the name, by kind */
type LabelKind = PeakKind | 'bookmark';

/** Anything that can carry a name */
interface Markable {
	id: string;
	name: string;
	kind: LabelKind;
	detail: string;
	east: number;
	north: number;
	up: number;
}

const ICONS: Partial<Record<LabelKind, string>> = {
	bookmark: 'icon-bookmark',
	mountain_range: 'icon-mountain',
	ridge: 'icon-mountain',
	hill: 'icon-mound',
	region: 'icon-location-pin',
	volcano: 'icon-volcano',
};

/** A point dropped on the ground */
interface Probe {
	id: string;
	east: number;
	north: number;
	up: number;
	label: string;
	/** Expiry, on the render loop's clock */
	expires: number;
}

interface ProbeMark {
	id: string;
	label: string;
	x: number;
	y: number;
}

/** Swipe turn, as a multiple of a mouse drag */
const TOUCH_GAIN = 3;

/** Milliseconds a dropped point stays up */
const PROBE_LIFE = 2000;
/**
 * Pixels the pointer may wander and still count as a click. A finger never
 * lands perfectly still, and a mouse rarely does either.
 */
const DRAG_SLOP = 4;

/**
 * Distance whose pacing is pinned, in metres, and the seconds the edge takes to
 * cross it. Paced by distance rather than by a total time, so the near ground
 * opens at one speed whatever the visibility is set to.
 */
const REVEAL_REACH = 5_000;
const REVEAL_SECONDS = 2;
/** Radius grows as this power of time */
const REVEAL_POWER = 5;
/**
 * Width of the wash behind the edge: a share of how far it has got, and a floor
 * in metres, so it keeps its width on screen as the circle widens.
 */
const TRAIL_FRACTION = 0.35;
const TRAIL_MIN = 400;
/** Kilometres over which the wash thins away */
const TRAIL_FADE_KM = 1;
/** Metres over which a name fades up */
const LABEL_ARRIVAL = 2_000;
/** Seconds for names and tracks to arrive */
const OVERLAY_SECONDS = 0.5;
/** Seconds to wait for the remaining rasters */
const REVEAL_WAIT = 6;

const MAX_LABELS = 40;
/** Name band height, as a fraction of the canvas */
const BAND_FRACTION = 0.33;
/** Shortest leader worth drawing, in pixels */
const MIN_LEADER = 16;
/**
 * Horizontal breathing room between names, in CSS pixels. Diagonal names climb
 * away from each other, so they need far less room than level ones would.
 */
const LABEL_GUARD = 30;
/** Easing time constant for a name, in seconds */
const LABEL_TAU = 0.07;

@Component({
	selector: 'app-terrain-view',
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './terrain-view.html',
	styleUrl: './terrain-view.scss',
	providers: [LengthPipe],
})
export class TerrainView {
	private readonly terrain = inject(TerrainService);
	private readonly camera = inject(CameraService);
	private readonly cameraView = inject(CameraViewService);
	private readonly settings = inject(SettingsService);
	private readonly peaks = inject(PeaksService);
	private readonly sky = inject(SkyService);
	private readonly marks = inject(BookmarksService);
	private readonly status = inject(StatusService);
	private readonly toast = inject(ToastService);
	private readonly timezone = inject(TimezoneService);
	private readonly translate = inject(TranslateService);

	private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
	private readonly renderer = signal<TerrainRenderer | null>(null);
	private readonly startupError = signal<string | null>(null);

	private readonly length = inject(LengthPipe);

	private frame = 0;
	private lastTime = 0;
	/** Seconds since the ground arrived, negative while none */
	private revealed = -1;
	/** Viewpoint the ground on screen belongs to */
	private revealOrigin: LatLon | null = null;
	/** Seconds spent waiting for the rest of the ground */
	private waited = 0;
	/** How far the opening edge has got, in metres */
	private revealRadius = Number.POSITIVE_INFINITY;
	private dragPointer: number | null = null;
	private lastX = 0;
	private lastY = 0;
	/** Pointer travel since it went down, in pixels */
	private dragged = 0;
	/** Fingers currently on the canvas */
	private readonly pointers = new Map<number, { x: number; y: number }>();
	/** Finger gap and zoom when the pinch began */
	private pinch: { span: number; fov: number } | null = null;

	/** Points dropped on the landscape */
	private readonly probes = signal<Probe[]>([]);

	/**
	 * How far the sky tracks have arrived, nought to one. Names follow the edge
	 * out instead; the tracks have no distance to grow along.
	 */
	protected readonly overlay = signal(1);

	/** Eased name heights, by label id */
	private readonly easedPeaks = new Map<string, number>();

	protected readonly cameraStream = this.cameraView.stream;
	protected readonly labelSize = this.settings.labelSize;
	protected readonly loading = this.terrain.loading;

	protected readonly skyLabels = signal<SkyLabel[]>([], { equal: sameSkyLabels });

	protected readonly labels = signal<PeakLabel[]>([], { equal: sameLabels });

	/** Whether a pointer is turning the view */
	protected readonly dragging = signal(false);

	/** Screen position of each dropped point */
	protected readonly probeMarks = signal<ProbeMark[]>([], { equal: sameProbeMarks });

	protected readonly error = computed(
		() => this.startupError() ?? this.terrain.error()?.message ?? this.peaks.error()?.message,
	);

	protected readonly description = computed(() => {
		this.translate.currentLang();
		const count = this.peaks.visiblePeaks().length;
		return this.translate.instant('landscape.description', { count });
	});

	constructor() {
		afterNextRender(() => this.start());

		effect(() => {
			const failure = this.error();
			if (failure) {
				this.status.hold(this.translate.instant(failure), 'danger');
			} else {
				this.status.clear();
			}
		});

		effect(() => {
			const loading = this.loading();
			// Only the flag is watched: both branches write the toast list, which
			// would otherwise wake this effect again.
			untracked(() => {
				if (loading) {
					this.toast.show(this.translate.instant('landscape.loading'), {
						channel: 'terrain',
						duration: 0,
						spinner: true,
					});
				} else {
					this.toast.clearChannel('terrain');
				}
			});
		});

		effect(() => {
			const rings = this.terrain.rings();
			const renderer = this.renderer();
			if (rings.length && renderer) {
				renderer.setRings(rings);
			}
		});
		effect(() => this.renderer()?.setMaxRadius(this.settings.visibility()));
		effect(() => this.renderer()?.setPassthrough(this.cameraStream() !== null));
		effect(() =>
			this.renderer()?.setStyle({
				...RENDER_STYLE,
				outlineWidth: this.settings.outlineWidth(),
			}),
		);
		effect(() => this.renderer()?.setSky(this.sky.state()));

		inject(DestroyRef).onDestroy(() => {
			cancelAnimationFrame(this.frame);
			this.renderer()?.dispose();
		});
	}

	/**
	 * Moves the arrival on by `seconds`. Nothing shows until there is ground to
	 * show, so the camera being lifted clear of the hillside happens unseen.
	 */
	private advanceReveal(renderer: TerrainRenderer, seconds: number): void {
		const rings = this.terrain.rings();
		const origin = rings.length ? rings[0].origin : null;

		if (!origin) {
			this.revealed = -1;
			this.revealOrigin = null;
			this.revealRadius = 0;
			renderer.setReveal(0, 0, TRAIL_MIN, 1);
			this.overlay.set(0);
			return;
		}

		// Keyed on the ground, not the viewpoint: old rasters stay mounted until
		// the new ones land, so the origin changes only once they have.
		if (
			!this.revealOrigin ||
			this.revealOrigin.lat !== origin.lat ||
			this.revealOrigin.lon !== origin.lon
		) {
			this.revealOrigin = origin;
			this.revealed = -1;
			this.waited = 0;
		}

		// Only before it begins: rasters reload whenever the viewpoint moves, and
		// one landing later must not blank ground already shown.
		if (this.revealed < 0) {
			this.waited += seconds;
			if (this.loading() && this.waited < REVEAL_WAIT) {
				this.revealRadius = 0;
				renderer.setReveal(0, 0, TRAIL_MIN, 1);
				this.overlay.set(0);
				return;
			}
			this.revealed = 0;
		}

		this.revealed += seconds;

		const visibility = this.settings.visibility();
		const radius = REVEAL_REACH * Math.pow(this.revealed / REVEAL_SECONDS, REVEAL_POWER);

		const done = REVEAL_SECONDS * Math.pow(visibility / REVEAL_REACH, 1 / REVEAL_POWER);
		const after = Math.max(this.revealed - done, 0);
		const overlay = Math.min(after / OVERLAY_SECONDS, 1);

		this.revealRadius = Math.min(radius, visibility);
		renderer.setReveal(
			this.revealRadius,
			overlay,
			Math.max(this.revealRadius * TRAIL_FRACTION, TRAIL_MIN),
			clamp((visibility - this.revealRadius) / (TRAIL_FADE_KM * 1_000), 0, 1),
		);
		this.overlay.set(overlay);
	}

	protected onPointerDown(event: PointerEvent): void {
		this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		(event.target as HTMLElement).setPointerCapture(event.pointerId);

		if (this.pointers.size === 2) {
			this.pinch = { span: this.pinchSpan(), fov: this.camera.fov() };
			this.dragPointer = null;
			this.dragging.set(false);
			return;
		}
		if (this.pointers.size > 2) {
			return;
		}

		this.dragPointer = event.pointerId;
		this.lastX = event.clientX;
		this.lastY = event.clientY;
		this.dragged = 0;
		this.dragging.set(true);
	}

	protected onPointerMove(event: PointerEvent): void {
		const tracked = this.pointers.get(event.pointerId);
		if (tracked) {
			tracked.x = event.clientX;
			tracked.y = event.clientY;
		}

		if (this.pinch) {
			const span = this.pinchSpan();
			if (span > 0) {
				this.camera.setFov((this.pinch.fov * this.pinch.span) / span);
			}
			return;
		}

		if (this.dragPointer !== event.pointerId) {
			return;
		}
		const element = this.canvas().nativeElement;
		const scale =
			(this.camera.fov() / Math.max(element.clientHeight, 1)) *
			(event.pointerType === 'touch' ? TOUCH_GAIN : 1);

		this.dragged += Math.hypot(event.clientX - this.lastX, event.clientY - this.lastY);
		this.camera.turn(
			(this.lastX - event.clientX) * scale,
			(event.clientY - this.lastY) * scale,
		);
		this.lastX = event.clientX;
		this.lastY = event.clientY;
	}

	protected onPointerUp(event: PointerEvent): void {
		this.pointers.delete(event.pointerId);
		(event.target as HTMLElement).releasePointerCapture(event.pointerId);

		if (this.pinch) {
			if (this.pointers.size < 2) {
				this.pinch = null;
			}
			return;
		}

		if (this.dragPointer !== event.pointerId) {
			return;
		}
		this.dragPointer = null;
		this.dragging.set(false);

		if (this.dragged <= DRAG_SLOP) {
			this.probe(event);
		}
	}

	/** Finger gap, in pixels */
	private pinchSpan(): number {
		const [a, b] = [...this.pointers.values()];
		return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
	}

	/** Drops a point where the pointer met the ground */
	private probe(event: PointerEvent): void {
		const renderer = this.renderer();
		const rings = this.terrain.rings();
		if (!renderer || !rings.length) {
			return;
		}

		const bounds = this.canvas().nativeElement.getBoundingClientRect();
		const direction = renderer.directionAt(
			event.clientX - bounds.left,
			event.clientY - bounds.top,
		);
		if (!direction) {
			return;
		}

		const hit = firstHitAcross(
			rings,
			this.camera.altitude(),
			{ east: direction[0], north: direction[1], up: direction[2] },
			this.settings.visibility(),
		);
		if (!hit) {
			return;
		}

		this.probes.update((probes) => [
			...probes,
			{
				id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
				east: hit.east,
				north: hit.north,
				up: hit.up,
				label: this.length.transform(hit.distance, 'distance'),
				expires: performance.now() + PROBE_LIFE,
			},
		]);
	}

	protected onWheel(event: WheelEvent): void {
		this.camera.zoom(Math.sign(event.deltaY) * 3);
	}

	protected onKeyDown(event: KeyboardEvent): void {
		const step = this.camera.fov() / 20;
		switch (event.key) {
			case 'ArrowLeft':
				this.camera.turn(-step, 0);
				break;
			case 'ArrowRight':
				this.camera.turn(step, 0);
				break;
			case 'ArrowUp':
				this.camera.turn(0, step);
				break;
			case 'ArrowDown':
				this.camera.turn(0, -step);
				break;
			case '+':
				this.camera.zoom(-3);
				break;
			case '-':
				this.camera.zoom(3);
				break;
			default:
				return;
		}
		event.preventDefault();
	}

	private start(): void {
		let renderer: TerrainRenderer;
		try {
			renderer = new TerrainRenderer(this.canvas().nativeElement, {
				maxRadius: this.settings.visibility(),
			});
		} catch (error) {
			this.startupError.set((error as Error).message);
			return;
		}

		renderer.setStyle({ ...RENDER_STYLE, outlineWidth: this.settings.outlineWidth() });
		renderer.setSky(this.sky.state());
		this.renderer.set(renderer);

		const draw = (time: number) => {
			const seconds = this.lastTime ? Math.min((time - this.lastTime) / 1000, 0.1) : 0;
			this.lastTime = time;

			this.camera.advance(seconds);
			this.advanceReveal(renderer, seconds);
			renderer.resize();
			renderer.setPose(this.camera.pose());
			renderer.render();
			this.placeLabels(renderer, seconds);
			this.placeSkyLabels(renderer);
			this.placeProbes(renderer, time);
			this.frame = requestAnimationFrame(draw);
		};
		this.frame = requestAnimationFrame(draw);
	}

	/** Lays the names out on one band, each with a leader */
	private placeLabels(renderer: TerrainRenderer, seconds: number): void {
		if (!renderer.hasField) {
			return;
		}
		const element = this.canvas().nativeElement;
		const width = element.clientWidth;
		const height = element.clientHeight;
		const band = Math.round(height * BAND_FRACTION);
		const placed: PeakLabel[] = [];
		const taken: number[] = [];

		for (const mark of this.markable()) {
			if (placed.length >= MAX_LABELS) {
				break;
			}
			const point = renderer.project(mark.east, mark.north, mark.up);
			if (!point || point.x < 0 || point.x > width) {
				continue;
			}
			const leader = point.y - band;
			if (leader < MIN_LEADER || point.y > height) {
				continue;
			}
			if (taken.some((x) => Math.abs(x - point.x) < LABEL_GUARD)) {
				continue;
			}

			taken.push(point.x);

			const textY = ease(this.easedPeaks.get(mark.id), band, seconds);
			this.easedPeaks.set(mark.id, textY);

			// Each name waits for the edge to reach its own summit.
			const distance = Math.hypot(mark.east, mark.north);
			const arrived = (this.revealRadius - distance) / LABEL_ARRIVAL;

			placed.push({
				id: mark.id,
				name: mark.name,
				kind: mark.kind,
				icon: ICONS[mark.kind] ?? '',
				detail: mark.detail,
				x: round(point.x),
				textY: round(textY),
				leader: round(point.y - textY),
				opacity: Math.round(clamp(arrived, 0, 1) * 100) / 100,
			});
		}

		prune(this.easedPeaks, placed);
		this.labels.set(placed);
	}

	/** Projects the dropped points and expires old ones */
	private placeProbes(renderer: TerrainRenderer, time: number): void {
		const live = this.probes().filter((probe) => probe.expires > time);
		if (live.length !== this.probes().length) {
			this.probes.set(live);
		}

		this.probeMarks.set(
			live
				.map((probe) => {
					const point = renderer.project(probe.east, probe.north, probe.up);
					return point
						? { id: probe.id, label: probe.label, x: round(point.x), y: round(point.y) }
						: null;
				})
				.filter((mark): mark is ProbeMark => mark !== null),
		);
	}

	/** Everything with a name to hang, bookmarks first */
	private markable(): Markable[] {
		const showElevation = this.settings.showPeakElevation();

		const bookmarks: Markable[] = this.marks.placed().map((bookmark) => ({
			id: `bookmark-${bookmark.id}`,
			name: bookmark.name,
			kind: 'bookmark',
			detail: showElevation ? this.length.transform(bookmark.altitude, 'altitude') : '',
			east: bookmark.east,
			north: bookmark.north,
			up: bookmark.up,
		}));

		const peaks: Markable[] = this.peaks.visiblePeaks().map((peak) => ({
			id: peak.id,
			name: peak.name,
			kind: peak.kind,
			detail:
				showElevation && !isLandform(peak.kind)
					? this.length.transform(peak.elevation, 'altitude')
					: '',
			east: peak.east,
			north: peak.north,
			up: peak.up,
		}));

		return [...bookmarks, ...peaks];
	}

	/**
	 * Marks each crossing of the skyline at the point where it happens, in the
	 * body's own colour.
	 */
	private placeSkyLabels(renderer: TerrainRenderer): void {
		const element = this.canvas().nativeElement;
		const width = element.clientWidth;
		const height = element.clientHeight;
		const placed: SkyLabel[] = [];

		for (const event of this.sky.events()) {
			const point = renderer.projectDirection(skyDirection(event));
			if (!point || point.x < 0 || point.x > width || point.y < 0 || point.y > height) {
				continue;
			}
			placed.push({
				id: `${event.body}-${event.kind}-${event.time.getTime()}`,
				text: `${event.kind === 'rise' ? '↑' : '↓'} ${this.timezone.timeValue(event.time)}`,
				x: round(point.x),
				y: round(point.y),
				colour: bodyColour(event.body),
				horizon: event.source === 'horizon',
			});
		}

		this.skyLabels.set(placed);
	}
}

/** Disc colours, as CSS */
function bodyColour(body: LightSource): string {
	const [r, g, b] = body === 'sun' ? RENDER_STYLE.sunColour : RENDER_STYLE.moonColour;
	return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}

/**
 * Exponential approach, so the rate is tied to elapsed time rather than to how often this
 * happens to run.
 */
function ease(previous: number | undefined, target: number, seconds: number): number {
	if (previous === undefined || seconds <= 0) {
		return target;
	}
	return previous + (target - previous) * (1 - Math.exp(-seconds / LABEL_TAU));
}

/** Rounds to tenths of a pixel */
function round(value: number): number {
	return Math.round(value * 10) / 10;
}

/** Forgets easing state for labels that have gone */
function prune(store: Map<string, number>, placed: { id: string }[]): void {
	if (store.size <= placed.length) {
		return;
	}
	const live = new Set(placed.map((label) => label.id));
	for (const id of store.keys()) {
		if (!live.has(id)) {
			store.delete(id);
		}
	}
}

function sameProbeMarks(a: ProbeMark[], b: ProbeMark[]): boolean {
	return (
		a.length === b.length &&
		a.every(
			(mark, index) =>
				mark.id === b[index].id && mark.x === b[index].x && mark.y === b[index].y,
		)
	);
}

function sameSkyLabels(a: SkyLabel[], b: SkyLabel[]): boolean {
	return (
		a.length === b.length &&
		a.every(
			(label, index) =>
				label.id === b[index].id && label.x === b[index].x && label.y === b[index].y,
		)
	);
}

function sameLabels(a: PeakLabel[], b: PeakLabel[]): boolean {
	return (
		a.length === b.length &&
		a.every(
			(label, index) =>
				label.id === b[index].id &&
				label.x === b[index].x &&
				label.textY === b[index].textY &&
				label.leader === b[index].leader &&
				label.detail === b[index].detail &&
				label.opacity === b[index].opacity,
		)
	);
}
