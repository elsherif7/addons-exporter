// The Importer's matching: which add-ons in a file are already installed.
// Pure functions, no page code. Needs core.js (shortName) loaded first.

function buildInstalledIndex(installed) {
  const byId = new Map();
  const byName = new Map();
  // Short form of each installed name (see shortName() in core.js): an
  // export made with "Shorten add-on names" on has short names, so a file
  // without ids can only be matched against installed add-ons by that. A
  // short name shared by two installed add-ons is ambiguous and is
  // stored as null, so it never guesses between them.
  const byShortName = new Map();
  for (const a of installed) {
    byId.set(a.id, a);
    byName.set(a.name.toLowerCase(), a);
    const short = shortName(a.name).toLowerCase();
    byShortName.set(short, byShortName.has(short) ? null : a);
  }
  return { byId, byName, byShortName };
}

// Matches a file's add-on to an installed one: the id first (the reliable
// way, and what makes shortened names safe), then - for an add-on with no
// id, or one whose id isn't installed - the name: the exact name
// (case-insensitive), then the shortened form, so a short name in the file
// still finds the full installed name and the other way round.
function findInstalledMatch(item, index) {
  if (item.id && index.byId.has(item.id)) {
    return index.byId.get(item.id);
  }
  const name = item.name.toLowerCase();
  if (index.byName.has(name)) return index.byName.get(name);
  const short = shortName(item.name).toLowerCase();
  return index.byShortName.get(short) || null;
}
