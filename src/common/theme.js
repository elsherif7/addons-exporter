// Applies the stored theme (light/dark) to the current page on load.
// Shared by every full-page tab (export, import, settings, confirmation)
// and the popup, so the extension's look stays consistent across all of
// them.
//
// Deliberately NOT used by report-template.js's standalone HTML report:
// the report has no access to browser.storage once saved outside the
// extension, and it may be opened by someone other than whoever
// exported it, so tying it to one person's stored preference wouldn't
// make sense there. It stays light-only for now - a future,
// self-contained prefers-color-scheme media query in the report's own
// inline CSS would be a cleaner way to give it dark mode, decoupled
// from this setting entirely.

const THEME_STORAGE_KEY = 'theme';

// Pure: given whatever browser.storage.local.get() resolved with (which
// is {} if nothing's been set yet), decides which theme to use. Kept
// separate from the storage/DOM calls below so it can be tested without
// mocking either.
function resolveTheme(stored) {
  return stored && stored[THEME_STORAGE_KEY] === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
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
