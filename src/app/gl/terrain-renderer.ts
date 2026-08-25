import { CameraPose, ProjectedPoint } from '@interfaces';
import {
	CelestialBody,
	clamp,
	createMat4,
	curvatureDrop,
	DEG,
	invert,
	lookAt,
	METRES_PER_DEGREE_LAT,
	metresPerDegreeLon,
	multiply,
	normalizeVec3,
	perspective,
	transform,
	Vec3,
} from '@utils';

import { compileProgram, createTexture, uniformLocations } from './gl.util';
import { HeightField } from './height-field';
import { RENDER_STYLE, RenderStyle } from './render-style';
import { OUTLINE_FRAGMENT, OUTLINE_VERTEX } from './shaders/outline.shader';
import { PATH_FRAGMENT, PATH_VERTEX } from './shaders/path.shader';
import { TERRAIN_FRAGMENT, TERRAIN_VERTEX } from './shaders/terrain.shader';

const MAX_PITCH = 85;
/**
 * Field of view the disc radius is quoted at. Scaling the angle with the current
 * view keeps the sun and moon the same size on screen however far you zoom.
 */
const REFERENCE_FOV = 55;
/** Offscreen resolution ceiling, in CSS pixels */
const MAX_RENDER_SCALE = 2;
/** Far plane and track distance, as radius multiples */
const FAR_FACTOR = 1.6;
const PATH_FACTOR = 1.3;
/** Milky Way distance, as a radius multiple */
const MILKY_WAY_FACTOR = 1.45;
/**
 * Floats per track vertex: this direction, the next one, which side, and how far
 * below the horizon the run has travelled. The last is what the dashes are
 * measured on, and it restarts at each crossing so the first dash begins exactly
 * where the solid line stops rather than a gap later.
 */
const PATH_STRIDE = 8;
/**
 * Altitude at which a body counts as set, in degrees: the standard allowance for
 * refraction and the disc's own width. Below this the track is drawn broken.
 */
const HORIZON = -0.833;
/** Dash periods per radian below the horizon */
const PATH_DASHES = 115;
/** Where a raster gives way to the next */
const RING_BLEND = 0.75;
/** Nested elevation rasters the shader can hold */
const MAX_RINGS = 3;

export interface GridOptions {
	/** Vertices around a full turn */
	sectors: number;
	minRadius: number;
	maxRadius: number;
	/** Ring spacing, as a fraction of the radius */
	growth: number;
	minStep: number;
	maxStep: number;
	/**
	 * Near plane, in metres. Reversed-Z keeps distant depth precision intact, so
	 * this can sit close enough to draw the ground at the viewer's own feet.
	 */
	near: number;
	/** Offscreen resolution multiplier */
	supersample: number;
}

const DEFAULT_GRID: GridOptions = {
	sectors: 768,
	minRadius: 4,
	maxRadius: 60_000,
	growth: 0.02,
	minStep: 4,
	maxStep: 350,
	near: 0.4,
	supersample: 2,
};

/** A body's position and its track */
export interface BodyTrack {
	/** Direction to the body, ENU */
	direction: Vec3;
	/** Flattened unit directions along the track */
	path: Float32Array;
}

/** The bodies on show, either of which may be off */
export interface SkyState extends Partial<Record<CelestialBody, BodyTrack>> {
	/** Milky Way contours, as runs of directions */
	milkyWay?: Float32Array[];
}

/**
 * Order matters: the Milky Way is stitched into one strip and drawn first, so
 * the sun and moon paint over it rather than being cut into by it.
 */
const TRACKS = ['milkyWay', 'sun', 'moon'] as const;

/**
 * Renders the landscape around a viewpoint in two passes: a radial terrain mesh into an
 * offscreen colour + surface buffer, then a fullscreen composite that paints the sky, places
 * the sun or moon, and traces outlines along the surface discontinuities.
 */
export class TerrainRenderer {
	private readonly gl: WebGL2RenderingContext;

