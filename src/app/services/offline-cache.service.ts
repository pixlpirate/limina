import { Injectable, signal } from '@angular/core';

const DATABASE = 'limina-offline';
const STORE = 'responses';
const VERSION = 1;

/** What a cached response costs, for the storage readout. */
export interface CacheUsage {
	entries: number;
	bytes: number;
}

/** The slice of the cache the loaders need, kept small so they stay testable. */
export interface ResponseStore {
	match(key: string): Promise<Blob | null>;
	put(key: string, blob: Blob): Promise<void>;
}

/**
 * Stores fetched tiles and summit responses in IndexedDB, so an area visited once keeps working
 * without a network — and so changing the visibility distance re-reads from disk instead of the
 * internet.
 */
@Injectable({ providedIn: 'root' })
export class OfflineCacheService implements ResponseStore {
	private readonly database = this.open();

	readonly usage = signal<CacheUsage>({ entries: 0, bytes: 0 });

	constructor() {
		void this.refreshUsage();
	}

	async match(key: string): Promise<Blob | null> {
		const db = await this.database;
		if (!db) {
			return null;
		}
		return new Promise((resolve) => {
			const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
			request.onsuccess = () => resolve((request.result?.blob as Blob) ?? null);
			request.onerror = () => resolve(null);
		});
	}

	async put(key: string, blob: Blob): Promise<void> {
		const db = await this.database;
		if (!db) {
			return;
		}
		await new Promise<void>((resolve) => {
			const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
			const request = store.put({ key, blob, bytes: blob.size, storedAt: Date.now() });
			request.onsuccess = () => resolve();
			request.onerror = () => resolve();
		});
	}

	async refreshUsage(): Promise<void> {
		const db = await this.database;
		if (!db) {
			return;
		}
		const usage = await new Promise<CacheUsage>((resolve) => {
			let entries = 0;
			let bytes = 0;
			const request = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
			request.onsuccess = () => {
				const cursor = request.result;
				if (!cursor) {
					resolve({ entries, bytes });
					return;
				}
				entries++;
				bytes += (cursor.value.bytes as number) ?? 0;
				cursor.continue();
			};
			request.onerror = () => resolve({ entries: 0, bytes: 0 });
		});
		this.usage.set(usage);
	}

	async clear(): Promise<void> {
		const db = await this.database;
		if (!db) {
			return;
		}
		await new Promise<void>((resolve) => {
			const request = db.transaction(STORE, 'readwrite').objectStore(STORE).clear();
			request.onsuccess = () => resolve();
			request.onerror = () => resolve();
		});
		await this.refreshUsage();
	}

	/** Resolves to null where IndexedDB is unavailable, which just disables caching. */
	private open(): Promise<IDBDatabase | null> {
		if (typeof indexedDB === 'undefined') {
			return Promise.resolve(null);
		}
		return new Promise((resolve) => {
			const request = indexedDB.open(DATABASE, VERSION);
			request.onupgradeneeded = () => {
				if (!request.result.objectStoreNames.contains(STORE)) {
					request.result.createObjectStore(STORE, { keyPath: 'key' });
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => resolve(null);
		});
	}
}
