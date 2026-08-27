// Shared helpers used by background.js, export.js, and import.js.
// background.js loads this via manifest.json's background.scripts array
// (scripts there share one global scope). export.js/import.js load it via
// a <script> tag in their own page, placed before their own script tag.

// Version of the JSON data embedded in exported reports. Bump this if the
// shape of that data ever changes. background.js embeds this value in
// every export; import.js compares an imported file's formatVersion
// against it to detect old/new exports and handle them gracefully instead
// of breaking silently. Defined once here so the two files can never drift
// out of sync with each other.
const EXPORT_FORMAT_VERSION = 1;

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Only http/https links are ever used - by background.js when building a
// report's links, and by import.js before opening a tab. Add-on metadata
// (name, homepage URL) is attacker-controlled for any sideloaded/unlisted
// extension, and an imported file's data isn't trusted either - it could
// come from someone else, or be hand-edited. This also guards against
// non-navigable schemes generally.
function isSafeUrl(link) {
  try {
    const u = new URL(link);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Case-insensitive alphabetical comparator for objects with a .name field -
// used to sort every add-on checklist and report table the same way.
function byName(a, b) {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}
