import { Mezzotint, defaults, version } from '../src/mezzotint.js';
import { SAMPLES } from './samples.js';

// ── Storage (this browser only) ──────────────────────────────────────────

const KEYS = { last: 'mezzotint:last', presets: 'mezzotint:presets' };
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
};

// ── Controls ─────────────────────────────────────────────────────────────

const pct = (v) => `${Math.round(v * 100)}%`;
const GROUPS = [
  {
    title: 'Image',
    open: true,
    items: [
      { key: 'invert', label: 'Invert', type: 'select', options: [['auto', 'Auto'], [true, 'Invert'], [false, 'Keep as is']] },
      { key: 'threshold', label: 'Threshold', type: 'range', min: 0, max: 0.9, step: 0.01, format: pct },
      { key: 'contrast', label: 'Contrast', type: 'range', min: -0.9, max: 0.9, step: 0.01 },
      { key: 'brightness', label: 'Brightness', type: 'range', min: -0.6, max: 0.6, step: 0.01 },
      { key: 'gamma', label: 'Gamma', type: 'range', min: 0.3, max: 3, step: 0.05 },
      { key: 'blur', label: 'Blur', type: 'range', min: 0, max: 12, step: 0.5, format: (v) => `${v}px` },
      { key: 'edges', label: 'Edges', type: 'range', min: 0, max: 1, step: 0.01, format: pct },
      { key: 'posterize', label: 'Posterize', type: 'range', min: 0, max: 8, step: 1, format: (v) => (v < 2 ? 'off' : `${v} levels`) },
      { key: 'silhouette', label: 'Flat silhouette', type: 'check' },
      { key: 'fit', label: 'Fit', type: 'select', options: [['contain', 'Contain'], ['cover', 'Cover']] },
      { key: 'zoom', label: 'Zoom', type: 'range', min: 0.3, max: 2.5, step: 0.01, format: pct },
      { key: 'padding', label: 'Padding', type: 'range', min: 0, max: 0.3, step: 0.01, format: pct },
    ],
  },
  {
    title: 'Particles',
    open: true,
    items: [
      { key: 'particles', label: 'Count', type: 'range', min: 1000, max: 60000, step: 500, lazy: true, format: (v) => Number(v).toLocaleString('en') },
      { key: 'size0', label: 'Size, dark', type: 'range', min: 0.2, max: 4, step: 0.05, format: (v) => `${v}px` },
      { key: 'size1', label: 'Size, bright', type: 'range', min: 0.2, max: 6, step: 0.05, format: (v) => `${v}px` },
      { key: 'colorMode', label: 'Colour', type: 'select', options: [['solid', 'Solid'], ['gradient', 'Gradient'], ['source', 'From the image']] },
      { key: 'color0', label: 'Dark colour', type: 'color', show: (c) => c.colorMode === 'gradient' },
      { key: 'color1', label: 'Colour', type: 'color', show: (c) => c.colorMode !== 'source' },
      { key: 'opacity', label: 'Opacity', type: 'range', min: 0.05, max: 1, step: 0.01, format: pct },
      { key: 'blend', label: 'Blending', type: 'select', options: [['add', 'Additive (glow)'], ['normal', 'Normal']] },
      { key: 'twinkle', label: 'Twinkle', type: 'range', min: 0, max: 1, step: 0.01, format: pct },
      { key: 'background', label: 'Background', type: 'color' },
    ],
  },
  {
    title: 'Motion',
    items: [
      { key: 'spring', label: 'Spring', type: 'range', min: 0.005, max: 0.2, step: 0.005 },
      { key: 'friction', label: 'Friction', type: 'range', min: 0.6, max: 0.98, step: 0.01 },
      { key: 'drift', label: 'Drift', type: 'range', min: 0, max: 6, step: 0.1, format: (v) => `${v}px` },
      { key: 'driftSpeed', label: 'Drift speed', type: 'range', min: 0, max: 4, step: 0.05 },
      { key: 'intro', label: 'Intro', type: 'select', options: [['implode', 'Implode'], ['scatter', 'Scatter'], ['rise', 'Rise'], ['none', 'None']] },
      { key: 'morph', label: 'Morph', type: 'select', options: [['flow', 'Flow (neighbours together)'], ['swarm', 'Swarm (anywhere)']] },
      { key: 'scatter', label: 'Scatter', type: 'range', min: 0, max: 1, step: 0.01, format: pct },
      { key: 'stagger', label: 'Stagger', type: 'range', min: 0, max: 1, step: 0.01, format: pct },
      { key: 'sweep', label: 'Sweep', type: 'select', options: [['random', 'Random'], ['left', 'From the left'], ['right', 'From the right'], ['down', 'From the top'], ['up', 'From the bottom'], ['center', 'From the centre'], ['edges', 'From the edges']] },
    ],
  },
  {
    title: 'Pointer',
    items: [
      { key: 'pointer', label: 'Mode', type: 'select', options: [['repel', 'Repel'], ['attract', 'Attract'], ['vortex', 'Vortex'], ['none', 'Off']] },
      { key: 'pointerRadius', label: 'Radius', type: 'range', min: 20, max: 400, step: 5, format: (v) => `${v}px` },
      { key: 'pointerStrength', label: 'Strength', type: 'range', min: 0, max: 4, step: 0.05 },
      { key: 'pressBurst', label: 'Press and hold to burst', type: 'check' },
    ],
  },
];