	private readonly terrainProgram: WebGLProgram;
	private readonly terrainUniforms: Record<string, WebGLUniformLocation>;
	private readonly outlineProgram: WebGLProgram;
	private readonly outlineUniforms: Record<string, WebGLUniformLocation>;
	private readonly pathProgram: WebGLProgram;
	private readonly pathUniforms: Record<string, WebGLUniformLocation>;

	private terrainVao: WebGLVertexArrayObject | null = null;
	private terrainBuffers: WebGLBuffer[] = [];
	private indexCount = 0;

	private readonly quadVao: WebGLVertexArrayObject;
	private readonly quadBuffer: WebGLBuffer;
	private readonly tracks: Record<
		(typeof TRACKS)[number],
		{ vao: WebGLVertexArrayObject; buffer: WebGLBuffer; count: number }
	>;

	/** Nested elevation rasters, innermost first */
	private readonly ringTextures: WebGLTexture[];
	private readonly colourTexture: WebGLTexture;
	private readonly surfaceTexture: WebGLTexture;
	private readonly depthTexture: WebGLTexture;
	private readonly framebuffer: WebGLFramebuffer;

	private readonly projection = createMat4();
	private readonly view = createMat4();
	private readonly viewProjection = createMat4();
	private readonly inverseViewProjection = createMat4();

	/**
	 * How far the ground has been revealed, in metres, and how strongly the
	 * tracks are showing. Terrain arrives as a circle growing from the viewer;
	 * the tracks and the names follow once it has finished, together and on a
	 * timer, because a line across the sky has no distance to grow along.
	 */
	private revealRadius = Number.POSITIVE_INFINITY;
	private overlayFade = 1;
	/** Metres over which the wash falls away */
	private trailWidth = 1;
	/** How much of the wash is left */
	private trailFade = 1;
	/** One while the camera shows through */
	private passthrough = 0;

	private grid: GridOptions;
	private rings: HeightField[] = [];
	private style: RenderStyle = RENDER_STYLE;
	private sky: SkyState = {};
	private pose: CameraPose = { yaw: 0, pitch: 0, fov: 55, altitude: 0 };
	/** Offscreen buffer size, in supersampled texels */
	private width = 0;
	private height = 0;
	/** Canvas drawing buffer size, in device pixels */
	private viewWidth = 0;
	private viewHeight = 0;
	private pixelRatio = 0;

	constructor(
		private readonly canvas: HTMLCanvasElement,
		grid: Partial<GridOptions> = {},
	) {
		const context = canvas.getContext('webgl2', {
			antialias: true,
			depth: true,
			// Kept so the camera can be shown behind the landscape. The composite
			// premultiplies, which is what the compositor expects by default.
			alpha: true,
			premultipliedAlpha: true,
			powerPreference: 'high-performance',
		});
		if (!context) {
			throw new Error('errors.webgl');
		}
		this.gl = context;
		this.grid = { ...DEFAULT_GRID, ...grid };

		const linearFloat = this.gl.getExtension('OES_texture_float_linear');

		this.terrainProgram = compileProgram(this.gl, TERRAIN_VERTEX, TERRAIN_FRAGMENT);
		this.terrainUniforms = uniformLocations(this.gl, this.terrainProgram);
		this.outlineProgram = compileProgram(this.gl, OUTLINE_VERTEX, OUTLINE_FRAGMENT);
		this.outlineUniforms = uniformLocations(this.gl, this.outlineProgram);
		this.pathProgram = compileProgram(this.gl, PATH_VERTEX, PATH_FRAGMENT);
		this.pathUniforms = uniformLocations(this.gl, this.pathProgram);

		this.buildMesh();

		const quad = this.buildQuad();
		this.quadVao = quad.vao;
		this.quadBuffer = quad.buffer;
		this.tracks = {
			sun: this.buildPath(),
			moon: this.buildPath(),
			milkyWay: this.buildPath(),
		};

		const demFilter = linearFloat ? this.gl.LINEAR : this.gl.NEAREST;
		this.ringTextures = [
			createTexture(this.gl, demFilter),
			createTexture(this.gl, demFilter),
			createTexture(this.gl, demFilter),
		];
		this.colourTexture = createTexture(this.gl, this.gl.LINEAR);
		this.surfaceTexture = createTexture(this.gl, this.gl.NEAREST);
		this.depthTexture = createTexture(this.gl, this.gl.NEAREST);
		this.framebuffer = this.gl.createFramebuffer();

		this.gl.disable(this.gl.CULL_FACE);
		this.resize();
	}

