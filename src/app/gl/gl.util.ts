/** Thin WebGL2 helpers — just enough to keep the renderer readable. */

export function compileProgram(
	gl: WebGL2RenderingContext,
	vertexSource: string,
	fragmentSource: string,
): WebGLProgram {
	const program = gl.createProgram();
	const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
	const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

	gl.attachShader(program, vertex);
	gl.attachShader(program, fragment);
	gl.linkProgram(program);
	gl.deleteShader(vertex);
	gl.deleteShader(fragment);

	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const log = gl.getProgramInfoLog(program);
		gl.deleteProgram(program);
		throw new Error(`Program link failed: ${log}`);
	}
	return program;
}

/** Caches every active uniform location up front, keyed by name. */
export function uniformLocations(
	gl: WebGL2RenderingContext,
	program: WebGLProgram,
): Record<string, WebGLUniformLocation> {
	const locations: Record<string, WebGLUniformLocation> = {};
	const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;

	for (let i = 0; i < count; i++) {
		const info = gl.getActiveUniform(program, i);
		if (!info) {
			continue;
		}
		const name = info.name.replace(/\[0\]$/, '');
		const location = gl.getUniformLocation(program, name);
		if (location) {
			locations[name] = location;
		}
	}
	return locations;
}

export function createTexture(
	gl: WebGL2RenderingContext,
	filter: GLenum = gl.NEAREST,
): WebGLTexture {
	const texture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	return texture;
}

function compileShader(gl: WebGL2RenderingContext, type: GLenum, source: string): WebGLShader {
	const shader = gl.createShader(type);
	if (!shader) {
		throw new Error('Unable to create shader');
	}
	gl.shaderSource(shader, source);
	gl.compileShader(shader);

	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const log = gl.getShaderInfoLog(shader);
		gl.deleteShader(shader);
		throw new Error(`Shader compile failed: ${log}`);
	}
	return shader;
}
