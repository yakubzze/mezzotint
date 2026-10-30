// mezzotint — images made of living dust.
// https://github.com/yakubzze/mezzotint · MIT · by GTLR (https://gtlr.studio)
//
// One canvas, N particles. Every image (or line of text) becomes N target
// points; particles spring towards them, drift, react to the pointer and flow
// from one shape to the next.

import { loadSource, rasterize, field, sample, fieldPreview } from './sample.js';
import { createRenderer, parseColor, STRIDE } from './render.js';

export const version = '0.1.0';

export const defaults = Object.freeze({
  // particles
  particles: 'auto', // number, or 'auto' (scaled to canvas area and device)
  renderer: 'auto', // 'auto' (WebGL, falls back to Canvas 2D) | 'webgl' | '2d'
  maxDpr: 2,

  // look
  color: '#ffffff', // CSS colour | [dark, bright] gradient by brightness | 'source' (colours of the image)
  size: [0.6, 2.2], // particle size in CSS px for the darkest / brightest points
  opacity: 1,
  blend: 'add', // 'add' (light accumulates) | 'normal'
  twinkle: 0.2, // 0..1

  // motion
  spring: 0.06, // pull towards the target
  friction: 0.86, // velocity kept per frame
  drift: 0.7, // idle wander in px
  driftSpeed: 1,
  intro: 'implode', // 'implode' | 'scatter' | 'rise' | 'none'

  // morphing between shapes
  morph: 'flow', // 'flow' (neighbours stay neighbours) | 'swarm' (every particle goes anywhere)
  scatter: 0.35, // 0..1 burst while leaving a shape
  stagger: 0.4, // 0..1 how spread out the departures are
  sweep: 'random', // 'random' | 'left' | 'right' | 'up' | 'down' | 'center' | 'edges'

  // sampling (can also be passed per shape)
  fit: 'contain', // 'contain' | 'cover'
  area: [0, 0, 1, 1], // [x, y, w, h] of the canvas the shape is fitted into, 0..1 (or a function returning it)
  padding: 0.06, // margin inside the area, fraction of its shorter side
  zoom: 1,
  offset: [0, 0], // nudge, fraction of the area
  threshold: 0.08, // darker than this is ignored
  gamma: 1,
  contrast: 0, // -1..1
  brightness: 0, // -1..1
  blur: 0, // px
  edges: 0, // 0..1 mix of an edge-detected outline
  posterize: 0, // 0 = off, else number of levels
  silhouette: false, // hard threshold: a flat, even shape
  invert: 'auto', // 'auto' (dark ink on a light background gets inverted) | true | false

  // pointer
  pointer: 'repel', // 'repel' | 'attract' | 'vortex' | 'none'
  pointerRadius: 110,
  pointerStrength: 1,
  pressBurst: true, // press and hold to blast the dust apart

  // runtime
  autoplay: true,
  pauseOffscreen: true,
  reducedMotion: 'auto', // 'auto' (follow the OS setting) | true | false
});

const SAMPLE_KEYS = ['fit', 'area', 'padding', 'zoom', 'offset', 'threshold', 'gamma', 'contrast',
  'brightness', 'blur', 'edges', 'posterize', 'silhouette', 'invert', 'morph'];