const LIB_KEYS = Object.keys(defaults).filter((k) => !['size', 'color', 'autoplay', 'pauseOffscreen', 'reducedMotion', 'renderer', 'maxDpr', 'area', 'offset'].includes(k));

const START = {
  ...Object.fromEntries(LIB_KEYS.map((k) => [k, defaults[k]])),
  size0: defaults.size[0],
  size1: defaults.size[1],
  colorMode: 'solid',
  color0: '#33415f',
  color1: '#ffffff',
  background: '#000000',
};

/** UI config → library options. */
function toOptions(c) {
  const o = {};
  for (const k of LIB_KEYS) if (k in c) o[k] = c[k];
  o.size = [Number(c.size0), Number(c.size1)];
  o.color = c.colorMode === 'source' ? 'source' : c.colorMode === 'gradient' ? [c.color0, c.color1] : c.color1;
  return o;
}

/** Library options → UI config keys (used for sample presets and imports). */
function fromOptions(o = {}) {
  const c = {};
  for (const k of LIB_KEYS) if (k in o) c[k] = o[k];
  if (Array.isArray(o.size)) { c.size0 = o.size[0]; c.size1 = o.size[1]; }
  if (o.color === 'source') c.colorMode = 'source';
  else if (Array.isArray(o.color)) { c.colorMode = 'gradient'; c.color0 = o.color[0]; c.color1 = o.color[1]; }
  else if (typeof o.color === 'string') { c.colorMode = 'solid'; c.color1 = o.color; }
  return c;
}

// ── State ────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);
const last = store.get(KEYS.last, null);
let cfg = { ...START, ...(last?.cfg || {}) };
let source = last?.source || { type: 'sample', id: 'profile' };
let restore = {}; // values a sample's suggested settings replaced

const hashImage = new URLSearchParams(location.hash.slice(1)).get('image');
if (hashImage && SAMPLES.some((s) => s.id === hashImage)) source = { type: 'sample', id: hashImage };

const canvas = $('dust');
const stage = $('stage');
stage.style.background = cfg.background;
const dust = new Mezzotint(canvas, toOptions(cfg));

// ── Panel ────────────────────────────────────────────────────────────────

const inputs = new Map();
const fields = new Map();

function fieldHTML(item) {
  const id = `c-${item.key}`;
  if (item.type === 'check') {
    return `<label class="check"><input type="checkbox" id="${id}"> ${item.label}</label>`;
  }
  let control = '';
  if (item.type === 'range') control = `<input type="range" id="${id}" min="${item.min}" max="${item.max}" step="${item.step}">`;
  if (item.type === 'color') control = `<input type="color" id="${id}">`;
  if (item.type === 'select') {
    control = `<select id="${id}">${item.options.map(([v, l]) => `<option value="${String(v)}">${l}</option>`).join('')}</select>`;
  }
  const out = item.type === 'range' ? `<output for="${id}" id="${id}-out"></output>` : '';
  return `<label for="${id}"><span>${item.label}</span>${out}</label>${control}`;
}

$('controls').innerHTML = GROUPS.map((g) => `
  <details ${g.open ? 'open' : ''}>
    <summary>${g.title}</summary>
    <div class="group">${g.items.map((it) => `<div class="field" data-key="${it.key}">${fieldHTML(it)}</div>`).join('')}</div>
  </details>`).join('');

const ITEMS = GROUPS.flatMap((g) => g.items);
for (const item of ITEMS) {
  const el = $(`c-${item.key}`);
  inputs.set(item.key, el);
  fields.set(item.key, el.closest('.field'));
  const read = () => {
    if (item.type === 'check') return el.checked;
    if (item.type === 'range') return Number(el.value);
    if (item.type === 'select') {
      const v = el.value;
      return v === 'true' ? true : v === 'false' ? false : v;
    }
    return el.value;
  };
  const onChange = () => {
    cfg[item.key] = read();
    delete restore[item.key];
    syncOutputs();
    schedule();
  };
  el.addEventListener(item.lazy ? 'change' : 'input', onChange);
  if (item.lazy) el.addEventListener('input', () => { const o = $(`c-${item.key}-out`); if (o) o.textContent = item.format ? item.format(el.value) : el.value; });
}

