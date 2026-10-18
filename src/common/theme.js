// Applies the saved light/dark theme to a page. Used by every page and the popup.
//
// To avoid a flash of the wrong theme it first applies the value cached in
// localStorage (sync, before paint), then reads the real one from
// storage.local and corrects it if needed.

const THEME_STORAGE_KEY = 'theme';
const THEME_CACHE_KEY = 'addons-hub-theme-cache';

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

// Theme changes are animated, but never on first load. With view transitions
// (Firefox 144+) the new theme fades in over the old one (see shared.css),
// otherwise .theme-switching makes the colors glide. Skipped for reduced motion.
let themeReady = false;
let themeSwitchTimer = null;
// The theme a view transition is heading to, or null. The page only flips
// inside the transition callback, a moment after it is requested, so a second
// applyTheme() in that gap (storage.onChanged fires right after the Settings
// page's own call) must retarget it instead of starting another transition,
// which would cancel the first halfway.
let pendingTheme = null;

function applyTheme(theme) {
  const t = theme === 'dark' ? 'dark' : 'light';
  const root = document.documentElement;
  // Keep the cache in step for the next page load.
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
      pendingTheme = null; // never leave the page stuck
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