const STEP = 1 / 60;
const TAU = Math.PI * 2;

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export class Mezzotint {
  /**
   * @param {HTMLCanvasElement|string} canvas  a canvas element or selector
   * @param {Partial<typeof defaults>} options
   */
  constructor(canvas, options = {}) {
    if (typeof canvas === 'string') canvas = document.querySelector(canvas);
    if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('mezzotint: expected a <canvas> element');
    this.canvas = canvas;
    this.o = { ...defaults, ...options };
    this.renderer = createRenderer(canvas, this.o.renderer);
    this.shapes = new Set();
    this.current = null;
    this.blending = null;
    this.placed = false;
    this.time = 0;
    this.acc = 0;
    this.capStart = -1e9;
    this.introStart = -1e9;
    this.kick = 0;
    this.pending = false;
    this.settled = false;
    this.visible = true;
    this.running = false;
    this.token = 0;
    this.pointer = { x: 0, y: 0, active: false, down: false, held: 0 };
    this._motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
    this._updateReduced();
    this._measure();
    this._alloc(this._count());
    this._look();
    this._bind();
    if (this.o.autoplay) this.play();
  }

  /** Current options (read-only copy). */
  get options() { return { ...this.o }; }

  /** Number of particles. */
  get count() { return this.n; }

  /** 'webgl' or '2d'. */
  get rendererKind() { return this.renderer.kind; }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Loads and samples a source without showing it. Keep the returned shape to
   * show or blend it later; it is re-sampled automatically when the canvas resizes.
   * @param {string|Blob|CanvasImageSource|{text:string}} source
   */
  async load(source, opts = {}) {
    const shape = { source, opts, keep: true, img: await loadSource(source) };
    this._sampleShape(shape);
    this.shapes.add(shape);
    return shape;
  }

  /** Shows a source (or a loaded shape). The first one plays the intro, later ones morph. */
  async show(source, opts = {}) {
    const token = ++this.token;
    let shape = source;
    if (!isShape(source)) {
      shape = { source, opts, keep: false, img: await loadSource(source) };
      if (token !== this.token) return shape; // a newer show() won the race
      this._sampleShape(shape);
      this.shapes.add(shape);
    }
    this._retire(shape);
    this.blending = null;
    this.current = shape;
    this.renderer.setColors(shape.rgb);
    if (!this.placed || this.reduced) this._place(shape, this.placed || this.reduced ? 'none' : this.o.intro);
    else this._morph(shape, { ...this.o, ...opts });
    this._wake();
    return shape;
  }

  /** Shorthand for show({ text }). */
  text(text, opts = {}) {
    const { font, weight, lineHeight, letterSpacing, ...rest } = opts;
    return this.show({ text, font, weight, lineHeight, letterSpacing }, rest);
  }

  /**
   * Scrubs between two loaded shapes, t in 0..1. Used by story(); call it from
   * your own scroll or timeline code too.
   */
  blend(a, b, t, opts = {}) {
    if (!isShape(a) || !isShape(b)) return;
    t = clamp01(t);
    if (!this.placed) {
      this.current = t < 0.5 ? a : b;
      this.renderer.setColors(this.current.rgb);
      this._place(this.current, this.reduced ? 'none' : this.o.intro);
    }
    this.pending = false;
    this.blending = { a, b, t, scatter: opts.scatter ?? this.o.scatter };
    const shown = t < 0.5 ? a : b;
    if (this.current !== shown) {
      this.current = shown;
      this.renderer.setColors(shown.rgb);
    }
    this._applyBlend();
    this._wake();
  }

  /** Plays the intro again on whatever is shown. */
  replay(intro = this.o.intro) {
    const blending = this.blending;
    const s = blending ? (blending.t < 0.5 ? blending.a : blending.b) : this.current;
    if (!s) return;
    this.placed = false;
    this._place(s, this.reduced ? 'none' : intro);
    if (blending) this._applyBlend();
    this._wake();
  }

  /** Throws the dust outwards from the centre (or from x, y). */
  burst(strength = 1, x = this.w / 2, y = this.h / 2) {
    for (let i = 0; i < this.n; i++) {
      const dx = this.px[i] - x, dy = this.py[i] - y;
      const d = Math.hypot(dx, dy) || 1;
      const f = strength * (6 + 10 * this.seed[i]);
      this.vx[i] += (dx / d) * f + Math.cos(this.dir[i]) * f * 0.4;
      this.vy[i] += (dy / d) * f + Math.sin(this.dir[i]) * f * 0.4;
    }
    this.capStart = this.time - 6;
    this._wake();
  }

  /** Changes options on the fly; re-samples shapes when sampling options change. */
  set(options = {}) {
    const prev = this.o;
    this.o = { ...this.o, ...options };
    if ('reducedMotion' in options) this._updateReduced();
    if ('color' in options || 'blend' in options) this._look();
    if ('maxDpr' in options) this._measure(true);
    const recount = 'particles' in options && this._count() !== this.n;
    const resample = SAMPLE_KEYS.some((k) => k in options && !same(prev[k], options[k]));
    if (recount || resample) {
      if (recount) this._alloc(this._count());
      this._resampleAll();
      if (this.blending) this._applyBlend();
      else this._retarget();
    }
    this._wake();
    return this;
  }

  /** The processed brightness field of the current shape, as ImageData (for previews). */
  inspect() {
    const s = this.current;
    if (!s) return null;
    const so = this._sampleOpts(s.opts);
    const r = rasterize(s.img, this.w, this.h, so);
    return fieldPreview(r, field(r, so));
  }

  /** Renders a frame and returns it as an image Blob. */
  snapshot(type = 'image/png', quality) {
    this._render();
    return new Promise((resolve) => this.canvas.toBlob(resolve, type, quality));
  }

  play() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this._tick);
  }

  pause() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  destroy() {
    this.pause();
    this._unbind();
    this.shapes.clear();
    this.current = null;
  }

  // ── Setup ────────────────────────────────────────────────────────────────

  _updateReduced() {
    const m = this.o.reducedMotion;
    this.reduced = m === 'auto' ? this._motionQuery.matches : !!m;
  }

  _count() {
    const p = this.o.particles;
    if (typeof p === 'number' && isFinite(p)) return Math.max(100, Math.min(200000, Math.round(p)));
    const coarse = matchMedia('(pointer: coarse)').matches;
    const n = Math.round((this.w * this.h) / (coarse ? 60 : 55));
    return Math.max(2500, Math.min(coarse ? 9000 : 24000, n));
  }

  _measure(force) {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    const dpr = Math.min(this.o.maxDpr, window.devicePixelRatio || 1);
    const changed = w !== this.w || h !== this.h || dpr !== this.dpr;
    this.w = w; this.h = h; this.dpr = dpr;
    if (changed || force) this.renderer.resize(w, h, dpr);
    return changed;
  }

  _alloc(n) {
    const old = this.n ? { n: this.n, px: this.px, py: this.py, vx: this.vx, vy: this.vy } : null;
    this.n = n;
    const F = () => new Float32Array(n);
    this.px = F(); this.py = F(); this.vx = F(); this.vy = F();
    this.tx = F(); this.ty = F(); this.tb = F(); this.b = F();
    this.nx = F(); this.ny = F(); this.nb = F(); this.switchAt = F();
    this.ease = F(); this.fade = F(); this.fadeAt = F();
    this.seed = F(); this.phase = F(); this.freq = F(); this.dir = F();
    this.data = new Float32Array(n * STRIDE);
    const rnd = mulberry32(7);
    for (let i = 0; i < n; i++) {
      this.seed[i] = rnd();
      this.phase[i] = rnd() * TAU;
      this.freq[i] = 0.5 + rnd() * 0.9;
      this.dir[i] = rnd() * TAU;
      this.ease[i] = this.o.spring;
      this.switchAt[i] = -1;
      this.px[i] = rnd() * this.w;
      this.py[i] = rnd() * this.h;
      this.fade[i] = old ? 1 : 0;
    }
    if (old) {
      for (let i = 0; i < n; i++) {
        const j = i % old.n;
        this.px[i] = old.px[j] + (i >= old.n ? (this.seed[i] - 0.5) * 30 : 0);
        this.py[i] = old.py[j] + (i >= old.n ? (this.phase[i] / TAU - 0.5) * 30 : 0);
        this.vx[i] = old.vx[j];
        this.vy[i] = old.vy[j];
      }
    }
  }

  _look() {
    const c = this.o.color;
    let c0 = [1, 1, 1], c1 = [1, 1, 1];
    const source = c === 'source';
    if (Array.isArray(c) && typeof c[0] === 'string') { c0 = parseColor(c[0]); c1 = parseColor(c[1] ?? c[0]); }
    else if (!source) c0 = c1 = parseColor(c);
    this.look = { blend: this.o.blend, c0, c1, source };
  }

  _bind() {
    const P = this.pointer;
    const locate = (e) => {
      const r = this.canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      P.x = (x / (r.width || 1)) * this.w;
      P.y = (y / (r.height || 1)) * this.h;
      return x >= 0 && y >= 0 && x <= r.width && y <= r.height;
    };
    this._on = {
      move: (e) => {
        const inside = locate(e);
        P.active = inside && (e.pointerType !== 'touch' || P.down);
        if (P.active) this._wake();
      },
      down: (e) => {
        const inside = locate(e);
        if (!inside) return;
        P.active = true;
        // Touch scrolls the page; only mouse and pen get the press burst.
        P.down = e.pointerType !== 'touch';
        P.touch = e.pointerType === 'touch';
        P.held = 0;
        this._wake();
      },
      up: () => {
        P.down = false;
        if (P.touch) P.active = false;
      },
      out: (e) => { if (!e.relatedTarget) { P.active = false; P.down = false; } },
      motion: () => this._updateReduced(),
    };
    addEventListener('pointermove', this._on.move, { passive: true });
    addEventListener('pointerdown', this._on.down, { passive: true });
    addEventListener('pointerup', this._on.up, { passive: true });
    addEventListener('pointercancel', this._on.up, { passive: true });
    document.addEventListener('mouseout', this._on.out);
    this._motionQuery.addEventListener?.('change', this._on.motion);

    let timer = 0;
    this._ro = new ResizeObserver(() => {
      if (!this._measure()) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        this._resampleAll();
        if (this.blending) this._applyBlend();
        else this._retarget();
        this._wake();
      }, 120);
      this._render();
    });
    this._ro.observe(this.canvas);

    this._io = new IntersectionObserver(([entry]) => {
      this.visible = !this.o.pauseOffscreen || entry.isIntersecting;
      if (this.visible) this.last = performance.now();
    });
    this._io.observe(this.canvas);
  }

  _unbind() {
    removeEventListener('pointermove', this._on.move);
    removeEventListener('pointerdown', this._on.down);
    removeEventListener('pointerup', this._on.up);
    removeEventListener('pointercancel', this._on.up);
    document.removeEventListener('mouseout', this._on.out);
    this._motionQuery.removeEventListener?.('change', this._on.motion);
    this._ro.disconnect();
    this._io.disconnect();
  }

  // ── Shapes ───────────────────────────────────────────────────────────────

  _sampleOpts(opts = {}) {
    const so = {};
    for (const k of SAMPLE_KEYS) {
      const v = k in opts ? opts[k] : this.o[k];
      so[k] = typeof v === 'function' ? v(this.w, this.h) : v;
    }
    return so;
  }

  _sampleShape(shape) {
    const so = this._sampleOpts(shape.opts);
    const r = rasterize(shape.img, this.w, this.h, so);
    Object.assign(shape, sample(r, field(r, so), this.n, so, mulberry32(1234)));
  }

  _resampleAll() {
    for (const s of this.shapes) this._sampleShape(s);
    if (this.current) this.renderer.setColors(this.current.rgb);
  }

  /** Forget temporary shapes that are no longer needed. */
  _retire(next) {
    for (const s of this.shapes) {
      if (!s.keep && s !== next) this.shapes.delete(s);
    }
  }

  // ── Targets ──────────────────────────────────────────────────────────────

  _place(shape, intro) {
    const n = this.n, w = this.w, h = this.h, t = this.time;
    const cx = w / 2, cy = h / 2, r0 = Math.min(w, h) * 0.04;
    for (let i = 0; i < n; i++) {
      const x = shape.x[i], y = shape.y[i], s = this.seed[i];
      this.tx[i] = x; this.ty[i] = y; this.tb[i] = shape.b[i];
      this.b[i] = shape.b[i];
      this.switchAt[i] = -1;
      if (intro === 'none') {
        if (!this.placed || this.reduced) { this.px[i] = x; this.py[i] = y; this.vx[i] = 0; this.vy[i] = 0; }
        this.fade[i] = 1;
        this.ease[i] = this.o.spring;
        continue;
      }
      const a = this.dir[i];
      if (intro === 'scatter') {
        this.px[i] = this.seed[(i * 7) % n] * w;
        this.py[i] = s * h;
        this.vx[i] = 0; this.vy[i] = 0;
        this.fadeAt[i] = t + s * 0.6;
      } else if (intro === 'rise') {
        this.px[i] = x + (this.seed[(i * 13) % n] - 0.5) * w * 0.1;
        this.py[i] = h + s * h * 0.5;
        this.vx[i] = 0; this.vy[i] = -2 - s * 4;
        this.fadeAt[i] = t + s * 0.4;
      } else {
        this.px[i] = cx + Math.cos(a) * r0 * s;
        this.py[i] = cy + Math.sin(a) * r0 * s;
        this.vx[i] = (Math.cos(this.phase[i]) * 20) * s;
        this.vy[i] = (Math.sin(this.phase[i]) * 20) * s;
        this.fadeAt[i] = t + s * 0.25;
      }
      this.fade[i] = 0;
      this.ease[i] = this.o.spring * 0.02;
    }
    this.placed = true;
    this.pending = false;
    if (intro !== 'none') {
      this.capStart = t;
      this.introStart = intro === 'implode' ? t : -1e9;
    }
  }

  _sweepOrder(sweep) {
    const n = this.n, w = this.w, h = this.h;
    const out = new Float32Array(n);
    const cx = w / 2, cy = h / 2, R = Math.hypot(cx, cy);
    for (let i = 0; i < n; i++) {
      const x = this.px[i] / w, y = this.py[i] / h;
      switch (sweep) {
        case 'left': out[i] = x; break;
        case 'right': out[i] = 1 - x; break;
        case 'down': out[i] = y; break;
        case 'up': out[i] = 1 - y; break;
        case 'center': out[i] = Math.hypot(this.px[i] - cx, this.py[i] - cy) / R; break;
        case 'edges': out[i] = 1 - Math.hypot(this.px[i] - cx, this.py[i] - cy) / R; break;
        default: out[i] = this.seed[i];
      }
      out[i] = clamp01(out[i] * 0.85 + this.seed[i] * 0.15);
    }
    return out;
  }

  _morph(shape, o) {
    const n = this.n, t = this.time;
    const spread = clamp01(o.stagger) * 1.4; // seconds between first and last departure
    const order = this._sweepOrder(o.sweep);
    for (let i = 0; i < n; i++) {
      this.nx[i] = shape.x[i];
      this.ny[i] = shape.y[i];
      this.nb[i] = shape.b[i];
      this.switchAt[i] = t + order[i] * spread;
    }
    this.kick = clamp01(o.scatter) * 9;
    this.pending = true;
    this.pendingUntil = t + spread + STEP;
    this.capStart = t - 0.8;
  }

  /** Moves targets to the (re-sampled) current shape without a transition. */
  _retarget() {
    const s = this.current;
    if (!s) return;
    this.pending = false;
    for (let i = 0; i < this.n; i++) {
      this.tx[i] = s.x[i]; this.ty[i] = s.y[i]; this.tb[i] = s.b[i];
      this.switchAt[i] = -1;
    }
  }

  /**
   * Scrub targets between two shapes. Each particle has its own short flight
   * window, so halfway through you see part of the old shape, part of the new
   * one and dust in the air between them.
   */
  _applyBlend() {
    const { a, b, t, scatter } = this.blending;
    const n = this.n, w = this.w, h = this.h;
    const R = clamp01(scatter) * 0.22 * Math.min(w, h);
    const spread = 0.25 + clamp01(this.o.stagger) * 0.55;
    const sweep = this.o.sweep;
    const cx = w / 2, cy = h / 2, diag = Math.hypot(cx, cy);
    for (let i = 0; i < n; i++) {
      const s = this.seed[i];
      let order = s;
      if (sweep !== 'random') {
        const x = a.x[i], y = a.y[i];
        order = sweep === 'left' ? x / w : sweep === 'right' ? 1 - x / w : sweep === 'down' ? y / h
          : sweep === 'up' ? 1 - y / h : sweep === 'center' ? Math.hypot(x - cx, y - cy) / diag
            : sweep === 'edges' ? 1 - Math.hypot(x - cx, y - cy) / diag : s;
        order = clamp01(order * 0.85 + s * 0.15);
      }
      const u = clamp01((t - order * spread) / (1 - spread));
      const e = u * u * (3 - 2 * u);
      const k = R * (0.25 + s) * Math.sin(Math.PI * u);
      this.tx[i] = a.x[i] + (b.x[i] - a.x[i]) * e + Math.cos(this.dir[i]) * k;
      this.ty[i] = a.y[i] + (b.y[i] - a.y[i]) * e + Math.sin(this.dir[i]) * k;
      this.tb[i] = a.b[i] + (b.b[i] - a.b[i]) * e;
      this.switchAt[i] = -1;
      if (this.reduced) { this.px[i] = this.tx[i]; this.py[i] = this.ty[i]; this.b[i] = this.tb[i]; }
    }
  }

  // ── Simulation ───────────────────────────────────────────────────────────

  _wake() { this.settled = false; }

  _tick = (now) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this._tick);
    const elapsed = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.visible) return;
    this.acc += elapsed;
    let steps = 0;
    while (this.acc >= STEP && steps < 4) {
      this._step();
      this.acc -= STEP;
      steps++;
    }
    if (steps === 4) this.acc = 0;
    if (this.pointer.down) this.pointer.held += elapsed;
    if (steps && !this.settled) this._render();
  };

  _step() {
    const o = this.o, n = this.n;
    const t = (this.time += STEP);
    const { px, py, vx, vy, tx, ty, b, tb, ease, seed, phase, freq, dir, fade, fadeAt } = this;
    const spring = o.spring, fr = o.friction;
    const reduced = this.reduced;
    const drift = reduced ? 0 : o.drift;
    const ds = o.driftSpeed;

    // pointer
    const P = this.pointer;
    const mode = reduced ? 'none' : o.pointer;
    const pointerOn = mode !== 'none' && P.active;
    const pressing = pointerOn && P.down && o.pressBurst;
    const hold = pressing ? Math.min(1, P.held / 0.9) : 0;
    const R = o.pointerRadius * (pressing ? 1.5 + hold : 1);
    const R2 = R * R;
    const force = o.pointerStrength * 5 * (pressing ? 1.6 + hold * 3 : 1);

    // speed limit, lifted gradually after an intro or a morph
    const since = t - this.capStart;
    const cap = since < 5 ? 3 + since * since * 4 : 1e9;
    const cap2 = cap * cap;
    const swirl = reduced ? 0 : Math.max(0, 1 - (t - this.introStart) / 1.6);

    // pending morph
    const pending = this.pending;
    const kick = this.kick;
    if (pending && t > this.pendingUntil) this.pending = false;

    let moving = 0;
    for (let i = 0; i < n; i++) {
      if (pending && this.switchAt[i] >= 0 && this.switchAt[i] <= t) {
        tx[i] = this.nx[i]; ty[i] = this.ny[i]; tb[i] = this.nb[i];
        this.switchAt[i] = -1;
        if (kick > 0 && !reduced) {
          const a = dir[i] + t * 0.7;
          vx[i] += Math.cos(a) * kick * (0.3 + seed[i]);
          vy[i] += Math.sin(a) * kick * (0.3 + seed[i]);
        }
        ease[i] = spring * 0.12;
      }
      ease[i] += (spring - ease[i]) * 0.035;

      let gx = tx[i], gy = ty[i];
      if (drift) {
        const f = freq[i] * ds, amp = drift * (0.4 + seed[i]);
        gx += Math.sin(t * f + phase[i]) * amp;
        gy += Math.cos(t * f * 0.83 + phase[i] * 1.7) * amp;
      }
      let ax = (gx - px[i]) * ease[i];
      let ay = (gy - py[i]) * ease[i];

      if (swirl > 0) {
        const s = swirl * swirl * 1.2 * (0.5 + seed[i]);
        ax += Math.cos(t * 3 + phase[i]) * s;
        ay += Math.sin(t * 3 + phase[i]) * s;
      }

      if (pointerOn) {
        const dx = px[i] - P.x, dy = py[i] - P.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < R2) {
          const d = Math.sqrt(d2) || 1;
          const k = 1 - d / R;
          const f = k * k * force;
          const ux = dx / d, uy = dy / d;
          if (pressing) {
            ax += ux * f + -uy * f * 0.6;
            ay += uy * f + ux * f * 0.6;
          } else if (mode === 'attract') {
            ax -= ux * f * 0.35;
            ay -= uy * f * 0.35;
          } else if (mode === 'vortex') {
            ax += -uy * f * 0.8 + ux * f * 0.15;
            ay += ux * f * 0.8 + uy * f * 0.15;
          } else {
            ax += ux * f;
            ay += uy * f;
          }
        }
      }

      let nvx = (vx[i] + ax) * fr;
      let nvy = (vy[i] + ay) * fr;
      const sp2 = nvx * nvx + nvy * nvy;
      if (sp2 > cap2) {
        const s = cap / Math.sqrt(sp2);
        nvx *= s; nvy *= s;
      }
      vx[i] = nvx; vy[i] = nvy;
      px[i] += nvx; py[i] += nvy;
      b[i] += (tb[i] - b[i]) * 0.06;
      if (fade[i] < 1 && t >= fadeAt[i]) fade[i] = Math.min(1, fade[i] + STEP / 0.8);
      if (sp2 > 0.0004) moving++;
    }

    // Nothing moves and nothing will: stop drawing until something changes.
    if (!moving && !drift && !(o.twinkle > 0 && !reduced) && !this.pending && !P.active) this.settled = true;
  }

  _render() {
    const o = this.o, n = this.n, d = this.data;
    const { px, py, b, fade, freq, phase } = this;
    const s0 = o.size[0], ds = o.size[1] - o.size[0];
    const op = o.opacity;
    const tw = this.reduced ? 0 : clamp01(o.twinkle);
    const t = this.time;
    for (let i = 0, p = 0; i < n; i++, p += STRIDE) {
      const bb = b[i];
      let a = op * bb * (2 - bb) * fade[i];
      if (tw) a *= 1 - tw * (0.5 + 0.5 * Math.sin(t * (1.1 + freq[i] * 2.4) + phase[i]));
      d[p] = px[i];
      d[p + 1] = py[i];
      d[p + 2] = s0 + ds * bb;
      d[p + 3] = a;
      d[p + 4] = bb;
    }
    this.renderer.draw(d, n, this.look);
  }
}

function isShape(s) {
  return !!s && s.x instanceof Float32Array && s.y instanceof Float32Array;
}

export { loadSource, rasterize, field, sample, fieldPreview };
export { story } from './story.js';
export default Mezzotint;
