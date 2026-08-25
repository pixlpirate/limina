import { computed, inject, Injectable, resource } from '@angular/core';
import { LatLon } from '@interfaces';
import { skyDirection, skyPositionOf } from '@utils';

import { SettingsService } from './settings.service';
import { ViewpointService } from './viewpoint.service';

/** Right ascension and declination pairs, flat, one run per contour. */
type Rings = number[][];

interface MilkyWayData {
	levels: Rings[];
}

/** Outlines of the Milky Way. */
@Injectable({ providedIn: 'root' })
export class MilkyWayService {
	private readonly viewpoint = inject(ViewpointService);
	private readonly settings = inject(SettingsService);

	private readonly data = resource({
		params: () => (this.settings.showMilkyWay() ? {} : undefined),
		loader: async ({ abortSignal }) => {
			const response = await fetch('data/milky-way.json', { signal: abortSignal });
			return (await response.json()) as MilkyWayData;
		},
	});

	/** Every contour as unit directions in the viewer's frame, for the moment being shown. */
	rings(when: Date): Float32Array[] {
		if (!this.settings.showMilkyWay() || !this.data.hasValue()) {
			return [];
		}

		const place = this.viewpoint.position();
		return this.data
			.value()
			.levels.flatMap((level) => level.map((ring) => project(ring, when, place)));
	}

	readonly loading = computed(() => this.data.isLoading());
}

function project(ring: number[], when: Date, place: LatLon): Float32Array {
	const points = ring.length / 2;
	const flat = new Float32Array(points * 3);

	for (let i = 0; i < points; i++) {
		const position = skyPositionOf(ring[i * 2], ring[i * 2 + 1], when, place);
		const [east, north, up] = skyDirection(position);
		flat[i * 3] = east;
		flat[i * 3 + 1] = north;
		flat[i * 3 + 2] = up;
	}
	return flat;
}
