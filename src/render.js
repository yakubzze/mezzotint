// Two renderers with the same interface: WebGL point sprites (default) and a
// Canvas 2D fallback. Both draw from one interleaved Float32Array per frame:
// [x, y, size, alpha, brightness] per particle, positions in CSS px.

export const STRIDE = 5;

const VERT = `
attribute vec2 a_pos;
attribute float a_size;
attribute float a_alpha;
attribute float a_bright;
attribute vec3 a_rgb;
uniform vec2 u_res;
uniform float u_dpr;
uniform vec3 u_c0;
uniform vec3 u_c1;
uniform float u_source;
varying float v_alpha;
varying float v_px;
varying vec3 v_color;
void main() {
  vec2 clip = a_pos / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  float px = a_size * u_dpr;
  // Sub-pixel particles keep their energy as transparency instead of size.
  v_alpha = a_alpha * min(1.0, px);
  v_px = max(1.0, px);
  gl_PointSize = v_px;
  v_color = mix(mix(u_c0, u_c1, a_bright), a_rgb, u_source);
}`;

const FRAG = `
precision mediump float;
varying float v_alpha;
varying float v_px;
varying vec3 v_color;
void main() {
  float a = v_alpha;
  if (v_px > 2.5) {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    a *= 1.0 - smoothstep(1.0 - 1.6 / v_px, 1.0, d);
  }
  if (a <= 0.003) discard;
  gl_FragColor = vec4(v_color * a, a);
}`;

/** Parses any CSS colour into [r, g, b] in 0..1. */
export function parseColor(css) {
  if (Array.isArray(css)) return css;
  const c = document.createElement('canvas').getContext('2d');
  c.fillStyle = '#000';
  c.fillStyle = css;
  const v = c.fillStyle; // normalised to #rrggbb or rgba()
  if (v[0] === '#') return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const m = v.match(/[\d.]+/g) || [0, 0, 0];
  return [m[0] / 255, m[1] / 255, m[2] / 255];
}

class WebGLRenderer {
  static create(canvas) {
    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    return gl ? new WebGLRenderer(gl) : null;
  }

  constructor(gl) {
    this.kind = 'webgl';
    this.gl = gl;
    this.lost = false;
    gl.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    gl.canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.init(); });
    this.init();
  }

  init() {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    gl.useProgram(p);
    this.loc = {};
    for (const a of ['a_pos', 'a_size', 'a_alpha', 'a_bright', 'a_rgb']) this.loc[a] = gl.getAttribLocation(p, a);
    for (const u of ['u_res', 'u_dpr', 'u_c0', 'u_c1', 'u_source']) this.loc[u] = gl.getUniformLocation(p, u);
    this.buf = gl.createBuffer();
    this.rgbBuf = gl.createBuffer();
    this.capacity = 0;
    this.rgbCount = 0;
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
  }

  resize(w, h, dpr) {
    const c = this.gl.canvas;
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    this.w = w; this.h = h; this.dpr = dpr;
    this.gl.viewport(0, 0, c.width, c.height);
  }

  setColors(rgb) {
    const gl = this.gl;
    this.rgbCount = rgb ? rgb.length / 3 : 0;
    if (!rgb) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rgbBuf);
    gl.bufferData(gl.ARRAY_BUFFER, rgb, gl.STATIC_DRAW);
  }

  draw(data, count, look) {
    if (this.lost) return;
    const gl = this.gl;
    const L = this.loc;
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!count) return;
    if (look.blend === 'normal') gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    else gl.blendFunc(gl.ONE, gl.ONE);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    if (count * STRIDE > this.capacity) {
      this.capacity = data.length;
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, count * STRIDE));
    }
    const B = 4 * STRIDE;
    const attr = (loc, size, offset) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, B, offset * 4);
    };
    attr(L.a_pos, 2, 0);
    attr(L.a_size, 1, 2);
    attr(L.a_alpha, 1, 3);
    attr(L.a_bright, 1, 4);

    const source = look.source && this.rgbCount >= count;
    if (source) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.rgbBuf);
      gl.enableVertexAttribArray(L.a_rgb);
      gl.vertexAttribPointer(L.a_rgb, 3, gl.FLOAT, false, 0, 0);
    } else {
      gl.disableVertexAttribArray(L.a_rgb);
      gl.vertexAttrib3f(L.a_rgb, 1, 1, 1);
    }
    gl.uniform2f(L.u_res, this.w, this.h);
    gl.uniform1f(L.u_dpr, this.dpr);
    gl.uniform3fv(L.u_c0, look.c0);
    gl.uniform3fv(L.u_c1, look.c1);
    gl.uniform1f(L.u_source, source ? 1 : 0);
    gl.drawArrays(gl.POINTS, 0, count);
  }
}

class CanvasRenderer {
  constructor(canvas) {
    this.kind = '2d';
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.rgb = null;
  }

  resize(w, h, dpr) {
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.w = w; this.h = h; this.dpr = dpr;
  }

  setColors(rgb) { this.rgb = rgb; }

  draw(data, count, look) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.globalCompositeOperation = look.blend === 'normal' ? 'source-over' : 'lighter';
    const hex = (c) => `rgb(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0})`;
    const source = look.source && this.rgb && this.rgb.length >= count * 3;
    // Group by alpha to keep state changes low; colour follows the bucket brightness.
    const LEVELS = 8;
    for (let level = 1; level <= LEVELS; level++) {
      const lo = (level - 1) / LEVELS, hi = level / LEVELS;
      ctx.globalAlpha = hi;
      const k = (level - 0.5) / LEVELS;
      if (!source) ctx.fillStyle = hex(look.c0.map((v, i) => v + (look.c1[i] - v) * k));
      for (let i = 0, p = 0; i < count; i++, p += STRIDE) {
        const a = data[p + 3];
        if (a <= lo || a > hi) continue;
        const s = data[p + 2];
        if (source) ctx.fillStyle = hex([this.rgb[i * 3], this.rgb[i * 3 + 1], this.rgb[i * 3 + 2]]);
        ctx.fillRect(data[p] - s / 2, data[p + 1] - s / 2, s, s);
      }
    }
    ctx.globalAlpha = 1;
  }
}

export function createRenderer(canvas, kind = 'auto') {
  if (kind !== '2d') {
    try {
      const r = WebGLRenderer.create(canvas);
      if (r) return r;
    } catch (err) {
      console.warn('mezzotint: WebGL unavailable, using Canvas 2D', err);
    }
  }
  return new CanvasRenderer(canvas);
}
