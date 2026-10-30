// Turns an image (or a line of text) into a fixed number of target points.
//
// Pipeline: draw the source into an offscreen canvas at layout size → read a
// brightness field → filters (invert, levels, blur, edges, posterize) →
// brightness-weighted stratified sampling → spatial ordering.

const MAX_SAMPLE_DIM = 900; // longest side of the sampling raster, in px
const HILBERT_N = 1024;

/** Load anything drawable. Strings are URLs; Blobs/Files are decoded locally. */
export async function loadSource(src) {
  if (src == null) throw new TypeError('mezzotint: missing source');
  if (typeof src === 'string') {
    const img = new Image();
    img.decoding = 'async';
    img.crossOrigin = 'anonymous';
    img.src = src;
    await img.decode();
    return img;
  }
  if (typeof Blob !== 'undefined' && src instanceof Blob) return createImageBitmap(src);
  return src; // HTMLImageElement, HTMLCanvasElement, ImageBitmap, HTMLVideoElement, { text }
}

function sizeOf(s) {
  return {
    w: s.naturalWidth || s.videoWidth || s.displayWidth || s.width || 0,
    h: s.naturalHeight || s.videoHeight || s.displayHeight || s.height || 0,
  };
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** The box (in sampling px) the source is fitted into. */
function innerBox(w, h, o) {
  const [ax, ay, aw, ah] = o.area;
  const bx = ax * w, by = ay * h, bw = aw * w, bh = ah * h;
  const pad = o.padding * Math.min(bw, bh);
  return { x: bx + pad, y: by + pad, w: Math.max(1, bw - 2 * pad), h: Math.max(1, bh - 2 * pad) };
}

function drawImageFitted(ctx, img, box, o) {
  const { w: iw, h: ih } = sizeOf(img);
  if (!iw || !ih) throw new Error('mezzotint: source has no size (not loaded yet?)');
  const k = (o.fit === 'cover' ? Math.max(box.w / iw, box.h / ih) : Math.min(box.w / iw, box.h / ih)) * o.zoom;
  const dw = iw * k, dh = ih * k;
  const dx = box.x + (box.w - dw) * 0.5 + o.offset[0] * box.w;
  const dy = box.y + (box.h - dh) * 0.5 + o.offset[1] * box.h;
  ctx.save();
  if (o.fit === 'cover') {
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
  }
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

function drawText(ctx, src, box, o) {
  const lines = String(src.text).split('\n');
  const weight = src.weight ?? 800;
  const family = src.font ?? 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const lineHeight = src.lineHeight ?? 1.05;
  const probe = 100;
  ctx.font = `${weight} ${probe}px ${family}`;
  if ('letterSpacing' in ctx && src.letterSpacing) ctx.letterSpacing = `${src.letterSpacing * probe}px`;
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width), 1);
  const size = Math.min((box.w / widest) * probe, box.h / (lines.length * lineHeight)) * o.zoom;
  ctx.font = `${weight} ${size}px ${family}`;
  if ('letterSpacing' in ctx && src.letterSpacing) ctx.letterSpacing = `${src.letterSpacing * size}px`;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = box.x + box.w / 2 + o.offset[0] * box.w;
  const cy = box.y + box.h / 2 + o.offset[1] * box.h;
  const total = lines.length * size * lineHeight;
  lines.forEach((line, i) => ctx.fillText(line, cx, cy - total / 2 + size * lineHeight * (i + 0.5)));
}

/**
 * Looks at the source on its own (not the layout) to learn whether it has
 * transparency, how bright its background is and whether its ink is dark.
 */
function probe(source) {
  const P = 64;
  const ctx = makeCanvas(P, P).getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, P, P);
  const d = ctx.getImageData(0, 0, P, P).data;
  let transparent = 0, border = 0, bn = 0, ink = 0, inkN = 0;
  for (let y = 0; y < P; y++) {
    for (let x = 0; x < P; x++) {
      const p = (y * P + x) * 4;
      const l = (0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) / 255;
      if (d[p + 3] < 250) transparent++;
      if (d[p + 3] > 128) {
        ink += l; inkN++;
        if (x < 2 || y < 2 || x >= P - 2 || y >= P - 2) { border += l; bn++; }
      }
    }
  }
  return {
    hasAlpha: transparent / (P * P) > 0.02,
    borderLuma: bn ? border / bn : 0,
    darkInk: inkN ? ink / inkN < 0.5 : false,
  };
}

