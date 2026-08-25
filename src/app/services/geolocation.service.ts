import { Injectable, signal } from '@angular/core';
import { LatLon } from '@interfaces';

/** Promise wrapper around the browser geolocation API, with readable failures. */
@Injectable({ providedIn: 'root' })
export class GeolocationService {
	private readonly busy = signal(false);

	readonly locating = this.busy.asReadonly();

	get supported(): boolean {
		return 'geolocation' in navigator;
	}

	async locate(): Promise<LatLon> {
		if (!this.supported) {
			throw new Error('errors.noGeolocation');
		}
		this.busy.set(true);

		try {
			const position = await new Promise<GeolocationPosition>((resolve, reject) => {
				navigator.geolocation.getCurrentPosition(
					resolve,
					(error) => reject(describe(error)),
					{
						enableHighAccuracy: true,
						timeout: 15_000,
						maximumAge: 30_000,
					},
				);
			});
			return { lat: position.coords.latitude, lon: position.coords.longitude };
		} finally {
			this.busy.set(false);
		}
	}
}

function describe(error: GeolocationPositionError): Error {
	switch (error.code) {
		case error.PERMISSION_DENIED:
			return new Error('errors.permissionDenied');
		case error.POSITION_UNAVAILABLE:
			return new Error('errors.noPosition');
		case error.TIMEOUT:
			return new Error('errors.locateTimeout');
		default:
			return new Error('errors.locateFailed');
	}
}