function syncInputs() {
  for (const item of ITEMS) {
    const el = inputs.get(item.key);
    let v = cfg[item.key];
    if (item.key === 'particles' && v === 'auto') v = dust.count;
    if (item.type === 'check') el.checked = !!v;
    else el.value = String(v);
  }
  syncOutputs();
}

function syncOutputs() {
  for (const item of ITEMS) {
    if (item.type === 'range') {
      let v = cfg[item.key];
      if (item.key === 'particles' && v === 'auto') v = dust.count;
      $(`c-${item.key}-out`).textContent = item.format ? item.format(v) : String(v);
    }
    if (item.show) fields.get(item.key).hidden = !item.show(cfg);
  }
  const colorLabel = fields.get('color1').querySelector('span');
  colorLabel.textContent = cfg.colorMode === 'gradient' ? 'Bright colour' : 'Colour';
}

// Apply at most once per frame; sampling options re-sample the image.
let pending = 0;
function schedule() {
  if (pending) return;
  pending = requestAnimationFrame(() => {
    pending = 0;
    stage.style.background = cfg.background;
    dust.set(toOptions(cfg));
    persist();
    refreshInspect();
  });
}

// ── Source ───────────────────────────────────────────────────────────────

const samples = $('samples');
samples.innerHTML = SAMPLES.map((s) => `
  <button type="button" data-id="${s.id}" title="${s.label}" aria-label="${s.label}" aria-pressed="false">
    <img src="demo/images/thumbs/${s.id}.jpg" alt="" width="64" height="64">
  </button>`).join('');

function markSample() {
  for (const b of samples.children) b.setAttribute('aria-pressed', String(source.type === 'sample' && b.dataset.id === source.id));
}

async function showSource(src, { intro = false } = {}) {
  source = src;
  markSample();
  let target;
  if (src.type === 'sample') target = `demo/images/${src.id}.jpg`;
  else if (src.type === 'file') target = src.dataUrl;
  else target = { text: src.text, weight: 800 };
  try {
    await dust.show(target);
    if (intro) dust.replay();
  } catch (err) {
    console.error(err);
    toast('Could not read that image');
  }
  persist();
  refreshInspect();
}

function pickSample(id) {
  const s = SAMPLES.find((x) => x.id === id);
  if (!s) return;
  Object.assign(cfg, restore);
  restore = {};
  const suggested = fromOptions(s.options);
  for (const k of Object.keys(suggested)) {
    restore[k] = cfg[k];
    cfg[k] = suggested[k];
  }
  syncInputs();
  dust.set(toOptions(cfg));
  history.replaceState(null, '', `#image=${id}`);
  showSource({ type: 'sample', id });
}

samples.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-id]');
  if (b) pickSample(b.dataset.id);
});

/** Reads a file into a downscaled data URL so it can be kept in localStorage. */
async function readFile(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('not an image');
  const bitmap = await createImageBitmap(file);
  const k = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bitmap.width * k);
  c.height = Math.round(bitmap.height * k);
  c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
  const png = /png|webp|gif|svg/.test(file.type);
  return c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.9);
}

async function useFile(file) {
  try {
    const dataUrl = await readFile(file);
    Object.assign(cfg, restore);
    restore = {};
    syncInputs();
    history.replaceState(null, '', location.pathname);
    await showSource({ type: 'file', name: file.name, dataUrl });
    toast(`Loaded ${file.name}`);
  } catch {
    toast('That file is not an image');
  }
}

$('file').addEventListener('change', (e) => { if (e.target.files[0]) useFile(e.target.files[0]); e.target.value = ''; });

for (const zone of [$('drop'), stage]) {
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f) useFile(f);
  });
}
addEventListener('paste', (e) => {
  const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
  if (f) useFile(f);
});

const showText = () => {
  const t = $('text').value.trim();
  if (t) showSource({ type: 'text', text: t });
};
$('text-go').addEventListener('click', showText);
$('text').addEventListener('keydown', (e) => { if (e.key === 'Enter') showText(); });

// ── Stage tools ──────────────────────────────────────────────────────────

$('replay').addEventListener('click', () => dust.replay());
$('burst').addEventListener('click', () => dust.burst(1.2));

const inspect = $('inspect');
const inspectBtn = $('toggle-inspect');
let inspectTimer = 0;
function refreshInspect() {
  if (inspect.hidden) return;
  clearTimeout(inspectTimer);
  inspectTimer = setTimeout(() => {
    const img = dust.inspect();
    if (!img) return;
    inspect.width = img.width;
    inspect.height = img.height;
    inspect.getContext('2d').putImageData(img, 0, 0);
  }, 120);
}
inspectBtn.addEventListener('click', () => {
  inspect.hidden = !inspect.hidden;
  inspectBtn.setAttribute('aria-pressed', String(!inspect.hidden));
  refreshInspect();
});

