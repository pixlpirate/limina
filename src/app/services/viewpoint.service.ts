import { computed, effect, Injectable, signal } from '@angular/core';
import { LatLon, ViewpointOrigin } from '@interfaces';

const STORAGE_KEY = 'limina.viewpoint';

/** Geneva, only used on a first run */
const DEFAULT_POSITION: LatLon = { lat: 46.2, lon: 6.1 };

interface StoredViewpoint {
	position: LatLon;
	origin: ViewpointOrigin;
	label?: string;
}

/** Where on Earth the viewer stands */
@Injectable({ providedIn: 'root' })
export class ViewpointService {
	private readonly restored = restore();

	private readonly currentPosition = signal<LatLon>(this.restored?.position ?? DEFAULT_POSITION, {
		equal: (a, b) => a.lat === b.lat && a.lon === b.lon,
	});
	private readonly currentOrigin = signal<ViewpointOrigin>(this.restored?.origin ?? 'default');
	private readonly currentLabel = signal<string | undefined>(this.restored?.label);

	readonly position = this.currentPosition.asReadonly();
	readonly origin = this.currentOrigin.asReadonly();
	readonly label = this.currentLabel.asReadonly();

	readonly latitude = computed(() => this.currentPosition().lat);
	readonly longitude = computed(() => this.currentPosition().lon);

	constructor() {
		effect(() => {
			const stored: StoredViewpoint = {
				position: this.currentPosition(),
				origin: this.currentOrigin(),
				label: this.currentLabel(),
			};
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
			} catch {}
		});
	}

	moveTo(position: LatLon, origin: ViewpointOrigin, label?: string): void {
		this.currentPosition.set({ lat: position.lat, lon: position.lon });
		this.currentOrigin.set(origin);
		this.currentLabel.set(label);
	}
}

function restore(): StoredViewpoint | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		const parsed = raw ? (JSON.parse(raw) as StoredViewpoint) : null;
		return parsed &&
			Number.isFinite(parsed.position?.lat) &&
			Number.isFinite(parsed.position?.lon) &&
			Math.abs(parsed.position.lat) <= 90 &&
			Math.abs(parsed.position.lon) <= 180
			? parsed
			: null;
	} catch {
		return null;
	}
}
