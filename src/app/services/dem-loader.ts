import { environment } from '@environments';
import { HeightField } from '@gl';
import { LatLon, MercatorBounds } from '@interfaces';
import {
	clamp,
	DEG,
	latToMercatorY,
	lonToMercatorX,
	METRES_PER_DEGREE_LAT,
	metresPerDegreeLon,
} from '@utils';

import { ResponseStore } from './offline-cache.service';

/** Tiles fetched at once */
const CONCURRENCY = 8;
/** Metres per texel of a 256px tile at zoom zero */
const EQUATORIAL_TEXEL = 156_543.03392;
const MIN_ZOOM = 8;
/** How far up the pyramid to look for a missing tile */
const MAX_FALLBACK = 5;

/** The tile grid over an area, and its mercator box */
export interface DemGrid {
	zoom: number;
	scale: number;
	x0: number;
	x1: number;
	y0: number;
	y1: number;
	tiles: { x: number; y: number }[];
}

/** Highest zoom fitting the texel budget */
export function demZoomFor(radius: number, lat: number): number {
	const metresPerTexelWanted = (2 * radius) / environment.demTexelBudget;
	const perTile = Math.log2(environment.demTileSize / 256);
	const zoom =
		Math.log2((EQUATORIAL_TEXEL * Math.cos(lat * DEG)) / metresPerTexelWanted) - perTile;

	return clamp(Math.floor(zoom), MIN_ZOOM, environment.demMaxZoom);
}

/** Which tiles cover `radius` around an origin */
export function demTilesFor(origin: LatLon, radius: number): DemGrid {
	const zoom = demZoomFor(radius, origin.lat);
	const scale = 2 ** zoom;

	const latSpan = radius / METRES_PER_DEGREE_LAT;
	const lonSpan = radius / metresPerDegreeLon(origin.lat);

	const x0 = clamp(Math.floor(lonToMercatorX(origin.lon - lonSpan) * scale), 0, scale - 1);
	const x1 = clamp(Math.floor(lonToMercatorX(origin.lon + lonSpan) * scale), 0, scale - 1);
	const y0 = clamp(Math.floor(latToMercatorY(origin.lat + latSpan) * scale), 0, scale - 1);
	const y1 = clamp(Math.floor(latToMercatorY(origin.lat - latSpan) * scale), 0, scale - 1);

	const tiles: { x: number; y: number }[] = [];
	for (let y = y0; y <= y1; y++) {
		for (let x = x0; x <= x1; x++) {
			tiles.push({ x, y });
		}
	}

	return { zoom, scale, x0, x1, y0, y1, tiles };
}

/** Downloads and decodes the tiles around an origin */
export async function loadHeightField(
	origin: LatLon,
	radius: number,
	abortSignal: AbortSignal,
	cache?: ResponseStore,
): Promise<HeightField> {
	const { zoom, scale, x0, x1, y0, y1, tiles } = demTilesFor(origin, radius);

	const tileSize = environment.demTileSize;
	const width = (x1 - x0 + 1) * tileSize;
	const height = (y1 - y0 + 1) * tileSize;

	const heights = new Float32Array(width * height);
	const decoded = new Map<string, DecodedTile>();

	// Fetched and decoded first: the fill reads across tile edges, so it needs
	// the neighbours in hand before it starts.
	const levels = new Map<string, number>();
	await inBatches(tiles, CONCURRENCY, async ({ x, y }) => {
		const level = await resolveTile(zoom, x, y, decoded, abortSignal, cache);
		if (level !== null) {
			levels.set(`${x}/${y}`, level);
		}
	});

	if (abortSignal.aborted) {
		throw new DOMException('Terrain load aborted', 'AbortError');
	}

	for (const { x, y } of tiles) {
		const level = levels.get(`${x}/${y}`);
		if (level !== undefined) {
			fillTile(heights, width, zoom, level, x, y, x - x0, y - y0, decoded);
		}
	}

	if (abortSignal.aborted) {
		throw new DOMException('Terrain load aborted', 'AbortError');
	}

	const bounds: MercatorBounds = {
		x0: x0 / scale,
		y0: y0 / scale,
		x1: (x1 + 1) / scale,
		y1: (y1 + 1) / scale,
	};
	return new HeightField(origin, bounds, width, height, heights, radius);
}