// ── Presets ──────────────────────────────────────────────────────────────

function presets() { return store.get(KEYS.presets, []); }

function renderPresets() {
  const list = presets();
  $('presets').innerHTML = list.length
    ? list.map((p, i) => `
      <li>
        <span title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
        <button class="icon-btn" type="button" data-load="${i}">Load</button>
        <button class="icon-btn" type="button" data-delete="${i}" aria-label="Delete ${escapeHtml(p.name)}">✕</button>
      </li>`).join('')
    : '<li class="empty">No presets yet</li>';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

$('preset-save').addEventListener('click', () => {
  const name = $('preset-name').value.trim() || `Preset ${presets().length + 1}`;
  const entry = { name, cfg: { ...cfg }, source, savedAt: new Date().toISOString() };
  const list = presets().filter((p) => p.name !== name);
  list.unshift(entry);
  if (store.set(KEYS.presets, list)) {
    toast(`Saved “${name}”`);
  } else if (source.type === 'file' && store.set(KEYS.presets, [{ ...entry, source: { type: 'sample', id: 'profile' }, imageDropped: true }, ...list.slice(1)])) {
    toast('Saved without the image — browser storage is full');
  } else {
    toast('Browser storage is full');
  }
  $('preset-name').value = '';
  renderPresets();
});

$('presets').addEventListener('click', (e) => {
  const load = e.target.closest('[data-load]');
  const del = e.target.closest('[data-delete]');
  const list = presets();
  if (load) {
    const p = list[Number(load.dataset.load)];
    if (!p) return;
    restore = {};
    cfg = { ...START, ...p.cfg };
    syncInputs();
    schedule();
    showSource(p.source || source);
    toast(`Loaded “${p.name}”`);
  }
  if (del) {
    const i = Number(del.dataset.delete);
    const [gone] = list.splice(i, 1);
    store.set(KEYS.presets, list);
    renderPresets();
    if (gone) toast(`Deleted “${gone.name}”`);
  }
});

// ── Export ───────────────────────────────────────────────────────────────

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function changedOptions() {
  const o = toOptions(cfg);
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === 'particles' && v === 'auto') continue;
    if (!same(v, defaults[k])) out[k] = v;
  }
  return out;
}

function code() {
  const opts = changedOptions();
  const lines = Object.entries(opts).map(([k, v]) => `  ${k}: ${JSON.stringify(v).replace(/"/g, "'").replace(/,/g, ', ')}`);
  const args = lines.length ? `, {\n${lines.join(',\n')}\n}` : '';
  const show = source.type === 'text'
    ? `dust.text(${JSON.stringify(source.text).replace(/"/g, "'")});`
    : `await dust.show('${source.type === 'sample' ? `${source.id}.jpg` : 'your-image.jpg'}');`;
  return `import { Mezzotint } from 'https://cdn.jsdelivr.net/npm/mezzotint@${version}/src/mezzotint.js';

const dust = new Mezzotint('#dust'${args});
${show}
`;
}

$('copy-code').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(code());
    toast('Code copied');
  } catch {
    download(new Blob([code()], { type: 'text/javascript' }), 'mezzotint-snippet.js');
  }
});

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('export-json').addEventListener('click', () => {
  const data = { mezzotint: version, options: toOptions(cfg), background: cfg.background, source };
  download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'mezzotint-preset.json');
});

$('import-json').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    restore = {};
    cfg = { ...START, ...fromOptions(data.options || {}), background: data.background || START.background };
    syncInputs();
    schedule();
    if (data.source?.type) showSource(data.source);
    toast('Preset imported');
  } catch {
    toast('Not a mezzotint preset');
  }
});

$('download-png').addEventListener('click', async () => {
  const blob = await dust.snapshot();
  const bitmap = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bitmap.width;
  c.height = bitmap.height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = cfg.background;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bitmap, 0, 0);
  c.toBlob((b) => download(b, 'mezzotint.png'), 'image/png');
});

$('reset').addEventListener('click', () => {
  restore = {};
  cfg = { ...START };
  syncInputs();
  schedule();
  toast('Back to defaults');
});

// ── Misc ─────────────────────────────────────────────────────────────────

let toastTimer = 0;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function persist() {
  const state = { cfg, source };
  if (!store.set(KEYS.last, state) && source.type === 'file') store.set(KEYS.last, { cfg, source: { type: 'sample', id: 'profile' } });
}

try {
  localStorage.setItem('mezzotint:probe', '1');
  localStorage.removeItem('mezzotint:probe');
} catch {
  $('storage-note').textContent = 'This browser blocks storage, so presets will not be kept.';
}

syncInputs();
renderPresets();
showSource(source);

window.dust = dust;