/** Draws the source at layout size W×H (CSS px) and returns raw RGBA plus the raster scale. */
export function rasterize(source, W, H, o) {
  const s = Math.min(1, MAX_SAMPLE_DIM / Math.max(W, H, 1));
  const w = Math.max(1, Math.round(W * s));
  const h = Math.max(1, Math.round(H * s));
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const box = innerBox(w, h, o);
  const isText = !!(source && source.text != null);
  if (isText) drawText(ctx, source, box, o);
  else drawImageFitted(ctx, source, box, o);
  const info = isText ? { hasAlpha: false, borderLuma: 0, darkInk: false } : probe(source);
  return { rgba: ctx.getImageData(0, 0, w, h).data, w, h, scale: s, isText, ...info };
}

// ── Filters ────────────────────────────────────────────────────────────────

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const pass = (a, b, horizontal) => {
    const len = horizontal ? w : h;
    const lines = horizontal ? h : w;
    const step = horizontal ? 1 : w;
    for (let l = 0; l < lines; l++) {
      const base = horizontal ? l * w : l;
      let acc = 0;
      let n = 0;
      for (let i = -r; i <= r; i++) {
        if (i >= 0 && i < len) { acc += a[base + i * step]; n++; }
      }
      for (let i = 0; i < len; i++) {
        b[base + i * step] = acc / n;
        const out_ = i - r, in_ = i + r + 1;
        if (out_ >= 0) { acc -= a[base + out_ * step]; n--; }
        if (in_ < len) { acc += a[base + in_ * step]; n++; }
      }
    }
  };
  pass(src, tmp, true);
  pass(tmp, out, false);
  return out;
}

function sobel(f, w, h) {
  const out = new Float32Array(f.length);
  let max = 1e-6;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -f[i - w - 1] - 2 * f[i - 1] - f[i + w - 1] + f[i - w + 1] + 2 * f[i + 1] + f[i + w + 1];
      const gy = -f[i - w - 1] - 2 * f[i - w] - f[i - w + 1] + f[i + w - 1] + 2 * f[i + w] + f[i + w + 1];
      const m = Math.hypot(gx, gy);
      out[i] = m;
      if (m > max) max = m;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] /= max;
  return out;
}

/**
 * Brightness field in 0..1 after filters. Decides automatically whether the
 * picture is "light on dark" (use as is) or "dark on light" (invert), and treats
 * transparent PNGs as shapes.
 */
export function field(r, o) {
  const { rgba, w, h } = r;
  const n = w * h;
  let f = new Float32Array(n);
  const alpha = new Float32Array(n);
  const invert = o.invert === 'auto' ? !r.hasAlpha && !r.isText && r.borderLuma > 0.5 : !!o.invert;

  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const a = rgba[p + 3] / 255;
    let l = (0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2]) / 255;
    alpha[i] = a;
    if (r.isText) { f[i] = a; continue; }
    if (r.hasAlpha) {
      // Transparent PNG: the shape is the alpha; inner detail is kept but softened.
      if (r.darkInk) l = 1 - l;
      if (invert) l = 1 - l;
      f[i] = a * (0.4 + 0.6 * l);
    } else {
      f[i] = a * (invert ? 1 - l : l);
    }
  }

  if (o.brightness || o.contrast || o.gamma !== 1) {
    const c = Math.tan(((Math.max(-0.99, Math.min(0.99, o.contrast)) + 1) * Math.PI) / 4);
    for (let i = 0; i < n; i++) {
      let v = (f[i] - 0.5) * c + 0.5 + o.brightness;
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      f[i] = o.gamma !== 1 ? Math.pow(v, o.gamma) : v;
    }
  }

  const blur = Math.round(o.blur * r.scale);
  if (blur > 0) f = boxBlur(f, w, h, blur);

  if (o.edges > 0) {
    const e = sobel(f, w, h);
    for (let i = 0; i < n; i++) f[i] = f[i] * (1 - o.edges) + Math.min(1, e[i] * 1.6) * o.edges;
  }

  if (o.posterize >= 2) {
    const k = o.posterize - 1;
    for (let i = 0; i < n; i++) f[i] = Math.round(f[i] * k) / k;
  }

  if (o.silhouette) {
    const t = Math.max(0.02, o.threshold);
    for (let i = 0; i < n; i++) f[i] = f[i] > t ? 1 : 0;
  }

  // Nothing outside the drawn picture (letterbox, clipped cover) ever gets dust.
  for (let i = 0; i < n; i++) if (alpha[i] < 0.004) f[i] = 0;
  return f;
}

