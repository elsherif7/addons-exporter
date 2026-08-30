// Shared helpers used by background.js, export.js, and import.js.

// Bump if the exported JSON shape ever changes.
const EXPORT_FORMAT_VERSION = 1;

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Add-on names/links aren't trustworthy - could be a sideloaded
// extension or a hand-edited import file.
function isSafeUrl(link) {
  try {
    const u = new URL(link);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function byName(a, b) {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

// No label for an exact match - that's the expected common case, only
// worth flagging when the link is less certain.
const LINK_TYPE_LABELS = {
  'amo-search': 'Possible match',
  'homepage': 'Homepage',
  'amo-search-fallback': 'Search results',
};
const UNCERTAIN_LINK_TYPES = new Set(['amo-search', 'amo-search-fallback']);

// Filters .addon-row elements by search query, hiding a .group-heading
// if none of its rows still match. Returns true if anything's visible.
function filterAddonRows(container, query) {
  const q = query.trim().toLowerCase();
  let heading = null;
  let headingHasMatch = false;
  let anyMatch = false;

  const finishHeading = () => {
    if (heading) heading.style.display = headingHasMatch ? '' : 'none';
  };

  for (const el of container.children) {
    if (el.classList.contains('group-heading')) {
      finishHeading();
      heading = el;
      headingHasMatch = false;
    } else if (el.classList.contains('addon-row')) {
      const label = el.querySelector('label');
      const match = q === '' || (label && label.textContent.toLowerCase().includes(q));
      el.style.display = match ? '' : 'none';
      if (match) {
        headingHasMatch = true;
        anyMatch = true;
      }
    }
  }
  finishHeading();
  return anyMatch;
}
