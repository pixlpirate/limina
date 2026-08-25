import { computed, inject, Injectable, signal } from '@angular/core';
import { VISIBILITY_OPTIONS } from './settings.service';

import { prefetchTiles } from './dem-loader';
import { OfflineCacheService } from './offline-cache.service';
import { fetchSummits, summitRegion } from './peaks.service';
import { fetchTimezone } from './timezone.service';
import { ViewpointService } from './viewpoint.service';
import { TranslateService } from '@ngx-translate/core';

/**
 * Downloads everything the current area needs, at every visibility distance, so
 * it keeps working with no network afterwards.
 */
@Injectable({ providedIn: 'root' })
export class OfflineService {
	private readonly viewpoint = inject(ViewpointService);
	private readonly cache = inject(OfflineCacheService);
	private readonly translate = inject(TranslateService);

	private readonly done = signal(0);
	private readonly total = signal(0);

	readonly storing = computed(() => this.total() > 0);
	/** Completed fraction of the download, 0..1 */
	readonly progress = computed(() => (this.total() === 0 ? 0 : this.done() / this.total()));

	async storeCurrentArea(): Promise<void> {
		if (this.storing()) {
			return;
		}
		const origin = this.viewpoint.position();
		const controller = new AbortController();

		this.done.set(0);
		this.total.set(VISIBILITY_OPTIONS.length * 2 + 1);

		try {
			for (const radius of VISIBILITY_OPTIONS) {
				await prefetchTiles(origin, radius, this.cache, controller.signal);
				this.done.update((done) => done + 1);

				// Every distance, and through the same snapping the view uses:
				// each one asks a different question, and an answer stored under
				// any other url is one nothing will ever ask for again.
				const region = summitRegion(origin, radius);
				// In the language on screen, which is the one the stored answer
				// will be asked for again under.
				await fetchSummits(
					region.centre,
					region.radius,
					controller.signal,
					this.cache,
					this.translate.currentLang() ?? '',
				);
				this.done.update((done) => done + 1);
			}

			await fetchTimezone(summitRegion(origin, 50_000).centre, controller.signal, this.cache);
			this.done.update((done) => done + 1);
		} finally {
			this.total.set(0);
			await this.cache.refreshUsage();
		}
	}
}