// ── Ordering ───────────────────────────────────────────────────────────────

function hilbert(x, y) {
  let d = 0;
  for (let s = HILBERT_N >> 1; s > 0; s >>= 1) {
    const rx = (x & s) > 0 ? 1 : 0;
    const ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) { x = HILBERT_N - 1 - x; y = HILBERT_N - 1 - y; }
      const t = x; x = y; y = t;
    }
  }
  return d;
}

function permute(arr, idx) {
  const out = new arr.constructor(arr.length);
  for (let i = 0; i < idx.length; i++) out[i] = arr[idx[i]];
  return out;
}

// ── Sampling ───────────────────────────────────────────────────────────────

/**
 * Picks `count` points with probability proportional to brightness. Stratified
 * along the cumulative distribution, so the dust is even (no clumps, no holes).
 * Returns positions in layout px, brightness 0..1 and the source colour.
 */
export function sample(r, f, count, o, rng = Math.random) {
  const { w, h, rgba, scale } = r;
  const n = w * h;
  const t = Math.min(0.98, Math.max(0, o.threshold));
  const cdf = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const v = f[i];
    if (v > t) total += (v - t) / (1 - t);
    cdf[i] = total;
  }

  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const b = new Float32Array(count);
  const rgb = new Float32Array(count * 3);
  const inv = 1 / scale;

  if (total <= 0) {
    // Nothing bright enough: park invisible particles in the middle.
    for (let i = 0; i < count; i++) { x[i] = (w * inv) / 2; y[i] = (h * inv) / 2; }
    return { x, y, b, rgb, count, empty: true };
  }

  let j = 0;
  for (let i = 0; i < count; i++) {
    const target = ((i + rng()) / count) * total;
    while (j < n - 1 && cdf[j] < target) j++;
    const px = j % w;
    const py = (j / w) | 0;
    x[i] = (px + rng()) * inv;
    y[i] = (py + rng()) * inv;
    b[i] = f[j];
    rgb[i * 3] = rgba[j * 4] / 255;
    rgb[i * 3 + 1] = rgba[j * 4 + 1] / 255;
    rgb[i * 3 + 2] = rgba[j * 4 + 2] / 255;
  }

  // Order the points: along a Hilbert curve ("flow" — neighbours stay
  // neighbours during a morph) or shuffled ("swarm").
  const idx = new Uint32Array(count);
  for (let i = 0; i < count; i++) idx[i] = i;
  if (o.morph === 'swarm') {
    for (let i = count - 1; i > 0; i--) {
      const k = (rng() * (i + 1)) | 0;
      const tmp = idx[i]; idx[i] = idx[k]; idx[k] = tmp;
    }
  } else {
    const W = w * inv, H = h * inv;
    const keys = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const hx = Math.min(HILBERT_N - 1, Math.max(0, ((x[i] / W) * HILBERT_N) | 0));
      const hy = Math.min(HILBERT_N - 1, Math.max(0, ((y[i] / H) * HILBERT_N) | 0));
      keys[i] = hilbert(hx, hy);
    }
    idx.sort((a, c) => keys[a] - keys[c]);
  }

  const rgbOut = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const k = idx[i] * 3;
    rgbOut[i * 3] = rgb[k];
    rgbOut[i * 3 + 1] = rgb[k + 1];
    rgbOut[i * 3 + 2] = rgb[k + 2];
  }
  return { x: permute(x, idx), y: permute(y, idx), b: permute(b, idx), rgb: rgbOut, count, empty: false };
}

/** Preview of the processed field as ImageData (used by the configurator). */
export function fieldPreview(r, f) {
  const out = new ImageData(r.w, r.h);
  for (let i = 0, p = 0; i < f.length; i++, p += 4) {
    const v = Math.round(f[i] * 255);
    out.data[p] = out.data[p + 1] = out.data[p + 2] = v;
    out.data[p + 3] = 255;
  }
  return out;
}
