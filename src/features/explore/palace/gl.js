/* Explore › 3D: a thin WebGL2 layer (DESIGN.md: no 3D library). Programs, instanced vertex arrays, textures, and a
   record of everything created so it can be released at once (leaving Explore, or a lost context). */

/**
 * @param {WebGL2RenderingContext} gl
 */
export function createGL(gl) {
  /** @type {(WebGLBuffer | WebGLTexture | WebGLProgram | WebGLVertexArrayObject)[]} */ const made = [];
  const track = (/** @type {any} */ x) => { made.push(x); return x; };

  /** @param {number} type @param {string} src */
  function shader(type, src) {
    const s = /** @type {WebGLShader} */ (gl.createShader(type));
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      const log = gl.getShaderInfoLog(s) || '';
      const lines = src.split('\n').map((l, i) => `${i + 1}: ${l}`);
      const m = /0:(\d+)/.exec(log), at = m ? +m[1] : 0;
      throw new Error(`palace shader: ${log}\n${lines.slice(Math.max(0, at - 4), at + 2).join('\n')}`);
    }
    return s;
  }

  /**
   * A program from GLSL ES 3.00 sources (the header is added), with its uniform locations.
   * @param {string} vs @param {string} fs
   */
  function program(vs, fs) {
    const head = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\n';
    const p = track(/** @type {WebGLProgram} */ (gl.createProgram()));
    const a = shader(gl.VERTEX_SHADER, head + vs), b = shader(gl.FRAGMENT_SHADER, head + fs);
    gl.attachShader(p, a); gl.attachShader(p, b); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`palace program: ${gl.getProgramInfoLog(p)}`);
    gl.deleteShader(a); gl.deleteShader(b);
    /** @type {Map<string, WebGLUniformLocation | null>} */ const locs = new Map();
    const loc = (/** @type {string} */ n) => { if (!locs.has(n)) locs.set(n, gl.getUniformLocation(p, n)); return locs.get(n) ?? null; };
    return {
      p,
      use() { gl.useProgram(p); return this; },
      /** @param {string} n @param {number} v */ f(n, v) { gl.uniform1f(loc(n), v); return this; },
      /** @param {string} n @param {number} v */ i(n, v) { gl.uniform1i(loc(n), v); return this; },
      /** @param {string} n @param {ArrayLike<number>} v */ v2(n, v) { gl.uniform2fv(loc(n), /** @type {any} */ (v)); return this; },
      /** @param {string} n @param {ArrayLike<number>} v */ v3(n, v) { gl.uniform3fv(loc(n), /** @type {any} */ (v)); return this; },
      /** @param {string} n @param {ArrayLike<number>} v */ v4(n, v) { gl.uniform4fv(loc(n), /** @type {any} */ (v)); return this; },
      /** @param {string} n @param {Float32Array} v */ m4(n, v) { gl.uniformMatrix4fv(loc(n), false, v); return this; },
      /** @param {string} n */ attrib(n) { return gl.getAttribLocation(p, n); },
    };
  }

  /** @param {BufferSource} data @param {number} [usage] @param {number} [target] */
  function buffer(data, usage = gl.STATIC_DRAW, target = gl.ARRAY_BUFFER) {
    const b = track(/** @type {WebGLBuffer} */ (gl.createBuffer()));
    gl.bindBuffer(target, b); gl.bufferData(target, data, usage);
    return b;
  }

  /**
   * A vertex array: attributes by name from buffers.
   * @param {ReturnType<typeof program>} prog
   * @param {{name: string, buf: WebGLBuffer, size: number, type?: number, stride?: number, offset?: number, divisor?: number, norm?: boolean, int?: boolean}[]} attrs
   * @param {WebGLBuffer | null} [index]
   */
  function vao(prog, attrs, index = null) {
    const v = track(/** @type {WebGLVertexArrayObject} */ (gl.createVertexArray()));
    gl.bindVertexArray(v);
    for (const a of attrs) {
      const l = prog.attrib(a.name); if (l < 0) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, a.buf); gl.enableVertexAttribArray(l);
      if (a.int) gl.vertexAttribIPointer(l, a.size, a.type ?? gl.INT, a.stride || 0, a.offset || 0);
      else gl.vertexAttribPointer(l, a.size, a.type ?? gl.FLOAT, !!a.norm, a.stride || 0, a.offset || 0);
      gl.vertexAttribDivisor(l, a.divisor || 0);
    }
    if (index) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bindVertexArray(null);
    return v;
  }

  /**
   * A texture. kind 'f32' (RGBA32F, nearest, data Float32Array), 'r8' from an image or bytes (linear, mipmapped).
   * @param {'f32' | 'r8'} kind @param {number} w @param {number} h @param {ArrayBufferView | TexImageSource | null} data
   */
  function texture(kind, w, h, data) {
    const t = track(/** @type {WebGLTexture} */ (gl.createTexture()));
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    if (kind === 'f32') {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, /** @type {ArrayBufferView} */ (data));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    } else {
      if (data && !ArrayBuffer.isView(data)) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, /** @type {TexImageSource} */ (data));
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, /** @type {ArrayBufferView | null} */ (data));
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /** Replace rows [y0, y0 + rows) of an RGBA32F texture. @param {WebGLTexture} t @param {number} w @param {number} y0 @param {number} rows @param {Float32Array} data the whole texture's data */
  function updateRows(t, w, y0, rows, data) {
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y0, w, rows, gl.RGBA, gl.FLOAT, data, y0 * w * 4);
  }

  /** Release everything this layer created. */
  function release() {
    if (gl.isContextLost()) { made.length = 0; return; }
    for (const x of made) {
      if (x instanceof WebGLBuffer) gl.deleteBuffer(x);
      else if (x instanceof WebGLTexture) gl.deleteTexture(x);
      else if (x instanceof WebGLProgram) gl.deleteProgram(x);
      else if (x instanceof WebGLVertexArrayObject) gl.deleteVertexArray(x);
    }
    made.length = 0;
  }

  return { gl, program, buffer, vao, texture, updateRows, release, get count() { return made.length; } };
}

/** Geometry: a unit box [0,1]³ with normals (36 vertices, 6 floats each), a unit quad, a unit cylinder side and top. */
export function boxGeometry() {
  const f = [];
  // each face: normal, four corners
  const faces = /** @type {[number[], number[][]][]} */ ([
    [[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]],
    [[-1, 0, 0], [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]]],
    [[0, 1, 0], [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]]],
    [[0, 0, 1], [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]]],
    [[0, 0, -1], [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]],
  ]);
  for (const [n, c] of faces) for (const k of [0, 1, 2, 0, 2, 3]) f.push(...c[k], ...n);
  return new Float32Array(f);   // the bottom face is never seen
}

/** A cylinder of radius 1 and height 1 standing on y = 0: side and top, with normals. @param {number} seg */
export function cylinderGeometry(seg) {
  const f = [];
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
    const p0 = [Math.sin(a0), Math.cos(a0)], p1 = [Math.sin(a1), Math.cos(a1)];
    const s = [[p0[0], 0, p0[1]], [p0[0], 1, p0[1]], [p1[0], 1, p1[1]], [p1[0], 0, p1[1]]];
    const n = (/** @type {number[]} */ p) => [p[0], 0, p[2]];
    for (const j of [0, 1, 2, 0, 2, 3]) f.push(...s[j], ...n(s[j]));
    f.push(0, 1, 0, 0, 1, 0, p1[0], 1, p1[1], 0, 1, 0, p0[0], 1, p0[1], 0, 1, 0);
  }
  return new Float32Array(f);
}
