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

function applyTheme(theme) {
  const t = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
  // Keep localStorage cache in sync so the next page load can apply
  // the theme synchronously before the async storage read resolves.
  try { localStorage.setItem(THEME_CACHE_KEY, t); } catch (e) {}
}

async function initTheme() {
  let stored;
  try {
    stored = await browser.storage.local.get(THEME_STORAGE_KEY);
  } catch {
    stored = {};
  }
  applyTheme(resolveTheme(stored));
}

initTheme();
