import {
	afterNextRender,
	ChangeDetectionStrategy,
	Component,
	DestroyRef,
	effect,
	ElementRef,
	inject,
	input,
	output,
	signal,
	viewChild,
	ViewEncapsulation,
} from '@angular/core';
import { LatLon } from '@interfaces';
import { BasemapService } from '@services';
import { control, divIcon, LeafletMouseEvent, Map, Marker, marker } from 'leaflet';

/** Flat map for picking a viewpoint */
@Component({
	selector: 'app-location-map',
	changeDetection: ChangeDetectionStrategy.OnPush,
	// Leaflet builds its own elements, which a scoped stylesheet cannot reach
	encapsulation: ViewEncapsulation.None,
	template: `<div #canvas class="location-map__canvas"></div>`,
	styleUrl: './location-map.scss',
})
export class LocationMap {
	/** Where the map opens */
	readonly centre = input.required<LatLon>();
	readonly selection = input<LatLon | null>(null);
	readonly zoom = input(9);

	readonly picked = output<LatLon>();

	private readonly basemap = inject(BasemapService);
	private readonly canvas = viewChild.required<ElementRef<HTMLElement>>('canvas');

	private readonly map = signal<Map | null>(null);
	private pin: Marker | null = null;

	constructor() {
		const destroyRef = inject(DestroyRef);

		afterNextRender(() => {
			const element = this.canvas().nativeElement;
			const centre = this.centre();

			const map = new Map(element, {
				zoomControl: false,
				attributionControl: false,
				maxZoom: 19,
			}).setView([centre.lat, centre.lon], this.zoom());

			// Bottom left, where it cannot sit under the fly-to button
			control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);

			this.basemap.create().then((layer) => layer.addTo(map));
			map.on('click', (event: LeafletMouseEvent) =>
				this.picked.emit({ lat: event.latlng.lat, lon: event.latlng.lng }),
			);

			const observer = new ResizeObserver(() => map.invalidateSize());
			observer.observe(element);

			destroyRef.onDestroy(() => {
				observer.disconnect();
				map.remove();
			});
			this.map.set(map);
		});

		effect(() => {
			const point = this.selection();
			const map = this.map();
			if (!map) {
				return;
			}

			if (!point) {
				this.pin?.remove();
				this.pin = null;
				return;
			}

			const position: [number, number] = [point.lat, point.lon];
			if (this.pin) {
				this.pin.setLatLng(position);
			} else {
				this.pin = marker(position, {
					interactive: false,
					icon: divIcon({
						className: 'location-map__pin',
						html: '<span class="location-map__marker"></span>',
						iconSize: [0, 0],
					}),
				}).addTo(map);
			}

			// The map already opens on the viewpoint, so a marker sitting there is
			// where the view starts rather than somewhere to be carried to
			const opening = this.centre();
			if (point.lat === opening.lat && point.lon === opening.lon) {
				return;
			}

			map.flyTo(position, Math.max(map.getZoom(), 11));
		});
	}
}