/** Fetches and stores an area's tiles, undecoded */
export async function prefetchTiles(
	origin: LatLon,
	radius: number,
	cache: ResponseStore,
	abortSignal: AbortSignal,
): Promise<void> {
	const { zoom, tiles } = demTilesFor(origin, radius);

	await inBatches(tiles, CONCURRENCY, async ({ x, y }) => {
		const tile = await loadTile(zoom, x, y, abortSignal, cache);
		tile?.close();
	});
}

/**
 * Decodes the tile that will stand for this one, walking up the pyramid where
 * the source has nothing at this zoom. Returns the zoom it settled on.
 */
async function resolveTile(
	zoom: number,
	x: number,
	y: number,
	decoded: Map<string, DecodedTile>,
	abortSignal: AbortSignal,
	cache?: ResponseStore,
): Promise<number | null> {
	for (let step = 0; step <= MAX_FALLBACK; step++) {
		const scale = 2 ** step;
		const level = zoom - step;
		const sourceX = Math.floor(x / scale);
		const sourceY = Math.floor(y / scale);
		const key = `${level}/${sourceX}/${sourceY}`;

		if (decoded.has(key)) {
			return level;
		}

		const tile = await loadTile(level, sourceX, sourceY, abortSignal, cache);
		if (!tile) {
			continue;
		}
		decoded.set(key, decodeTile(tile));
		tile.close();
		return level;
	}
	return null;
}

/**
 * Writes one tile's metres into the mosaic, stretching whatever stood in for it.
 *
 * Stretched on decoded heights, never on the pixels: a canvas blends into eight
 * bits, and one unit of Terrarium's red channel is 256 metres, so texels either
 * side of a band edge round to a 128 metre spike. Those edges are contour lines,
 * which ring a summit.
 */
function fillTile(
	heights: Float32Array,
	mosaicWidth: number,
	zoom: number,
	level: number,
	x: number,
	y: number,
	tileColumn: number,
	tileRow: number,
	decoded: Map<string, DecodedTile>,
): void {
	const size = environment.demTileSize;
	const scale = 2 ** (zoom - level);
	const destinationX = tileColumn * size;
	const destinationY = tileRow * size;

	// Its own tile, texel for texel: a straight copy, row by row.
	if (scale === 1) {
		const source = decoded.get(`${level}/${x}/${y}`);
		if (source && source.size === size) {
			for (let row = 0; row < size; row++) {
				heights.set(
					source.data.subarray(row * size, (row + 1) * size),
					(destinationY + row) * mosaicWidth + destinationX,
				);
			}
			return;
		}
	}

	const block = blockAround(decoded, level, x, y, size, scale);
	if (!block) {
		return;
	}

	const smoothing = clamp(environment.demSmoothing, 0, 1);

	for (let row = 0; row < size; row++) {
		// Placed in the source zoom's whole grid, not in one tile, so a sample
		// near an edge reads its neighbour instead of stopping against it.
		const gy = (y * size + row + 0.5) / scale - 0.5;
		const y0 = Math.floor(gy);
		const fy = gy - y0;
		const line = (destinationY + row) * mosaicWidth + destinationX;

		for (let column = 0; column < size; column++) {
			const gx = (x * size + column + 0.5) / scale - 0.5;
			const x0 = Math.floor(gx);
			const fx = gx - x0;

			const topLeft = block.read(x0, y0);
			const topRight = block.read(x0 + 1, y0);
			const bottomLeft = block.read(x0, y0 + 1);
			const bottomRight = block.read(x0 + 1, y0 + 1);

			const top = topLeft * (1 - fx) + topRight * fx;
			const bottom = bottomLeft * (1 - fx) + bottomRight * fx;
			const smooth = top * (1 - fy) + bottom * fy;

			if (smoothing >= 1) {
				heights[line + column] = smooth;
				continue;
			}

			const nearest =
				fx < 0.5 ? (fy < 0.5 ? topLeft : bottomLeft) : fy < 0.5 ? topRight : bottomRight;
			heights[line + column] = nearest + (smooth - nearest) * smoothing;
		}
	}
}

/** A tile's metres, and its side */
interface DecodedTile {
	data: Float32Array;
	size: number;
}

/** The source tiles a square reaches into */
interface SourceBlock {
	read: (gx: number, gy: number) => number;
}

/**
 * The source tiles a square covers, so reading a texel is arithmetic rather than
 * a search. A square spans at most two tiles each way plus a texel of overlap;
 * anything outside them falls back to `texelAt`.
 */
