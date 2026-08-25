import { computed, inject, Injectable, resource } from '@angular/core';

import { HeightField } from '@gl';

import { loadHeightField } from './dem-loader';
import { DataWarningService } from './data-warning.service';
import { OfflineCacheService } from './offline-cache.service';
import { SettingsService } from './settings.service';
import { ViewpointService } from './viewpoint.service';

/** Decoded rasters kept in memory */
const MEMORY_CACHE_SIZE = 4;

/** Radii of the inner rasters, in metres */
const INNER_RADII = [5_000, 20_000];

/** Radius the eye is placed clear of, in metres */
const FOOTING_RADIUS = 8;

/**
 * Builds the elevation raster the whole app reads from: the renderer displaces
 * its mesh with it, and the summit list traces sight lines through it.
 */
@Injectable({ providedIn: 'root' })
export class TerrainService {
	private readonly viewpoint = inject(ViewpointService);
	private readonly settings = inject(SettingsService);
	private readonly cache = inject(OfflineCacheService);
	private readonly warning = inject(DataWarningService);

	private readonly recent = new Map<string, HeightField>();

	private readonly raster = resource({
		params: () =>
			this.warning.permitted()
				? { origin: this.viewpoint.position(), radius: this.settings.visibility() }
				: undefined,
		loader: ({ params, abortSignal }) => this.load(params.origin, params.radius, abortSignal),
	});

	private readonly nearRaster = resource({
		params: () =>
			this.warning.permitted()
				? { origin: this.viewpoint.position(), radius: INNER_RADII[0] }
				: undefined,
		loader: ({ params, abortSignal }) => this.load(params.origin, params.radius, abortSignal),
	});

	private readonly midRaster = resource({
		params: () => {
			const radius = INNER_RADII[1];
			return this.warning.permitted() && this.settings.visibility() > radius
				? { origin: this.viewpoint.position(), radius }
				: undefined;
		},
		loader: ({ params, abortSignal }) => this.load(params.origin, params.radius, abortSignal),
	});

	/** The loaded raster, or null */
	readonly field = computed(() => (this.raster.hasValue() ? this.raster.value() : null));

	/**
	 * Every raster that has arrived, innermost first. The view works with however
	 * many are ready, so the horizon appears before the close ground sharpens.
	 */
	readonly rings = computed(() => {
		const outer = this.field();
		if (!outer) {
			return [];
		}

		const inner = [this.nearRaster, this.midRaster]
			.filter((raster) => raster.hasValue())
			.map((raster) => raster.value() as HeightField)
			.filter((field) => field.radius < outer.radius);

		return [...inner, outer];
	});

	/** Ground under the viewer, in metres */
	readonly ground = computed(() => {
		const field = this.rings()[0];
		return field ? field.highestWithin(FOOTING_RADIUS) : 0;
	});

	/**
	 * True while any raster is still coming. All three, not just the widest: the
	 * outer one lands first and the close ground follows, so watching only that
	 * one calls the terrain ready while the detail under your feet is missing.
	 */
	readonly loading = computed(
		() => this.raster.isLoading() || this.nearRaster.isLoading() || this.midRaster.isLoading(),
	);
	readonly error = computed(() => this.raster.error() as Error | undefined);

	reload(): void {
		this.recent.clear();
		this.raster.reload();
		this.nearRaster.reload();
		this.midRaster.reload();
	}

	/** Memory, then the tile cache, then the network */
	private async load(
		origin: { lat: number; lon: number },
		radius: number,
		abortSignal: AbortSignal,
	): Promise<HeightField> {
		const key = `${origin.lat},${origin.lon},${radius}`;
		const remembered = this.recent.get(key);
		if (remembered) {
			return remembered;
		}

		const field = await loadHeightField(origin, radius, abortSignal, this.cache);
		this.remember(key, field);
		return field;
	}

	private remember(key: string, field: HeightField): void {
		this.recent.set(key, field);
		while (this.recent.size > MEMORY_CACHE_SIZE) {
			this.recent.delete(this.recent.keys().next().value as string);
		}
	}
}
