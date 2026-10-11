// Click / tap feedback shared by every extension page: whatever you press
// gives a quick ring (or, for list rows, a tinted flash) that bursts out of
// it and fades. Works for mouse, touch, pen, and for keyboard activation
// (Enter / Space on a focused button).
//
// Uses the Web Animations API on purpose instead of toggling a CSS class:
// an element's own CSS animations (e.g. the page's opening reveal) must not
// be restarted just because it was pressed, and element.animate() leaves
// them alone. The report (report-template.js) carries its own small copy of
// this, since a saved report can't load this file.
(function () {
  // List rows (export/import add-on rows, settings option rows) are matched
  // first, so pressing the radio/checkbox inside one pulses the whole row.
  const ROW_SELECTOR = '.addon-row, label.settings-option-row';
  const TARGET_SELECTOR =
    'button, .hub-btn, label, .picker, .theme-toggle, a[href], input[type="checkbox"], input[type="radio"]';
  const DURATION_MS = 520;
  const FALLBACK_COLOR = 'rgba(0, 96, 223, 0.4)';

  function prefersReducedMotion() {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function ringColor() {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--press-ring').trim();
      return v || FALLBACK_COLOR;
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
    const color = ringColor();
    // Rows sit inside a box that clips overflow, so they flash from the
    // inside; everything else sends a ring outward.
    const keyframes = el.matches(ROW_SELECTOR)
      ? [{ boxShadow: 'inset 0 0 0 999px ' + color }, { boxShadow: 'inset 0 0 0 999px transparent' }]
      : [{ boxShadow: '0 0 0 0 ' + color }, { boxShadow: '0 0 0 12px transparent' }];
    el.animate(keyframes, { duration: DURATION_MS, easing: 'ease-out' });
  }

  function findTarget(node) {
    if (!node || typeof node.closest !== 'function') return null;
    return node.closest(ROW_SELECTOR) || node.closest(TARGET_SELECTOR);
  }

  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;

  // Capture phase, so it still fires if a page handler stops propagation.
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pulse(findTarget(e.target));
  }, true);

  // A click with no pointer behind it (detail === 0) is keyboard activation.
  document.addEventListener('click', (e) => {
    if (e.detail === 0) pulse(findTarget(e.target));
  }, true);
})();
