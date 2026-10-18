// Click/tap feedback for every extension page: a ring bursts out of whatever
// you press (rows get an inward flash instead). Works for mouse, touch, pen
// and keyboard (Enter/Space on a button).
//
// Uses element.animate() instead of a CSS class so the element's own
// animations (like the page reveal) don't restart when it is pressed. The
// report has its own copy in report-inline.js since it can't load this file.
(function () {
  // Rows are matched first so pressing the checkbox inside one flashes the
  // whole row, and so rows inside a box that clips overflow flash from the
  // inside instead of sending a ring that gets clipped.
  const ROW_SELECTOR = '.addon-row, label.settings-option-row, .export-pick-option';
  const TARGET_SELECTOR =
    'button, .hub-btn, label, .picker, .theme-toggle, a[href], input[type="checkbox"], input[type="radio"]';
  const DURATION_MS = 520;
  const FALLBACK_COLOR = 'rgba(0, 96, 223, 0.4)';

  function prefersReducedMotion() {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function ringColor(el) {
    try {
      const v = getComputedStyle(el).getPropertyValue('--press-ring').trim();
      if (v) return v;
      const root = getComputedStyle(document.documentElement).getPropertyValue('--press-ring').trim();
      return root || FALLBACK_COLOR;
    } catch (e) {
      return FALLBACK_COLOR;
    }
  }

  function isDisabled(el) {
    return !!el.disabled ||
      el.getAttribute('aria-disabled') === 'true' ||
      (el.classList && el.classList.contains('row-disabled'));
  }

  function pulse(el) {
    if (!el || typeof el.animate !== 'function' || isDisabled(el) || prefersReducedMotion()) return;
    const color = ringColor(el);
    const keyframes = el.matches(ROW_SELECTOR)
      ? [{ boxShadow: 'inset 0 0 0 999px ' + color }, { boxShadow: 'inset 0 0 0 999px transparent' }]
      : [{ boxShadow: '0 0 0 2px ' + color }, { boxShadow: '0 0 0 10px transparent' }];
    el.animate(keyframes, { duration: DURATION_MS, easing: 'ease-out' });
  }

  function findTarget(node) {
    if (!node || typeof node.closest !== 'function') return null;
    // A click on a link pulses only the link, never the whole row.
    const link = node.closest('a[href]');
    if (link) return link;
    return node.closest(ROW_SELECTOR) || node.closest(TARGET_SELECTOR);
  }

  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;

  // Capture phase, so it still fires if a handler stops propagation.
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pulse(findTarget(e.target));
  }, true);

  // A click with no pointer behind it (detail === 0) is keyboard activation.
  document.addEventListener('click', (e) => {
    if (e.detail === 0) pulse(findTarget(e.target));
  }, true);
})();