	get hasField(): boolean {
		return this.rings.length > 0;
	}

	/** What the device could not give, or null */
	get limitation(): string | null {
		const gl = this.gl;
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
		const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);

		if (status === gl.FRAMEBUFFER_COMPLETE) {
			return null;
		}
		return `This device could not provide the buffers the landscape needs (0x${status.toString(16)}).`;
	}

	/** The widest raster */
	private get field(): HeightField | null {
		return this.rings.length ? this.rings[this.rings.length - 1] : null;
	}

	private get far(): number {
		return this.grid.maxRadius * FAR_FACTOR;
	}

	/**
	 * Elevation rasters covering nested radii, innermost first. The last one is
	 * taken as the full extent of the view; up to three are used.
	 */
	setRings(rings: HeightField[]): void {
		this.rings = rings.slice(0, MAX_RINGS);

		const gl = this.gl;
		this.rings.forEach((field, index) => {
			gl.bindTexture(gl.TEXTURE_2D, this.ringTextures[index]);
			gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
			gl.texImage2D(
				gl.TEXTURE_2D,
				0,
				gl.R32F,
				field.width,
				field.height,
				0,
				gl.RED,
				gl.FLOAT,
				field.data,
			);
		});
	}

	/**
	 * Sets how much of the scene is showing. `radius` is metres from the viewer;
	 * `fade` is the tracks, nought to one. Both default open, so a renderer that
	 * is never told anything simply draws everything.
	 */
	setReveal(radius: number, fade: number, trail: number, trailFade: number): void {
		this.revealRadius = radius;
		this.overlayFade = fade;
		this.trailWidth = trail;
		this.trailFade = trailFade;
	}

	/** Shows or hides the fill, keeping the lines */
	setPassthrough(on: boolean): void {
		this.passthrough = on ? 1 : 0;
	}

	setStyle(style: RenderStyle): void {
		this.style = style;
	}

	setPose(pose: CameraPose): void {
		this.pose = pose;
	}

	setSky(sky: SkyState): void {
		this.sky = sky;

		const gl = this.gl;
		for (const name of TRACKS) {
			const track = this.tracks[name];
			const strip =
				name === 'milkyWay'
					? stitch(sky.milkyWay ?? [])
					: expandTrack(sky[name]?.path ?? new Float32Array());
			gl.bindBuffer(gl.ARRAY_BUFFER, track.buffer);
			gl.bufferData(gl.ARRAY_BUFFER, strip, gl.DYNAMIC_DRAW);
			track.count = strip.length / PATH_STRIDE;
		}
	}

	/** Rebuilds the mesh for a new visible radius */
	setMaxRadius(maxRadius: number): void {
		if (maxRadius === this.grid.maxRadius) {
			return;
		}
		this.grid = { ...this.grid, maxRadius };
		this.buildMesh();
	}

	/** Syncs the drawing buffer with the canvas size */
	resize(): void {
		const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
		const viewWidth = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
		const viewHeight = Math.max(1, Math.round(this.canvas.clientHeight * ratio));

		if (
			viewWidth === this.viewWidth &&
			viewHeight === this.viewHeight &&
			ratio === this.pixelRatio
		) {
			return;
		}
		this.viewWidth = viewWidth;
		this.viewHeight = viewHeight;
		this.pixelRatio = ratio;
		this.canvas.width = viewWidth;
		this.canvas.height = viewHeight;

		const scale =
			Math.min(ratio * Math.max(1, this.grid.supersample), MAX_RENDER_SCALE) / ratio;
		const width = Math.round(viewWidth * scale);
		const height = Math.round(viewHeight * scale);
		this.width = width;
		this.height = height;

		const gl = this.gl;
		gl.bindTexture(gl.TEXTURE_2D, this.colourTexture);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.RGBA8,
			width,
			height,
			0,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			null,
		);
		gl.bindTexture(gl.TEXTURE_2D, this.surfaceTexture);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.RGBA8,
			width,
			height,
			0,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			null,
		);
		gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.DEPTH_COMPONENT32F,
			width,
			height,
			0,
			gl.DEPTH_COMPONENT,
			gl.FLOAT,
			null,
		);

		gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
		gl.framebufferTexture2D(
			gl.FRAMEBUFFER,
			gl.COLOR_ATTACHMENT0,
			gl.TEXTURE_2D,
			this.colourTexture,
			0,
		);
		gl.framebufferTexture2D(
			gl.FRAMEBUFFER,
			gl.COLOR_ATTACHMENT1,
			gl.TEXTURE_2D,
			this.surfaceTexture,
			0,
		);
		gl.framebufferTexture2D(
			gl.FRAMEBUFFER,
			gl.DEPTH_ATTACHMENT,
			gl.TEXTURE_2D,
			this.depthTexture,
			0,
		);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	}

	render(): void {
		if (!this.field) {
			return;
		}
		const gl = this.gl;
		this.updateMatrices();

		gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
		gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
		gl.viewport(0, 0, this.width, this.height);
		gl.clearColor(0, 0, 0, this.passthrough > 0 ? 0 : 1);
		gl.clearDepth(0);
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.GEQUAL);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

		this.drawTerrain();
		this.drawPath();

		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.drawBuffers([gl.BACK]);
		gl.viewport(0, 0, this.viewWidth, this.viewHeight);
		gl.disable(gl.DEPTH_TEST);

		this.drawComposite();
	}

	/**
	 * Maps a sky direction to canvas pixels, placing it out at the same distance
	 * as the track so it lands on the skyline rather than in front of it.
	 */
	projectDirection(direction: Vec3): ProjectedPoint | null {
		const distance = this.grid.maxRadius * PATH_FACTOR;
		return this.toScreen(
			direction[0] * distance,
			direction[1] * distance,
			direction[2] * distance,
		);
	}

	/**
	 * The direction a canvas pixel looks along, as a unit vector in the viewer's
	 * frame. The inverse of {@link project}, for asking what is under a pointer.
	 */
	directionAt(x: number, y: number): Vec3 | null {
		const width = this.viewWidth / this.pixelRatio;
		const height = this.viewHeight / this.pixelRatio;
		if (width <= 0 || height <= 0) {
			return null;
		}

		const far = transform(
			this.inverseViewProjection,
			(x / width) * 2 - 1,
			1 - (y / height) * 2,
			0,
		);
		if (far[3] === 0) {
			return null;
		}

		const point: Vec3 = [far[0] / far[3], far[1] / far[3], far[2] / far[3]];
		const length = Math.hypot(point[0], point[1], point[2]);
		return length > 0 ? [point[0] / length, point[1] / length, point[2] / length] : null;
	}

	/**
	 * Maps a viewer-local ENU position to canvas pixels, or `null` when it sits
	 * behind the camera.
	 */
	project(east: number, north: number, up: number): ProjectedPoint | null {
		const range = Math.hypot(east, north);
		return this.toScreen(east, north, up - this.pose.altitude - curvatureDrop(range));
	}

	private toScreen(x: number, y: number, z: number): ProjectedPoint | null {
		const clip = transform(this.viewProjection, x, y, z);
		if (clip[3] <= 0) {
			return null;
		}

		const screenX = ((clip[0] / clip[3]) * 0.5 + 0.5) * (this.viewWidth / this.pixelRatio);
		const screenY = (0.5 - (clip[1] / clip[3]) * 0.5) * (this.viewHeight / this.pixelRatio);

		if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) {
			return null;
		}
		return { x: screenX, y: screenY, depth: Math.hypot(x, y, z) };
	}

	dispose(): void {
		const gl = this.gl;
		this.terrainBuffers.forEach((buffer) => gl.deleteBuffer(buffer));
		gl.deleteBuffer(this.quadBuffer);
		gl.deleteVertexArray(this.terrainVao);
		gl.deleteVertexArray(this.quadVao);
		for (const track of Object.values(this.tracks)) {
			gl.deleteBuffer(track.buffer);
			gl.deleteVertexArray(track.vao);
		}
		gl.deleteProgram(this.terrainProgram);
		gl.deleteProgram(this.outlineProgram);
		gl.deleteProgram(this.pathProgram);
		this.ringTextures.forEach((texture) => gl.deleteTexture(texture));
		gl.deleteTexture(this.colourTexture);
		gl.deleteTexture(this.surfaceTexture);
		gl.deleteTexture(this.depthTexture);
		gl.deleteFramebuffer(this.framebuffer);
		gl.getExtension('WEBGL_lose_context')?.loseContext();
	}

	private updateMatrices(): void {
		const yaw = this.pose.yaw * DEG;
		const pitch = clamp(this.pose.pitch, -MAX_PITCH, MAX_PITCH) * DEG;
		const forward: Vec3 = [
			Math.sin(yaw) * Math.cos(pitch),
			Math.cos(yaw) * Math.cos(pitch),
			Math.sin(pitch),
		];

		// Near and far handed over swapped, which is what reverses the depth range:
		// the near plane maps to one and the far plane to zero.
		perspective(
			this.projection,
			this.pose.fov * DEG,
			this.viewWidth / this.viewHeight,
			this.far,
			this.grid.near,
		);
		lookAt(this.view, [0, 0, 0], forward, [0, 0, 1]);
		multiply(this.viewProjection, this.projection, this.view);
		invert(this.inverseViewProjection, this.viewProjection);
	}

	private drawTerrain(): void {
		const gl = this.gl;
		const style = this.style;
		const u = this.terrainUniforms;

		gl.useProgram(this.terrainProgram);
		gl.bindVertexArray(this.terrainVao);

		const rings = this.rings;
		const outer = rings[rings.length - 1];
		const near = rings.length >= 3 ? rings[0] : rings.length === 2 ? rings[0] : outer;
		const mid = rings.length >= 3 ? rings[1] : outer;

		const slots: [string, string, HeightField, number][] = [
			['uRingNear', 'uBoundsNear', near, 0],
			['uRingMid', 'uBoundsMid', mid, 1],
			['uRingFar', 'uBoundsFar', outer, 2],
		];
		slots.forEach(([sampler, boundsName, ring], slot) => {
			const texture = this.ringTextures[rings.indexOf(ring)] ?? this.ringTextures[0];
			gl.activeTexture(gl.TEXTURE0 + slot);
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.uniform1i(u[sampler], slot);
			gl.uniform4f(
				u[boundsName],
				ring.bounds.x0,
				ring.bounds.y0,
				ring.bounds.x1,
				ring.bounds.y1,
			);
		});

		gl.uniform2f(
			u['uRingRadius'],
			rings.length >= 2 ? rings[0].radius : 0,
			rings.length >= 3 ? rings[1].radius : 0,
		);
		gl.uniform1f(u['uRingBlend'], RING_BLEND);
		gl.uniform3f(u['uTexelMetres'], near.resolution, mid.resolution, outer.resolution);
		gl.uniform1f(u['uPixelAngle'], (this.pose.fov * DEG) / Math.max(this.viewHeight, 1));

		gl.uniformMatrix4fv(u['uViewProjection'], false, this.viewProjection);
		gl.uniform2f(u['uOrigin'], outer.origin.lon, outer.origin.lat);
		gl.uniform2f(
			u['uMetresPerDegree'],
			metresPerDegreeLon(outer.origin.lat),
			METRES_PER_DEGREE_LAT,
		);
		gl.uniform1f(u['uEyeAltitude'], this.pose.altitude);

		gl.uniform3fv(u['uGroundColour'], style.groundColour);
		gl.uniform1f(u['uReveal'], this.revealRadius);
		gl.uniform1f(u['uTrail'], this.trailWidth);
		// Nothing softened while the camera is behind it: the drawn ridge has to
		// sit on the real one, and smoothing moves it.
		gl.uniform2f(
			u['uSmoothing'],
			this.passthrough > 0 ? 0 : style.smoothingRadius,
			style.smoothingTexels,
		);

		gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
		gl.bindVertexArray(null);
	}

	/**
	 * One depth-tested pass per body, so the mountains hide the stretch of track
	 * running behind them exactly as they hide anything else.
	 */
	private drawPath(): void {
		const gl = this.gl;
		const u = this.pathUniforms;
		const style = this.style;

		if (this.overlayFade <= 0) {
			return;
		}

		// Blended only while the tracks are arriving. The marker they leave in the
		// surface buffer blends with them, which softens the outline suppression
		// under a track for the few hundred milliseconds the fade lasts.
		const fading = this.overlayFade < 1;
		if (fading) {
			gl.enable(gl.BLEND);
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		}

		gl.useProgram(this.pathProgram);
		gl.uniformMatrix4fv(u['uViewProjection'], false, this.viewProjection);

		gl.uniform2f(u['uViewport'], this.viewWidth, this.viewHeight);

		const colours = {
			sun: style.sunPathColour,
			moon: style.moonPathColour,
			milkyWay:
				this.passthrough > 0 ? style.milkyWayPassthroughColour : style.milkyWayPathColour,
		};

		for (const name of TRACKS) {
			const track = this.tracks[name];
			if (track.count < 3) {
				continue;
			}
			const distant = name === 'milkyWay';
			gl.bindVertexArray(track.vao);
			gl.uniform3fv(u['uPathColour'], colours[name]);
			gl.uniform1f(u['uWidth'], distant ? style.milkyWayWidth : style.pathWidth);
			gl.uniform1f(
				u['uDistance'],
				this.grid.maxRadius * (distant ? MILKY_WAY_FACTOR : PATH_FACTOR),
			);
			// The Milky Way is not a body that rises and sets, so it is never
			// broken; the sun and moon are dashed below the horizon.
			gl.uniform1f(u['uDashes'], distant ? 0 : PATH_DASHES);
			gl.uniform1f(u['uFade'], this.overlayFade);
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, track.count);
		}

		if (fading) {
			gl.disable(gl.BLEND);
		}
		gl.bindVertexArray(null);
	}

	private drawComposite(): void {
		const gl = this.gl;
		const style = this.style;
		const u = this.outlineUniforms;

		gl.useProgram(this.outlineProgram);
		gl.bindVertexArray(this.quadVao);

		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.colourTexture);
		gl.uniform1i(u['uColour'], 0);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, this.surfaceTexture);
		gl.uniform1i(u['uSurface'], 1);
		gl.activeTexture(gl.TEXTURE2);
		gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
		gl.uniform1i(u['uDepth'], 2);

		gl.uniformMatrix4fv(u['uInverseViewProjection'], false, this.inverseViewProjection);
		const outlineWidth =
			style.outlineWidth * (this.passthrough > 0 ? style.passthroughOutline : 1);
		gl.uniform2f(
			u['uOutlineStep'],
			outlineWidth / this.viewWidth,
			outlineWidth / this.viewHeight,
		);
		gl.uniform2f(u['uPixelSize'], 1 / this.viewWidth, 1 / this.viewHeight);
		gl.uniform2f(u['uClipRange'], this.far, this.grid.near);
		gl.uniform3fv(u['uSkyColour'], style.skyColour);
		gl.uniform3fv(u['uOutlineColour'], style.outlineColour);
		gl.uniform1f(u['uOutlineStrength'], style.outlineStrength);
		gl.uniform3fv(u['uSilhouetteColour'], style.silhouetteColour);
		gl.uniform1f(u['uSilhouetteStrength'], style.silhouetteStrength);
		gl.uniform1f(u['uRoughnessFloor'], style.roughnessFloor);
		gl.uniform3fv(u['uFresnelColour'], style.fresnelColour);
		gl.uniform1f(u['uFresnelPower'], style.fresnelPower);
		gl.uniform1f(u['uFresnelStrength'], style.fresnelStrength);
		gl.uniform1f(u['uNormalStrength'], style.normalStrength);
		gl.uniform1f(u['uBodyFade'], this.overlayFade);
		gl.uniform3fv(u['uTrailColour'], style.trailColour);
		gl.uniform1f(u['uTrailStrength'], style.trailStrength * this.trailFade);
		gl.uniform1f(u['uTrailPower'], style.trailPower);
		gl.uniform1f(u['uPassthrough'], this.passthrough);

		const pixelAngle = (this.pose.fov * DEG) / Math.max(this.viewHeight, 1);
		const discAngle = style.discRadius * DEG * (this.pose.fov / REFERENCE_FOV);
		const aa = Math.max(pixelAngle, 1e-4);

		gl.uniform3fv(u['uSunDirection'], normalizeVec3(this.sky.sun?.direction ?? [0, 0, 1]));
		gl.uniform3fv(u['uSunColour'], style.sunColour);
		gl.uniform2f(u['uSunDisc'], this.sky.sun ? discAngle : 0, aa);

		gl.uniform3fv(u['uMoonDirection'], normalizeVec3(this.sky.moon?.direction ?? [0, 0, 1]));
		gl.uniform3fv(u['uMoonColour'], style.moonColour);
		gl.uniform2f(u['uMoonDisc'], this.sky.moon ? discAngle : 0, aa);

		gl.drawArrays(gl.TRIANGLES, 0, 3);
		gl.bindVertexArray(null);
	}

	/** Radial grid, one vertex per sector and ring */
	private buildMesh(): void {
		const gl = this.gl;
		const { sectors } = this.grid;

		this.terrainBuffers.forEach((buffer) => gl.deleteBuffer(buffer));
		this.terrainBuffers = [];
		if (this.terrainVao) {
			gl.deleteVertexArray(this.terrainVao);
		}

		const radii = buildRadii(this.grid);
		const rings = radii.length;

		const vertices = new Float32Array(sectors * rings * 2);
		for (let ring = 0; ring < rings; ring++) {
			for (let sector = 0; sector < sectors; sector++) {
				const offset = (ring * sectors + sector) * 2;
				vertices[offset] = sector / sectors;
				vertices[offset + 1] = radii[ring];
			}
		}

		const indices = new Uint32Array(sectors * (rings - 1) * 6);
		let cursor = 0;
		for (let ring = 0; ring < rings - 1; ring++) {
			for (let sector = 0; sector < sectors; sector++) {
				const next = (sector + 1) % sectors;
				const inner = ring * sectors;
				const outer = (ring + 1) * sectors;
				indices[cursor++] = inner + sector;
				indices[cursor++] = outer + sector;
				indices[cursor++] = inner + next;
				indices[cursor++] = inner + next;
				indices[cursor++] = outer + sector;
				indices[cursor++] = outer + next;
			}
		}

		const vao = gl.createVertexArray();
		gl.bindVertexArray(vao);

		const vertexBuffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
		const angle = gl.getAttribLocation(this.terrainProgram, 'aAngle');
		const radius = gl.getAttribLocation(this.terrainProgram, 'aRadius');
		gl.enableVertexAttribArray(angle);
		gl.vertexAttribPointer(angle, 1, gl.FLOAT, false, 8, 0);
		gl.enableVertexAttribArray(radius);
		gl.vertexAttribPointer(radius, 1, gl.FLOAT, false, 8, 4);

		const indexBuffer = gl.createBuffer();
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

		gl.bindVertexArray(null);
		this.terrainBuffers.push(vertexBuffer, indexBuffer);
		this.terrainVao = vao;
		this.indexCount = indices.length;
	}

	/** Oversized triangle covering the viewport */
	private buildQuad(): { vao: WebGLVertexArrayObject; buffer: WebGLBuffer } {
		const gl = this.gl;
		const vao = gl.createVertexArray();
		gl.bindVertexArray(vao);

		const buffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
		const position = gl.getAttribLocation(this.outlineProgram, 'aPosition');
		gl.enableVertexAttribArray(position);
		gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

		gl.bindVertexArray(null);
		return { vao, buffer };
	}

	private buildPath(): { vao: WebGLVertexArrayObject; buffer: WebGLBuffer; count: number } {
		const gl = this.gl;
		const vao = gl.createVertexArray();
		gl.bindVertexArray(vao);

		const buffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		const stride = PATH_STRIDE * 4;
		const direction = gl.getAttribLocation(this.pathProgram, 'aDirection');
		gl.enableVertexAttribArray(direction);
		gl.vertexAttribPointer(direction, 3, gl.FLOAT, false, stride, 0);
		const next = gl.getAttribLocation(this.pathProgram, 'aNext');
		gl.enableVertexAttribArray(next);
		gl.vertexAttribPointer(next, 3, gl.FLOAT, false, stride, 12);
		const side = gl.getAttribLocation(this.pathProgram, 'aSide');
		gl.enableVertexAttribArray(side);
		gl.vertexAttribPointer(side, 1, gl.FLOAT, false, stride, 24);
		const along = gl.getAttribLocation(this.pathProgram, 'aAlong');
		gl.enableVertexAttribArray(along);
		gl.vertexAttribPointer(along, 1, gl.FLOAT, false, stride, 28);

		gl.bindVertexArray(null);
		return { vao, buffer, count: 0 };
	}
}