function blockAround(
	decoded: Map<string, DecodedTile>,
	level: number,
	x: number,
	y: number,
	size: number,
	scale: number,
): SourceBlock | null {
	const originX = Math.floor(((x * size + 0.5) / scale - 0.5) / size);
	const originY = Math.floor(((y * size + 0.5) / scale - 0.5) / size);

	const block: (Float32Array | null)[] = [];
	let any = false;

	for (let row = 0; row < 2; row++) {
		for (let column = 0; column < 2; column++) {
			const tile = decoded.get(`${level}/${originX + column}/${originY + row}`);
			const data = tile && tile.size === size ? tile.data : null;
			block.push(data);
			any ||= data !== null;
		}
	}

	if (!any) {
		return null;
	}

	return {
		read: (gx, gy) => {
			const column = Math.floor(gx / size) - originX;
			const row = Math.floor(gy / size) - originY;
			const data =
				column >= 0 && column < 2 && row >= 0 && row < 2 ? block[row * 2 + column] : null;

			if (!data) {
				return texelAt(decoded, level, gx, gy, size);
			}

			const localX = gx - (originX + column) * size;
			const localY = gy - (originY + row) * size;
			return data[localY * size + localX];
		},
	};
}

/** Directions to look for a neighbouring tile */
const NEIGHBOURS: [number, number][] = [
	[-1, 0],
	[1, 0],
	[0, -1],
	[0, 1],
	[-1, -1],
	[1, -1],
	[-1, 1],
	[1, 1],
];

/**
 * One texel of the source zoom, wherever it lives. A key and a map lookup per
 * call, so only the rim uses it: where a tile was never fetched, the nearest one
 * that was holds its edge.
 */
function texelAt(
	decoded: Map<string, DecodedTile>,
	level: number,
	gx: number,
	gy: number,
	size: number,
): number {
	const tileX = Math.floor(gx / size);
	const tileY = Math.floor(gy / size);
	const tile = decoded.get(`${level}/${tileX}/${tileY}`);
	if (tile) {
		const localX = clamp(gx - tileX * size, 0, tile.size - 1);
		const localY = clamp(gy - tileY * size, 0, tile.size - 1);
		return tile.data[localY * tile.size + localX];
	}

	for (const [dx, dy] of NEIGHBOURS) {
		const near = decoded.get(`${level}/${tileX + dx}/${tileY + dy}`);
		if (near) {
			const localX = clamp(gx - (tileX + dx) * size, 0, near.size - 1);
			const localY = clamp(gy - (tileY + dy) * size, 0, near.size - 1);
			return near.data[localY * near.size + localX];
		}
	}
	return 0;
}

/** Reads a tile's pixels into metres */
function decodeTile(tile: ImageBitmap): DecodedTile {
	const canvas = document.createElement('canvas');
	canvas.width = tile.width;
	canvas.height = tile.height;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) {
		throw new Error('errors.terrainDecode');
	}

	context.drawImage(tile, 0, 0);
	return {
		data: decodeTerrarium(context.getImageData(0, 0, tile.width, tile.height).data),
		size: tile.width,
	};
}

/** Terrarium packs metres into RGB */
function decodeTerrarium(pixels: Uint8ClampedArray): Float32Array {
	const heights = new Float32Array(pixels.length / 4);
	for (let i = 0; i < heights.length; i++) {
		const offset = i * 4;
		heights[i] = pixels[offset] * 256 + pixels[offset + 1] + pixels[offset + 2] / 256 - 32768;
	}
	return heights;
}

async function loadTile(
	zoom: number,
	x: number,
	y: number,
	abortSignal: AbortSignal,
	cache?: ResponseStore,
): Promise<ImageBitmap | null> {
	const url = environment.demTileUrl
		.replace('{z}', String(zoom))
		.replace('{x}', String(x))
		.replace('{y}', String(y));

	try {
		const stored = await cache?.match(url);
		if (stored) {
			return await createImageBitmap(stored);
		}

		const response = await fetch(url, { signal: abortSignal });
		if (!response.ok) {
			return null;
		}
		const blob = await response.blob();
		await cache?.put(url, blob);
		return await createImageBitmap(blob);
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') {
			throw error;
		}
		return null;
	}
}

async function inBatches<T>(
	items: T[],
	size: number,
	run: (item: T) => Promise<void>,
): Promise<void> {
	for (let start = 0; start < items.length; start += size) {
		await Promise.all(items.slice(start, start + size).map(run));
	}
}
