import { Mezzotint, story } from '../src/mezzotint.js';
import { SAMPLES } from './samples.js';

const canvas = document.getElementById('dust');
const dust = new Mezzotint(canvas, {
  size: [0.55, 2.1],
  scatter: 0.25,
  stagger: 0.5,
  drift: 0.8,
  pointerRadius: 120,
});

// Where shapes sit: beside the copy on wide screens, above it on phones.
const wide = (w) => w >= 860;
const picture = (w) => (wide(w) ? [0.42, 0.06, 0.56, 0.88] : [0.02, 0.07, 0.96, 0.5]);
const title = (w) => (wide(w) ? [0.1, 0.1, 0.8, 0.42] : [0.06, 0.09, 0.88, 0.2]);

const sections = [...document.querySelectorAll('main .step')];
const steps = sections.map((el) => (el.dataset.text
  ? {
    el,
    src: { text: el.dataset.text, weight: 760, letterSpacing: -0.02, lineHeight: 0.92 },
    area: el.dataset.area === 'hero' ? title : picture,
    padding: el.dataset.area === 'hero' ? 0.02 : 0.12,
  }
  : { el, src: el.dataset.src, area: picture }));

// Progress dots
const progress = document.querySelector('.progress');
progress.innerHTML = sections.map(() => '<span></span>').join('');
const dots = [...progress.children];

story(dust, steps, {
  hold: 0.4,
  onChange(index) {
    dots.forEach((d, i) => d.classList.toggle('on', i === index));
  },
});

// Dim the dust once the documentation starts.
const after = document.getElementById('get-started');
new IntersectionObserver(([e]) => {
  const past = e.isIntersecting && e.boundingClientRect.top < innerHeight * 0.6;
  canvas.classList.toggle('dim', past);
  progress.classList.toggle('hidden', past);
}, { threshold: [0, 0.1, 0.3] }).observe(after);

// Gallery
document.getElementById('gallery').innerHTML = SAMPLES.map(({ id, label }) => `
  <a href="configurator.html#image=${id}" aria-label="Open ${label} in the configurator">
    <img src="demo/images/thumbs/${id}.jpg" alt="" loading="lazy" width="256" height="256">
    <span>${label}</span>
  </a>`).join('');

window.dust = dust; // for tinkering in the console