/**
 * Turns a run of directions into a triangle strip, two vertices per sample, each
 * carrying the following sample so the vertex shader can widen across the line.
 */
/** Joins contours into one strip */
function stitch(rings: Float32Array[]): Float32Array {
	const strips = rings.map(expandTrack).filter((strip) => strip.length > 0);
	if (!strips.length) {
		return new Float32Array();
	}

	const joins = (strips.length - 1) * 2 * PATH_STRIDE;
	const out = new Float32Array(strips.reduce((total, s) => total + s.length, 0) + joins);
	let cursor = 0;

	strips.forEach((strip, index) => {
		if (index > 0) {
			out.set(out.subarray(cursor - PATH_STRIDE, cursor), cursor);
			cursor += PATH_STRIDE;
			out.set(strip.subarray(0, PATH_STRIDE), cursor);
			cursor += PATH_STRIDE;
		}
		out.set(strip, cursor);
		cursor += strip.length;
	});

	return out.subarray(0, cursor);
}

function expandTrack(path: Float32Array): Float32Array {
	const samples = path.length / 3;
	if (samples < 2) {
		return new Float32Array();
	}

	const strip = new Float32Array(samples * 2 * PATH_STRIDE);
	let cursor = 0;
	// Angle travelled since the run last dropped below the horizon. It is what
	// the dashes count, and it starts again at every crossing.
	let along = 0;
	let wasBelow = false;

	for (let i = 0; i < samples; i++) {
		const at = i * 3;
		const ahead = i < samples - 1 ? (i + 1) * 3 : at;
		const behind = i > 0 ? (i - 1) * 3 : at;

		const below = Math.asin(Math.max(-1, Math.min(1, path[at + 2]))) / DEG < HORIZON;
		if (!below || !wasBelow) {
			along = 0;
		} else {
			const dot =
				path[at] * path[behind] +
				path[at + 1] * path[behind + 1] +
				path[at + 2] * path[behind + 2];
			along += Math.acos(Math.max(-1, Math.min(1, dot)));
		}
		wasBelow = below;

		for (const side of [-1, 1]) {
			strip[cursor++] = path[at];
			strip[cursor++] = path[at + 1];
			strip[cursor++] = path[at + 2];
			strip[cursor++] = ahead === at ? 2 * path[at] - path[behind] : path[ahead];
			strip[cursor++] = ahead === at ? 2 * path[at + 1] - path[behind + 1] : path[ahead + 1];
			strip[cursor++] = ahead === at ? 2 * path[at + 2] - path[behind + 2] : path[ahead + 2];
			strip[cursor++] = side;
			strip[cursor++] = along;
		}
	}
	return strip;
}

/**
 * Ring radii that grow with distance but never step further than `maxStep`, so
 * far ridges keep enough samples to hold their silhouette.
 */
function buildRadii({ minRadius, maxRadius, growth, minStep, maxStep }: GridOptions): number[] {
	const radii = [0, minRadius];
	let radius = minRadius;

	while (radius < maxRadius) {
		radius += clamp(radius * growth, minStep, maxStep);
		radii.push(Math.min(radius, maxRadius));
	}
	return radii;
}
