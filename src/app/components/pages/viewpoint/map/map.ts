import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged, map } from 'rxjs';
import { LatLon, Place } from '@interfaces';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
	MenuService,
	NetworkService,
	PlaceSearchService,
	ToastService,
	ViewpointService,
} from '@services';

import { Panel } from '../../../molecules';
import { LocationMap } from '../../../organisms/location-map/location-map';

/** Quiet before a search goes out, in milliseconds */
const DEBOUNCE = 400;
/** Shortest query worth sending */
const MIN_LENGTH = 3;

@Component({
	selector: 'app-viewpoint-map',
	changeDetection: ChangeDetectionStrategy.OnPush,
	imports: [Panel, LocationMap, ReactiveFormsModule, TranslatePipe],
	templateUrl: './map.html',
	styleUrl: './map.scss',
})
export class ViewpointMap {
	private readonly viewpoint = inject(ViewpointService);
	private readonly network = inject(NetworkService);

	protected readonly online = this.network.online;
	private readonly places = inject(PlaceSearchService);
	private readonly toast = inject(ToastService);
	private readonly translate = inject(TranslateService);
	private readonly router = inject(Router);
	private readonly menu = inject(MenuService);

	protected readonly query = new FormControl('', { nonNullable: true });
	protected readonly results = signal<Place[]>([]);
	protected readonly searching = this.places.searching;

	/** Result the arrow keys are on, -1 for none */
	protected readonly active = signal(-1);
	protected readonly activeId = computed(() =>
		this.active() >= 0 ? `place-result-${this.active()}` : null,
	);

	/** Where the map opens */
	protected readonly centre = this.viewpoint.position();
	/** Marker starts where the viewer stands */
	protected readonly selection = signal<LatLon | null>(this.centre);

	/** One entry per placement, so the fly-to button pings when the point moves */
	protected readonly ping = computed(() => {
		const point = this.selection();
		return point ? [`${point.lat},${point.lon}`] : [];
	});
	protected readonly selectedName = signal<string | undefined>(undefined);

	constructor() {
		this.query.valueChanges
			.pipe(
				map((value) => value.trim()),
				debounceTime(DEBOUNCE),
				distinctUntilChanged(),
				takeUntilDestroyed(),
			)
			.subscribe((value) => void this.lookUp(value));
	}

	/**
	 * The native submit event, not `ngSubmit`: that one comes from `NgForm`, which
	 * lives in `FormsModule` and so was never here to emit it.
	 */
	protected search(event: Event): void {
		event.preventDefault();
		void this.lookUp(this.query.value.trim(), true);
	}

	/**
	 * `announce` is set only for a deliberate search. Saying "nothing matched"
	 * after every keystroke would fire while a name is still half typed.
	 */
	private async lookUp(query: string, announce = false): Promise<void> {
		if (query.length < MIN_LENGTH) {
			this.close();
			return;
		}

		this.active.set(-1);
		try {
			const results = await this.places.search(query);
			this.results.set(results);
			if (!results.length && announce) {
				this.toast.show(this.translate.instant('map.noMatch'));
			}
		} catch (error) {
			this.results.set([]);
			this.toast.show((error as Error).message, { assertive: true, duration: 4000 });
		}
	}

	/** Arrow keys, Enter and Escape over the result list */
	protected onKeyDown(event: KeyboardEvent): void {
		const results = this.results();
		if (!results.length) {
			return;
		}

		switch (event.key) {
			case 'ArrowDown':
				this.active.update((index) => (index + 1) % results.length);
				break;
			case 'ArrowUp':
				this.active.update((index) => (index <= 0 ? results.length - 1 : index - 1));
				break;
			case 'Escape':
				this.close();
				break;
			case 'Enter': {
				const chosen = results[this.active()];
				if (!chosen) {
					return;
				}
				this.choose(chosen);
				break;
			}
			default:
				return;
		}
		event.preventDefault();
	}

	/**
	 * Taking a search result marks it on the map, which flies there, and closes
	 * the list with the name left in the box.
	 */
	protected choose(place: Place): void {
		this.pick(place, place.name);
		this.query.setValue(place.name, { emitEvent: false });
		this.close();
	}

	protected pick(point: LatLon, name?: string): void {
		this.selection.set(point);
		this.selectedName.set(name);
	}

	protected flyTo(): void {
		const point = this.selection();
		if (point) {
			this.menu.forget();
			this.viewpoint.moveTo(
				point,
				this.selectedName() ? 'search' : 'map',
				this.selectedName(),
			);
			void this.router.navigate(['/']);
		}
	}

	private close(): void {
		this.results.set([]);
		this.active.set(-1);
	}
}
