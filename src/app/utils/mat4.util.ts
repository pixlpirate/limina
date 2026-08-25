/**
 * The handful of 4x4 matrix operations the terrain renderer needs. Column-major,
 * matching the layout WebGL expects for `uniformMatrix4fv`.
 */
export type Mat4 = Float32Array;
export type Vec3 = [number, number, number];

export function createMat4(): Mat4 {
	const out = new Float32Array(16);
	out[0] = out[5] = out[10] = out[15] = 1;
	return out;
}

export function perspective(
	out: Mat4,
	fovY: number,
	aspect: number,
	near: number,
	far: number,
): Mat4 {
	const f = 1 / Math.tan(fovY / 2);
	out.fill(0);
	out[0] = f / aspect;
	out[5] = f;
	out[10] = (far + near) / (near - far);
	out[11] = -1;
	out[14] = (2 * far * near) / (near - far);
	return out;
}

export function lookAt(out: Mat4, eye: Vec3, target: Vec3, up: Vec3): Mat4 {
	const z = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
	const x = normalize(cross(up, z));
	const y = cross(z, x);

	out[0] = x[0];
	out[1] = y[0];
	out[2] = z[0];
	out[3] = 0;
	out[4] = x[1];
	out[5] = y[1];
	out[6] = z[1];
	out[7] = 0;
	out[8] = x[2];
	out[9] = y[2];
	out[10] = z[2];
	out[11] = 0;
	out[12] = -dot(x, eye);
	out[13] = -dot(y, eye);
	out[14] = -dot(z, eye);
	out[15] = 1;
	return out;
}

export function multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
	for (let col = 0; col < 4; col++) {
		const b0 = b[col * 4];
		const b1 = b[col * 4 + 1];
		const b2 = b[col * 4 + 2];
		const b3 = b[col * 4 + 3];
		for (let row = 0; row < 4; row++) {
			out[col * 4 + row] = a[row] * b0 + a[4 + row] * b1 + a[8 + row] * b2 + a[12 + row] * b3;
		}
	}
	return out;
}

/** Returns `false` when the matrix is singular, leaving `out` untouched. */
export function invert(out: Mat4, m: Mat4): boolean {
	const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;

	const b00 = a00 * a11 - a01 * a10;
	const b01 = a00 * a12 - a02 * a10;
	const b02 = a00 * a13 - a03 * a10;
	const b03 = a01 * a12 - a02 * a11;
	const b04 = a01 * a13 - a03 * a11;
	const b05 = a02 * a13 - a03 * a12;
	const b06 = a20 * a31 - a21 * a30;
	const b07 = a20 * a32 - a22 * a30;
	const b08 = a20 * a33 - a23 * a30;
	const b09 = a21 * a32 - a22 * a31;
	const b10 = a21 * a33 - a23 * a31;
	const b11 = a22 * a33 - a23 * a32;

	const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
	if (!det) {
		return false;
	}
	const d = 1 / det;

	out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * d;
	out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * d;
	out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * d;
	out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * d;
	out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * d;
	out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * d;
	out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * d;
	out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * d;
	out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * d;
	out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * d;
	out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * d;
	out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * d;
	out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * d;
	out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * d;
	out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * d;
	out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * d;
	return true;
}

/** Multiplies `[x, y, z, 1]` by `m` and returns the clip-space result. */
export function transform(
	m: Mat4,
	x: number,
	y: number,
	z: number,
): [number, number, number, number] {
	return [
		m[0] * x + m[4] * y + m[8] * z + m[12],
		m[1] * x + m[5] * y + m[9] * z + m[13],
		m[2] * x + m[6] * y + m[10] * z + m[14],
		m[3] * x + m[7] * y + m[11] * z + m[15],
	];
}

function cross(a: Vec3, b: Vec3): Vec3 {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function normalizeVec3(a: Vec3): Vec3 {
	return normalize(a);
}

function normalize(a: Vec3): Vec3 {
	const length = Math.hypot(a[0], a[1], a[2]) || 1;
	return [a[0] / length, a[1] / length, a[2] / length];
}
