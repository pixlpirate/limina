import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { Bookmark, PlacedBookmark } from '@interfaces';
import { bearingBetween, distanceBetween, toLocal } from '@utils';

import { CameraService } from './camera.service';
import { SettingsService } from './settings.service';
import { TerrainService } from './terrain.service';
import { ViewpointService } from './viewpoint.service';

const STORAGE_KEY = 'limina.bookmarks';

/** Places the viewer has marked, held on the device. */
@Injectable({ providedIn: 'root' })
export class BookmarksService {
	private readonly translate = inject(TranslateService);
	private readonly viewpoint = inject(ViewpointService);
	private readonly camera = inject(CameraService);
	private readonly terrain = inject(TerrainService);
	private readonly settings = inject(SettingsService);

	private readonly items = signal<Bookmark[]>(restore());

	/** By name rather than by when they were made. */
	readonly bookmarks = computed(() =>
		[...this.items()].sort((a, b) => a.name.localeCompare(b.name)),
	);
	readonly count = computed(() => this.items().length);

	/**
	 * The ones near enough to draw, each with where it sits relative to the viewer and whether the
	 * ground between gets in the way.
	 */
	readonly placed = computed<PlacedBookmark[]>(() => {
		const field = this.terrain.field();
		const items = this.items();
		if (!field || !items.length) {
			return [];
		}

		const origin = this.viewpoint.position();
		const eye = this.camera.altitude();
		const radius = this.settings.visibility();

		return items
			.map((bookmark) => {
				const { east, north } = toLocal(origin, bookmark);
				const up = Math.max(
					bookmark.altitude,
					field.elevationAt(bookmark.lat, bookmark.lon),
				);
				return {
					...bookmark,
					distance: distanceBetween(origin, bookmark),
					bearing: bearingBetween(origin, bookmark),
					east,
					north,
					up,
					visible: field.hasLineOfSight(eye, { east, north, up }),
				};
			})
			.filter((bookmark) => bookmark.distance > 1 && bookmark.distance <= radius)
			.filter((bookmark) => bookmark.visible)
			.sort((a, b) => a.distance - b.distance);
	});

	constructor() {
		effect(() => {
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items()));
			} catch {}
		});
	}

	/** Marks where the camera is standing now. */
	add(name: string): Bookmark {
		const { lat, lon } = this.viewpoint.position();
		const bookmark: Bookmark = {
			id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			name: name.trim() || this.translate.instant('bookmarks.unnamed'),
			lat,
			lon,
			altitude: this.camera.altitude(),
			created: Date.now(),
		};

		this.items.update((items) => [...items, bookmark]);
		return bookmark;
	}

	remove(id: string): void {
		this.items.update((items) => items.filter((item) => item.id !== id));
	}
}

function restore(): Bookmark[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		const parsed = raw ? (JSON.parse(raw) as Bookmark[]) : [];
		return Array.isArray(parsed) ? parsed.filter(isBookmark) : [];
	} catch {
		return [];
	}
}

/** Storage is user-writable, so nothing from it is trusted without checking. */
function isBookmark(value: unknown): value is Bookmark {
	const item = value as Partial<Bookmark>;
	return (
		typeof item?.id === 'string' &&
		typeof item.name === 'string' &&
		Number.isFinite(item.lat) &&
		Number.isFinite(item.lon) &&
		Number.isFinite(item.altitude)
	);
}
