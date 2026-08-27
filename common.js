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

// Shows/hides .addon-row elements in a checklist based on a search query,
// matched against each row's label text. Also hides a .group-heading if
// none of its rows still match. Works on export.html and import.html's
// checklists, since both use the same row/heading markup.
function filterAddonRows(container, query) {
  const q = query.trim().toLowerCase();
  let heading = null;
  let headingHasMatch = false;

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
      if (match) headingHasMatch = true;
    }
  }
  finishHeading();
}
