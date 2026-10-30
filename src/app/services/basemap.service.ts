import { inject, Injectable } from '@angular/core';

import { TranslateService } from '@ngx-translate/core';
import { Flavor, layers, namedFlavor } from '@protomaps/basemaps';
import chroma from 'chroma-js';
import L, { Layer, tileLayer } from 'leaflet';
import type { LayerSpecification, Map as MaplibreMap, StyleSpecification } from 'maplibre-gl';

import { environment } from '@environments';

import { PROTOMAPS_API_KEY } from '../config/protomaps-key';

type MaplibreLeafletFactory = (options: { style: StyleSpecification }) => Layer;

const TILES_URL = 'https://api.protomaps.com/tiles/v4/{z}/{x}/{y}.mvt';
const MAX_DATA_ZOOM = 15;
const ASSETS_URL = 'https://protomaps.github.io/basemaps-assets';
const ATTRIBUTION =
	'<a href="https://protomaps.com" target="_blank">Protomaps</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';

// Lightness multipliers applied to the colours of the Protomaps "black" flavor
const SURFACE_DARKNESS = 0.5;
// Labels stay closer to the original colours to remain readable
const LABEL_DARKNESS = 0.9;
// Every surface colour is blended towards this tone, keeping SURFACE_KEEP of its own variation
const SURFACE_BASE = '#0d0d0d';
const SURFACE_KEEP = 0.4;
// Road shields and road names clutter a map meant to show relief
const HIDDEN_LAYERS = new Set([
	'roads_shields',
	'roads_labels_major',
	'roads_labels_minor',
	'roads_oneway',
	'address_label',
]);

/**
 * The Protomaps "black" flavor, rendered by MapLibre exactly like maps.protomaps.com
 * (same layers, fonts and sprites) inside the Leaflet map, with every colour of the
 * flavor darkened. MapLibre is only loaded when the map is created. Falls back to the
 * standard OSM tiles (darkened with CSS) when no API key is configured.
 */
@Injectable({
	providedIn: 'root',
})
export class BasemapService {
	private readonly translateService = inject(TranslateService);

	public async create(): Promise<Layer> {
		return PROTOMAPS_API_KEY ? this.createVectorLayer() : this.createRasterLayer();
	}

	private async createVectorLayer(): Promise<Layer> {
		// The Leaflet plugin looks for MapLibre on the global scope
		const maplibre = await import('maplibre-gl');
		// maplibre-gl 6 no longer finds its own worker when bundled
		maplibre.setWorkerUrl('maplibre-gl-worker.mjs');
		Object.assign(window, { maplibregl: maplibre });
		await import('@maplibre/maplibre-gl-leaflet');

		const factory = (L as unknown as { maplibreGL: MaplibreLeafletFactory }).maplibreGL;

		const layer = factory({ style: this.getStyle() });
		layer.on('add', () => {
			const maplibreMap = (
				layer as unknown as { getMaplibreMap(): MaplibreMap }
			).getMaplibreMap();
			maplibreMap.on('error', (event) => console.error('MapLibre', event.error));
		});
		return layer;
	}

	private getStyle(): StyleSpecification {
		return {
			version: 8,
			glyphs: `${ASSETS_URL}/fonts/{fontstack}/{range}.pbf`,
			sprite: `${ASSETS_URL}/sprites/v4/black`,
			sources: {
				protomaps: {
					type: 'vector',
					tiles: [`${TILES_URL}?key=${PROTOMAPS_API_KEY}`],
					maxzoom: MAX_DATA_ZOOM,
					attribution: `${ATTRIBUTION} ${environment.demAttribution}`,
				},
				relief: {
					type: 'raster-dem',
					tiles: [environment.demTileUrl],
					tileSize: environment.demTileSize,
					encoding: 'terrarium',
					maxzoom: environment.demMaxZoom,
				},
			},
			layers: this.withRelief(
				layers('protomaps', this.getDarkFlavor(), {
					lang: this.translateService.currentLang() || 'en',
				}).filter((layer) => !HIDDEN_LAYERS.has(layer.id)),
			),
		};
	}

	/** Shaded relief slipped in under the first label, so names are never shaded over. */
	private withRelief(base: LayerSpecification[]): LayerSpecification[] {
		const relief: LayerSpecification = {
			id: 'relief',
			type: 'hillshade',
			source: 'relief',
			paint: {
				'hillshade-method': 'basic',
				'hillshade-exaggeration': 0.3,
				'hillshade-highlight-color': 'rgba(255, 255, 255, 0.16)',
				'hillshade-shadow-color': 'rgba(0, 0, 0, 0.0)',
				'hillshade-accent-color': 'rgba(0, 0, 0, 0.0)',
			},
		};
		const firstLabel = base.findIndex((layer) => layer.type === 'symbol');
		return firstLabel < 0
			? [...base, relief]
			: [...base.slice(0, firstLabel), relief, ...base.slice(firstLabel)];
	}

	/** The "black" flavor with the lightness of each colour scaled down. */
	private getDarkFlavor(): Flavor {
		return this.darken({ ...namedFlavor('black') }) as unknown as Flavor;
	}

	private darken(colors: Record<string, unknown>): Record<string, unknown> {
		for (const [key, value] of Object.entries(colors)) {
			if (value && typeof value === 'object') {
				colors[key] = this.darken({ ...(value as Record<string, unknown>) });
			} else if (typeof value === 'string') {
				const color = chroma(value);
				const factor = key.endsWith('_label') ? LABEL_DARKNESS : SURFACE_DARKNESS;
				const darkened = color.set('hsl.l', color.get('hsl.l') * factor);
				// Surfaces are pulled towards one near-black so the map reads as a single
				// tone, leaving the relief to carry the shapes
				colors[key] = (
					key.endsWith('_label')
						? darkened
						: chroma.mix(SURFACE_BASE, darkened, SURFACE_KEEP, 'rgb')
				).hex();
			}
		}

		return colors;
	}

	private createRasterLayer(): Layer {
		return tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
			maxZoom: 19,
			className: 'map-tiles',
			attribution:
				'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
		});
	}
}
