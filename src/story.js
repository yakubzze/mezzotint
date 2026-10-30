// Scroll-driven storytelling: each step (an element on the page) owns a shape;
// scrolling between two steps scrubs the dust from one shape to the next.
// Scrolling back plays it backwards.

import { loadSource } from './sample.js';

/**
 * @param {import('./mezzotint.js').Mezzotint} dust
 * @param {Array<{ el: Element, src: any, scatter?: number, [option: string]: any }>} steps
 *   each step: the element that marks its place on the page, the source, and
 *   optional per-shape sampling options (area, fit, threshold, …)
 * @param {{ hold?: number, scatter?: number, anchor?: number, onChange?: (index: number, progress: number) => void }} options
 *   hold     0..1 share of the way between two steps where the shape stays still (default 0.35)
 *   scatter  burst in the middle of a transition (default: the dust option)
 *   anchor   where in the viewport a step counts as "current", 0 = top, 1 = bottom (default 0.5)
 */
export function story(dust, steps, options = {}) {
  const o = { hold: 0.35, anchor: 0.5, ...options };
  let shapes = [];
  let frame = 0;
  let lastIndex = -1;
  let destroyed = false;

  function update() {
    frame = 0;
    if (destroyed || shapes.length < steps.length) return;
    const line = innerHeight * o.anchor;
    const centers = steps.map(({ el }) => {
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2 - line;
    });
    let k = 0;
    while (k < centers.length - 1 && centers[k + 1] <= 0) k++;
    let p = 0;
    if (k < centers.length - 1 && centers[k] < 0) p = -centers[k] / (centers[k + 1] - centers[k]);
    const h = Math.min(0.9, o.hold) / 2;
    p = p <= h ? 0 : p >= 1 - h ? 1 : (p - h) / (1 - 2 * h);
    p = p * p * (3 - 2 * p);

    const next = Math.min(k + 1, shapes.length - 1);
    const scatter = steps[next].scatter ?? o.scatter;
    dust.blend(shapes[k], shapes[next], p, scatter == null ? {} : { scatter });

    const index = p < 0.5 ? k : next;
    if (index !== lastIndex) {
      lastIndex = index;
      o.onChange?.(index, p);
    }
  }

  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  const breathe = () => new Promise((r) => setTimeout(r, 0));

  // Images download in parallel; sampling runs one at a time so the page stays
  // responsive, and the first step appears as soon as it is ready.
  const ready = (async () => {
    const images = steps.map(({ src }) => loadSource(src));
    const loaded = [];
    for (let i = 0; i < steps.length; i++) {
      const { el, src, scatter, ...opts } = steps[i];
      loaded.push(await dust.load(await images[i], opts));
      if (i === 0 && !destroyed) dust.blend(loaded[0], loaded[0], 0);
      await breathe();
    }
    shapes = loaded;
    update();
    return shapes;
  })();

  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule);

  return {
    ready,
    update: schedule,
    get index() { return lastIndex; },
    destroy() {
      destroyed = true;
      removeEventListener('scroll', schedule);
      removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
    },
  };
}
