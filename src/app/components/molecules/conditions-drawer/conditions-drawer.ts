import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LengthPipe } from '@pipes';
import {
	BookmarksService,
	SettingsService,
	SkyService,
	TimezoneService,
	ToastService,
	VISIBILITY_OPTIONS,
} from '@services';

type Tool = 'bookmark' | 'date' | 'time' | 'visibility';

/** Stacking order, bottom first */
const TOOLS: { id: Tool; icon: string; label: string }[] = [
	{ id: 'date', icon: 'icon-calendar-days', label: 'conditions.date' },
	{ id: 'time', icon: 'icon-clock', label: 'conditions.timeOfDay' },
	{ id: 'visibility', icon: 'icon-eye', label: 'conditions.visibilityDistance' },
	{ id: 'bookmark', icon: 'icon-bookmark', label: 'conditions.bookmarkSpot' },
];

/**
 * Bottom-left drawer for the three things that change what the scene shows:
 * the date, the time of day, and how far the landscape is drawn.
 */
@Component({
	selector: 'app-conditions-drawer',
	changeDetection: ChangeDetectionStrategy.OnPush,
	imports: [LengthPipe, TranslatePipe],
	providers: [LengthPipe],
	templateUrl: './conditions-drawer.html',
	styleUrl: './conditions-drawer.scss',
	host: {
		'(keydown.escape)': 'close()',
	},
})
export class ConditionsDrawer {
	private readonly sky = inject(SkyService);
	private readonly settings = inject(SettingsService);
	private readonly bookmarks = inject(BookmarksService);
	private readonly toast = inject(ToastService);
	private readonly translate = inject(TranslateService);
	private readonly length = inject(LengthPipe);
	private readonly timezone = inject(TimezoneService);

	/** Name being typed for a new bookmark */
	protected readonly draft = signal('');

	protected readonly open = signal(false);
	protected readonly tool = signal<Tool | null>(null);

	protected readonly date = this.sky.date;
	protected readonly time = this.sky.time;
	protected readonly visibility = this.settings.visibility;
	protected readonly live = this.sky.live;
	protected readonly distances = VISIBILITY_OPTIONS;
	protected readonly tools = TOOLS;

	protected toggle(): void {
		this.open.update((open) => !open);
		if (!this.open()) {
			this.tool.set(null);
		}
	}

	protected close(): void {
		this.open.set(false);
		this.tool.set(null);
		this.draft.set('');
	}

	/** Toggles the panel; the open tool closes */
	protected select(tool: Tool): void {
		this.tool.update((current) => (current === tool ? null : tool));
		if (this.tool() === 'bookmark') {
			this.draft.set('');
		}
	}

	/** Bookmarks the current spot */
	protected saveBookmark(event: Event): void {
		event.preventDefault();
		const name = this.draft().trim();
		if (!name) {
			return;
		}

		this.bookmarks.add(name);
		this.draft.set('');
		this.tool.set(null);
		this.toast.show(this.translate.instant('conditions.bookmarked', { name }), {
			status: 'success',
		});
	}

	protected toggleHold(): void {
		this.sky.toggleHold();
	}

	protected setDate(value: string): void {
		this.sky.setDate(value);
		this.announce('conditions.dateSet', {
			date: this.timezone.format(this.sky.moment(), { dateStyle: 'long' }),
		});
	}

	protected setTime(value: string): void {
		this.sky.setTime(value);
		this.announce('conditions.timeSet', { time: this.timezone.timeValue(this.sky.moment()) });
	}

	/**
	 * Says what the scene was just set to. Each kind gets its own channel, so a
	 * second nudge replaces the first rather than queueing behind it.
	 */
	private announce(key: string, params: Record<string, unknown>): void {
		this.toast.show(this.translate.instant(key, params), { channel: key });
	}

	protected setVisibility(value: string): void {
		const distance = Number(value);
		this.settings.visibility.set(distance);
		// The landscape takes a moment to redraw at the new distance, so say what
		// was asked for rather than leaving the change unacknowledged.
		this.announce('conditions.visibilitySet', {
			distance: this.length.transform(distance, 'distance'),
		});
	}
}
