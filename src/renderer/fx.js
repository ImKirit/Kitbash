/* fx.js: motion. Cards tilt toward the cursor with a soft light sheen,
   views fade in, rows and tiles appear with a short stagger the first time a
   view is shown. Only transform and opacity change, updates run once per
   frame, and nothing moves when the system asks for reduced motion. */
'use strict';

(function () {
  const reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const CARDS = '.tile.click, .hero-feature, .card.click';
  const MAX_TILT = 10; // degrees, the featured card half of it

  let active = null;
  let pending = null;
  let frame = 0;

  function apply() {
    frame = 0;
    if (!pending) return;
    const { el, x, y } = pending;
    pending = null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const px = Math.min(1, Math.max(0, (x - r.left) / r.width));
    const py = Math.min(1, Math.max(0, (y - r.top) / r.height));
    const big = el.classList.contains('hero-feature');
    const tilt = big ? MAX_TILT / 2 : MAX_TILT;
    el.style.setProperty('--ry', ((px - 0.5) * 2 * tilt).toFixed(2) + 'deg');
    el.style.setProperty('--rx', ((0.5 - py) * 2 * tilt).toFixed(2) + 'deg');
  }

  function release(el) {
    if (el.classList.contains('fx-sweep')) el.classList.add('fx-leave');
    el.classList.remove('fx-on', 'fx-sweep');
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  }

  document.addEventListener('pointermove', (e) => {
    if (reduce.matches) return;
    const el = e.target.closest ? e.target.closest(CARDS) : null;
    if (active && active !== el) release(active);
    const entered = el && el !== active;
    active = el;
    if (!el) return;
    // one light band sweeps across the card on every hover enter
    if (entered) { el.classList.remove('fx-sweep', 'fx-leave'); void el.offsetWidth; el.classList.add('fx-sweep'); }
    el.classList.add('fx-tilt', 'fx-on');
    pending = { el, x: e.clientX, y: e.clientY };
    if (!frame) frame = requestAnimationFrame(apply);
  }, { passive: true });

  document.addEventListener('pointerleave', () => { if (active) { release(active); active = null; } });
  window.addEventListener('blur', () => { if (active) { release(active); active = null; } });

  // ---- view entrance and first-view stagger -----------------------------------------
  const plainRender = window.render;
  let lastKey = '';
  window.render = function render() {
    plainRender();
    const key = JSON.stringify(view);
    if (key === lastKey || reduce.matches) { lastKey = key; return; }
    lastKey = key;
    const root = document.getElementById('view');
    if (!root) return;
    root.classList.remove('view-in');
    void root.offsetWidth; // restart the animation, read once per view change only
    root.classList.add('view-in');
    const items = root.querySelectorAll('.tile, .modcard, .lrow, .hero-feature, .card');
    let i = 0;
    for (const el of items) {
      if (i > 24) break;
      el.style.setProperty('--i', String(i++));
      el.classList.add('stagger');
    }
  };
})();
