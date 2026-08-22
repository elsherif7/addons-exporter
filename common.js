// Shared helpers used by background.js, export.js, and import.js.
// background.js loads this via manifest.json's background.scripts array
// (scripts there share one global scope). export.js/import.js load it via
// a <script> tag in their own page, placed before their own script tag.

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Case-insensitive alphabetical comparator for objects with a .name field -
// used to sort every add-on checklist and report table the same way.
function byName(a, b) {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}
