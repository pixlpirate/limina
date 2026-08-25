import { Injectable, signal } from '@angular/core';
import { environment } from '@environments';
import { Place } from '@interfaces';

interface NominatimAddress {
	house_number?: string;
	road?: string;
	neighbourhood?: string;
	quarter?: string;
	suburb?: string;
	borough?: string;
	hamlet?: string;
	village?: string;
	town?: string;
	city?: string;
	municipality?: string;
	county?: string;
	state?: string;
	country?: string;
}

interface NominatimResult {
	place_id: number;
	display_name: string;
	name?: string;
	/** Which rung of the address this result *is* — `city`, `road`, `peak`… */
	addresstype?: string;
	category?: string;
	address?: NominatimAddress;
	lat: string;
	lon: string;
}

/**
 * Results that already are a settlement or something larger. These name
 * themselves, so repeating the town they sit in would print it twice.
 */
const SETTLEMENT_TYPES = new Set([
	'city',
	'town',
	'village',
	'municipality',
	'hamlet',
	'borough',
	'suburb',
	'quarter',
	'neighbourhood',
	'locality',
	'county',
	'state',
	'province',
	'region',
	'district',
	'country',
]);

/** Tags naming the settlement a result sits in, finest first. */
const SETTLEMENT_KEYS: (keyof NominatimAddress)[] = [
	'city',
	'town',
	'village',
	'municipality',
	'borough',
	'suburb',
	'quarter',
	'hamlet',
	'neighbourhood',
];

/** The town a result sits in, or nothing where it sits in open country. */
function settlement(result: NominatimResult): string {
	for (const key of SETTLEMENT_KEYS) {
		const value = result.address?.[key];
		if (value) {
			return value;
		}
	}
	return '';
}

/** What the result is called, before any context is added. */
function baseName(result: NominatimResult): string {
	return result.name?.trim() || result.display_name.split(',')[0].trim();
}

/** A short, uniform label: what it is, then where it is. */
function label(result: NominatimResult): string {
	const country = result.address?.country ?? '';
	const type = result.addresstype ?? '';

	if (SETTLEMENT_TYPES.has(type)) {
		return join([baseName(result), country]);
	}

	const road = result.address?.road;
	if (road) {
		const number = result.address?.house_number;
		const street = number ? `${number} ${road}` : road;
		return join([street, settlement(result), country]);
	}

	return join([baseName(result), settlement(result), country]);
}

function join(parts: string[]): string {
	return parts.filter((part) => part.trim()).join(', ');
}

/**
 * Drops the repeats, keeping the first of each — Nominatim answers in order of
 * relevance. Two results are the same when they read the same: the label is the
 * whole of what is shown, so two rows a reader cannot tell apart are not a
 * choice. One square held as both a node and a way, or one street split into
 * segments, are the shapes this takes in the data.
 */
function deduplicate(named: { result: NominatimResult; name: string }[]): typeof named {
	const seen = new Set<string>();

	return named.filter(({ name }) => {
		const key = name.toLocaleLowerCase();
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
}

/** Free-text place lookup through Nominatim. */
@Injectable({ providedIn: 'root' })
export class PlaceSearchService {
	private readonly busy = signal(false);
	private controller: AbortController | null = null;

	readonly searching = this.busy.asReadonly();

	async search(query: string, limit = 8): Promise<Place[]> {
		const trimmed = query.trim();
		if (!trimmed) {
			return [];
		}

		this.controller?.abort();
		this.controller = new AbortController();
		this.busy.set(true);

		const url = new URL(environment.nominatimUrl);
		url.searchParams.set('q', trimmed);
		url.searchParams.set('format', 'jsonv2');
		url.searchParams.set('limit', String(limit * 2));
		url.searchParams.set('addressdetails', '1');

		try {
			const response = await fetch(url, { signal: this.controller.signal });
			if (!response.ok) {
				throw new Error('map.unavailable');
			}
			const results = (await response.json()) as NominatimResult[];
			const named = results.map((result) => ({ result, name: label(result) }));

			return deduplicate(named)
				.slice(0, limit)
				.map(({ result, name }) => ({
					id: String(result.place_id),
					name,
					lat: Number(result.lat),
					lon: Number(result.lon),
				}));
		} finally {
			this.busy.set(false);
		}
	}
}
