import {
	ChangeDetectionStrategy,
	Component,
	effect,
	input,
	output,
	viewChild,
} from '@angular/core';
import { environment } from '@environments';
import { LatLon } from '@interfaces';
import {
	AttributionControlDirective,
	ControlComponent,
	MapComponent,
	MarkerComponent,
} from '@maplibre/ngx-maplibre-gl';
import { MapMouseEvent, StyleSpecification } from 'maplibre-gl';

/**
 * CARTO's Dark Matter: already dark and near-monochrome, so nothing has to be drained in the
 * shader and the marker is the only colour on it.
 */
/** The same tiles from each of CARTO's four hosts, which is how they ask. */
function subdomains(template: string): string[] {
	return ['a', 'b', 'c', 'd'].map((host) => template.replace('{s}', host));
}

const BASEMAP_STYLE: StyleSpecification = {
	version: 8,
	sources: {
		basemap: {
			type: 'raster',
			tiles: subdomains(environment.basemapTileUrl),
			tileSize: 256,
			attribution: environment.basemapAttribution,
		},
		labels: {
			type: 'raster',
			tiles: subdomains(environment.basemapLabelsUrl),
			tileSize: 256,
		},
		relief: {
			type: 'raster-dem',
			tiles: [environment.demTileUrl],
			tileSize: environment.demTileSize,
			encoding: 'terrarium',
			maxzoom: environment.demMaxZoom,
			attribution: environment.demAttribution,
		},
	},
	layers: [
		{ id: 'basemap', type: 'raster', source: 'basemap' },
		{
			id: 'relief',
			type: 'hillshade',
			source: 'relief',
			paint: {
				'hillshade-method': 'basic',
				'hillshade-exaggeration': 0.5,
				'hillshade-highlight-color': 'rgba(255, 255, 255, 0.175)',
				'hillshade-shadow-color': 'rgba(0, 0, 0, 0.0)',
				'hillshade-accent-color': 'rgba(0, 0, 0, 0.0)',
			},
		},
		// Last, so the shading never falls across a place name.
		{ id: 'labels', type: 'raster', source: 'labels' },
	],
};

/** Flat map for picking a viewpoint */
@Component({
	selector: 'app-location-map',
	changeDetection: ChangeDetectionStrategy.OnPush,
	imports: [MapComponent, MarkerComponent, ControlComponent, AttributionControlDirective],
	template: `
		<mgl-map
			[mapStyle]="style"
			[center]="[centre().lon, centre().lat]"
			[zoom]="zoom()"
			[attributionControl]="false"
			(mapClick)="onClick($event)"
		>
			<!-- Bottom left, where it cannot sit under the fly-to button. -->
			<mgl-control mglAttribution position="bottom-left" [compact]="true" />

			@if (selection(); as point) {
				<mgl-marker [lngLat]="[point.lon, point.lat]">
					<span class="location-map__marker"></span>
				</mgl-marker>
			}
		</mgl-map>
	`,
	styleUrl: './location-map.scss',
})
export class LocationMap {
	/** Where the map opens */
	readonly centre = input.required<LatLon>();
	readonly selection = input<LatLon | null>(null);
	readonly zoom = input(9);

	readonly picked = output<LatLon>();

	private readonly map = viewChild(MapComponent);

	protected readonly style = BASEMAP_STYLE;

	constructor() {
		effect(() => {
			const point = this.selection();
			const map = this.map()?.mapInstance;
			if (!point || !map) {
				return;
			}

			// The map already opens on the viewpoint, so a marker sitting there is
			// where the view starts rather than somewhere to be carried to.
			const opening = this.centre();
			if (point.lat === opening.lat && point.lon === opening.lon) {
				return;
			}

			map.flyTo({ center: [point.lon, point.lat], zoom: Math.max(map.getZoom(), 11) });
		});
	}

	protected onClick(event: MapMouseEvent): void {
		this.picked.emit({ lat: event.lngLat.lat, lon: event.lngLat.lng });
	}
}
