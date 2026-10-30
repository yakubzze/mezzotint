# mezzotint

**Images, made of living dust.** mezzotint turns any picture into thousands of
particles. They hold its shape, drift, scatter under your cursor and flow into the
next picture as you scroll. Made by [GTLR](https://gtlr.studio).

- **Brightness-weighted sampling.** A fixed number of particles is placed by
  brightness, using stratified sampling, so the dust is even with no clumps and
  no holes. Gradients survive.
- **Morphs that read as motion.** Particles are ordered along a Hilbert curve
  (`flow`), so neighbours stay neighbours. In `swarm` mode every particle can go
  anywhere. Departures can sweep in from any side.
- **Scroll storytelling.** `story()` ties transitions to the scroll position:
  forwards, backwards or paused halfway.
- **Pointer physics.** Repel, attract or vortex. Press and hold to blast the
  shape apart.
- **Image clean-up.** Auto-invert for dark ink on a light background, transparent
  PNGs, levels, blur, edge detection, posterize and a flat silhouette mode.
- **Small and polite.** No dependencies, ~15 kB gzipped. WebGL point sprites with a
  Canvas 2D fallback. It pauses off-screen, stops drawing when nothing moves and
  follows `prefers-reduced-motion`.

**Live demo:** [yakubzze.github.io/mezzotint](https://yakubzze.github.io/mezzotint/) (a scroll
story) and the [configurator](https://yakubzze.github.io/mezzotint/configurator.html): drop in
your own image, tune it, save presets and export code. Run both locally with `npm run dev`.

### Why “mezzotint”

Mezzotint is a printmaking technique from the 1640s. The plate is roughened with
thousands of tiny dots, and the image is worked out of that darkness. The French
call it *la manière noire*, the dark manner. Image editors still list a Mezzotint
filter under *Pixelate*: it redraws a picture as a random pattern of dots. This
library does the same with light. Every picture is pulled out of the dark, one
particle at a time.

## Quick start

```bash
npm i mezzotint
```

```html
<canvas id="dust" style="width:100%;height:100vh;background:#000"></canvas>
<script type="module">
  import { Mezzotint } from 'mezzotint'; // or https://cdn.jsdelivr.net/npm/mezzotint/src/mezzotint.js

  const dust = new Mezzotint('#dust');
  await dust.show('silhouette.jpg');              // the first shape plays the intro

  dust.show('another.jpg', { sweep: 'left' });    // later shapes morph
  dust.text('hello');                             // text works too
</script>
```

The canvas is sized by CSS. mezzotint handles the device pixel ratio and resizing.

### Scroll story

```js
import { Mezzotint, story } from 'mezzotint';

const dust = new Mezzotint('#dust');   // e.g. a position: fixed full-screen canvas
story(dust, [...document.querySelectorAll('[data-src]')].map((el) => ({
  el,                                 // the element that marks this step on the page
  src: el.dataset.src,                // image URL, Blob, <img>, canvas or { text }
  area: [0.5, 0, 0.5, 1],             // per-step sampling options are allowed
})), { hold: 0.35 });
```

While a step's element sits at the middle of the viewport, its shape holds still.
Between two steps, the scroll position scrubs the morph. `hold` sets how much of
the distance between steps keeps the shape still.

## Which images work best

mezzotint reads **brightness**: light areas attract particles and dark areas stay
empty.

- **Light subject on a dark background** works as is. Rim-lit figures, glowing
  objects and night shots are ideal.
- **Dark subject on a light background** (ink, classic silhouettes) gets inverted
  automatically (`invert: 'auto'` checks the image border).
- **Transparent PNGs** become their shape. Inner detail is kept but softened.
- **Busy photos** need help: raise `threshold` and `contrast`, add `blur`, or
  switch on `silhouette` for a flat, even shape. `edges` turns a photo into an
  outline drawing.

## API

### `new Mezzotint(canvas, options?)`

`canvas` is a `<canvas>` element or a selector. All options can be changed later
with `set()`. Sampling options can also be passed to `show()`/`load()` for a
single shape.

| Option | Default | |
| --- | --- | --- |
| `particles` | `'auto'` | Particle count, or `'auto'` (scaled to canvas area: ~2.5k–24k, fewer on touch devices) |
| `renderer` | `'auto'` | `'webgl'`, `'2d'`, or `'auto'` (WebGL with a Canvas 2D fallback) |
| `maxDpr` | `2` | Cap on the device pixel ratio |
| **Look** | | |
| `color` | `'#ffffff'` | Any CSS colour; `[dark, bright]` for a gradient by brightness; `'source'` for the image's own colours |
| `size` | `[0.6, 2.2]` | Particle size in CSS px for the darkest and the brightest points |
| `opacity` | `1` | |
| `blend` | `'add'` | `'add'` (light accumulates, glows) or `'normal'` |
| `twinkle` | `0.2` | 0–1 |
| **Motion** | | |
| `spring` | `0.06` | Pull towards the target |
| `friction` | `0.86` | Velocity kept per frame |
| `drift` | `0.7` | Idle wander in px |
| `driftSpeed` | `1` | |
| `intro` | `'implode'` | `'implode'`, `'scatter'`, `'rise'` or `'none'` |
| **Morphing** | | |
| `morph` | `'flow'` | `'flow'` (neighbours stay together) or `'swarm'` |
| `scatter` | `0.35` | 0–1 burst while leaving a shape |
| `stagger` | `0.4` | 0–1 how spread out the departures are |
| `sweep` | `'random'` | `'random'`, `'left'`, `'right'`, `'up'`, `'down'`, `'center'` or `'edges'` |
| **Sampling** | | |
| `fit` | `'contain'` | `'contain'` or `'cover'` |
| `area` | `[0, 0, 1, 1]` | `[x, y, w, h]` of the canvas (0–1) the shape is fitted into, or `(w, h) => [...]` |
| `padding` | `0.06` | Margin inside the area, as a fraction of its shorter side |
| `zoom`, `offset` | `1`, `[0, 0]` | Scale and nudge inside the area |
| `threshold` | `0.08` | Pixels darker than this get no particles |
| `contrast`, `brightness` | `0`, `0` | −1–1 |
| `gamma` | `1` | |
| `blur` | `0` | px |
| `edges` | `0` | 0–1 mix of an edge-detected outline |
| `posterize` | `0` | Number of levels (0 = off) |
| `silhouette` | `false` | Hard threshold: a flat, even shape |
| `invert` | `'auto'` | `'auto'`, `true` or `false` |
| **Pointer** | | |
| `pointer` | `'repel'` | `'repel'`, `'attract'`, `'vortex'` or `'none'` |
| `pointerRadius` | `110` | px |
| `pointerStrength` | `1` | |
| `pressBurst` | `true` | Press and hold (mouse/pen) to blast the dust apart |
| **Runtime** | | |
| `autoplay` | `true` | |
| `pauseOffscreen` | `true` | Skip work while the canvas is off-screen |
| `reducedMotion` | `'auto'` | `'auto'` follows the OS setting. With reduced motion there is no intro, drift, twinkle or pointer force, and shapes swap without travel |

### Methods

| Method | |
| --- | --- |
| `show(source, options?)` → `Promise<Shape>` | Shows an image URL, `Blob`/`File`, `<img>`, `<canvas>`, `ImageBitmap`, `<video>` frame, `{ text }`, or a loaded shape. The first call plays the intro; later calls morph. |
| `text(string, options?)` | Shorthand for `show({ text })`. Options: `font`, `weight`, `lineHeight`, `letterSpacing` and sampling options. |
| `load(source, options?)` → `Promise<Shape>` | Samples without showing. Loaded shapes are re-sampled when the canvas resizes. |
| `blend(a, b, t, { scatter }?)` | Scrubs between two loaded shapes (`t` 0–1). Drive it from your own timeline. |
| `replay(intro?)` | Plays the intro again. |
| `burst(strength?, x?, y?)` | Throws the dust outwards. |
| `set(options)` | Changes options on the fly. Re-samples only when sampling options change. |
| `inspect()` → `ImageData` | The processed brightness field of the current shape. |
| `snapshot(type?, quality?)` → `Promise<Blob>` | The current frame as an image. |
| `play()`, `pause()`, `destroy()` | |

Properties: `count` (number of particles), `rendererKind` (`'webgl'` or `'2d'`) and
`options` (read-only copy).

### `story(dust, steps, options?)` → `{ ready, update, index, destroy }`

`steps`: `{ el, src, scatter?, ...samplingOptions }[]`. Options: `hold` (0.35),
`anchor` (0.5, the position in the viewport where a step counts as current),
`scatter` and `onChange(index, progress)`.

## Browser support

mezzotint needs current evergreen browsers with WebGL 1 or Canvas 2D, ES modules,
`ResizeObserver` and `IntersectionObserver`. Images from other origins need CORS
headers, because the pixels are read in the browser.

## Privacy

Everything happens in the browser. Images you drop into the configurator are never
uploaded. Presets live in your browser's `localStorage`.

## Development

```bash
npm run dev   # http://localhost:5173 — zero-dependency static server
```

```
src/mezzotint.js   engine: particles, physics, morphs, pointer, API
src/sample.js     image → brightness field → filters → weighted points
src/render.js     WebGL point sprites + Canvas 2D fallback
src/story.js      scroll-driven steps
index.html        demo: scroll story
configurator.html demo: tune, save presets, export
```

## Credits

The sample images in `demo/images` are AI-generated. They were made with Google
Gemini for this demo; prompts are listed in [`demo/images/CREDITS.md`](demo/images/CREDITS.md).

MIT © [GTLR](https://gtlr.studio)
