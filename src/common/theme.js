// Applies the stored theme (light/dark) to the current page on load.
// Shared by every full-page tab (export, import, settings, confirmation)
// and the popup, so the extension's look stays consistent across all of
// them.
//
// Uses a two-step approach to avoid flash of wrong theme (FOWT):
// 1. Synchronously reads a localStorage cache key written on the
//    previous apply, so the theme is applied before any paint.
// 2. Reads browser.storage.local asynchronously to get the authoritative
//    value and corrects if needed.

const THEME_STORAGE_KEY = 'theme';
const THEME_CACHE_KEY = 'addons-hub-theme-cache';

// Synchronous fast path — apply cached theme immediately before paint.
(function() {
  try {
    const cached = localStorage.getItem(THEME_CACHE_KEY);
    if (cached === 'dark' || cached === 'light') {
      document.documentElement.setAttribute('data-theme', cached);
    }
  } catch (e) {}
})();

function resolveTheme(stored) {
  return stored && stored[THEME_STORAGE_KEY] === 'dark' ? 'dark' : 'light';
}

// The switch is animated, but only for changes made after the page has
// finished its first apply - never on page load, so there's no animated
// flash of the wrong theme. With view transitions (Firefox 144+) the old
// look drifts away and the new one fades in over it (see the
// ::view-transition rules in shared.css); without them, .theme-switching
// makes every color glide instead. Skipped for reduced motion.
let themeReady = false;
let themeSwitchTimer = null;
// The theme a view transition (below) is on its way to, or null. The page
// only flips inside the transition's callback, a moment after it is
// requested - so a second applyTheme() in that gap (storage.onChanged fires
// right after the Settings page's own call) must not start a second
// transition on top, which would cancel the first one halfway. It just
// retargets the transition already under way.
let pendingTheme = null;

function applyTheme(theme) {
  const t = theme === 'dark' ? 'dark' : 'light';
  const root = document.documentElement;
  // Keep localStorage cache in sync so the next page load can apply
  // the theme synchronously before the async storage read resolves.
  try { localStorage.setItem(THEME_CACHE_KEY, t); } catch (e) {}

  if (pendingTheme !== null) {
    pendingTheme = t;
    return;
  }

  const changing = themeReady && typeof root.getAttribute === 'function' &&
    root.getAttribute('data-theme') !== t;
  const reduced = typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;
  const setTheme = (value) => root.setAttribute('data-theme', value);

  if (changing && !reduced && typeof document.startViewTransition === 'function') {
    pendingTheme = t;
    try {
      document.startViewTransition(() => {
        const final = pendingTheme === null ? t : pendingTheme;
        pendingTheme = null;
        setTheme(final);
      });
    } catch (e) {
      pendingTheme = null; // never leave the page unable to change theme
      setTheme(t);
    }
  } else {
    if (changing && !reduced && root.classList && typeof setTimeout === 'function') {
      root.classList.add('theme-switching');
      clearTimeout(themeSwitchTimer);
      themeSwitchTimer = setTimeout(() => root.classList.remove('theme-switching'), 800);
    }
    setTheme(t);
  }
}
if (browser.storage && browser.storage.onChanged) {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[THEME_STORAGE_KEY]) {
      applyTheme(changes[THEME_STORAGE_KEY].newValue);
    }
  });
}

async function initTheme() {
  let stored;
  try {
    stored = await browser.storage.local.get(THEME_STORAGE_KEY);
  } catch {
    stored = {};
  }
  applyTheme(resolveTheme(stored));
  themeReady = true;
}

initTheme();
