// Which add-ons in an import file are already installed. Pure functions.
// Needs core.js (shortName).

function buildInstalledIndex(installed) {
  const byId = new Map();
  const byName = new Map();
  // Exports made with "Shorten add-on names" have short names, so a file
  // without ids can only be matched on those. A name shared by two installed
  // add-ons is ambiguous and stored as null, so we never guess between them.
  const byShortName = new Map();
  for (const a of installed) {
    byId.set(a.id, a);
    const exact = a.name.toLowerCase();
    byName.set(exact, byName.has(exact) ? null : a);
    const short = shortName(a.name).toLowerCase();
    byShortName.set(short, byShortName.has(short) ? null : a);
  }
  return { byId, byName, byShortName };
}

// Id first (reliable, and what makes shortened names safe). Without an id, or
// when it isn't installed, falls back to the exact name (case-insensitive),
// then the shortened form, so a short name in the file still finds the full
// installed one and the other way round.
function findInstalledMatch(item, index) {
  if (item.id && index.byId.has(item.id)) {
    return index.byId.get(item.id);
  }
  const name = item.name.toLowerCase();
  const exact = index.byName.get(name);
  if (exact) return exact;
  const short = shortName(item.name).toLowerCase();
  return index.byShortName.get(short) || null;
}
