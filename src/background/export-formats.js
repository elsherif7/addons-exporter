// The plain-data export builders: JSON, CSV and TXT. Pure string building - nothing here touches browser.* APIs. Needs
// core.js (groupForReading, shortName, typeLabel, EXPORT_FORMAT_VERSION...) loaded first.

// Each add-on's fields in reading order (name first, the technical id last).
// The importer finds fields by name, so the order is only for people.
function jsonAddon(a, shorten = true) {
  return {
    name: shorten ? shortName(a.name) : a.name,
    version: a.version,
    type: a.type,
    enabled: a.enabled,
    link: a.link,
    linkType: a.linkType,
    id: a.id,
  };
}

// Builds the JSON export: the same add-ons as the HTML report's embedded data,
// saved as a standalone .json file the Importer reads the same way.
// shorten (the Settings "Shorten add-on names" choice, on by default) cuts
// each name at its first separator, exactly as the HTML report does. The
// id is always included, and the Importer matches by id first, so a short
// name never stops an add-on from being recognised.
function buildJsonExport(list, shorten = true) {
  return JSON.stringify({
    formatVersion: EXPORT_FORMAT_VERSION,
    addons: groupForReading(list).all.map((a) => jsonAddon(a, shorten)),
  }, null, 2);
}

// Builds a CSV export. First line is a format-version comment so the
// importer can validate it without guessing. Second line is the header
// row. One data row per add-on. Fields with commas or quotes are
// quoted and internal quotes are doubled per RFC 4180.
function buildCsvExport(list, shorten = true) {
  const csvField = (val) => {
    let s = String(val == null ? '' : val);
    // A cell starting with =, +, -, @, tab, or CR is read as a formula by
    // Excel/Sheets/LibreOffice once this file is opened in a spreadsheet -
    // and an add-on name is attacker-controlled. A leading apostrophe
    // forces "read as text" in all of them, and disappears from the
    // visible cell content once opened. parseCsvPayload()'s
    // stripCsvFormulaGuard() strips exactly one back off on import. A name
    // that itself starts with apostrophes followed by one of those
    // characters gets the guard too, so the importer strips only the one
    // we add and the original name comes back unchanged.
    if (/^'*[=+\-@\t\r]/.test(s)) {
      s = `'${s}`;
    }
    // Quote the field if it contains a comma, double-quote, or newline.
    return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const row = (fields) => fields.map(csvField).join(',');

  // Columns in reading order (name first, the technical id last); the
  // importer finds them by the header names, so the order is only for
  // people. A byte-order mark at the very start makes Excel read the file
  // as UTF-8, so non-English add-on names show correctly; the importer
  // ignores it.
  const lines = [
    `# addons-hub-format-version: ${EXPORT_FORMAT_VERSION}`,
    row(['name', 'version', 'type', 'enabled', 'link', 'linkType', 'id']),
    ...groupForReading(list).all.map((a) => row([shorten ? shortName(a.name) : a.name, a.version, a.type, a.enabled, a.link, a.linkType, a.id])),
  ];
  return '\uFEFF' + lines.join('\r\n');
}

// Builds a plain-text export, laid out to be read: a title, then an
// "Enabled" and a "Disabled" section (each A-Z) with the columns lined up.
// One add-on per line:
//   Name | Version | Type | Status | Link | Id
// The Importer uses the id (last column) to match add-ons even though the name
// may be shortened (shorten, the Settings choice, on by default).
// First line is a format-version comment so the format is identifiable.
// The importer ignores every line without " | " in it (the title, the
// section headings and the underlines), so none of those may contain it.
//
// Text written into a column is escaped so one add-on always stays on one line
// and a name can never be mistaken for a column separator, and so the Importer
// can restore it exactly:
//   \\  a backslash          \|  a pipe
//   \n  a line break         \r  a carriage return
//   \s  a space at the very start or end of the text (the columns are padded
//       with spaces, so edge spaces would otherwise be lost)
// Everything else is written as it is, so ordinary names look exactly as before.
// import.js's txtUnescape() is the reverse of this.
function txtEscape(value) {
  return String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/^ +| +$/g, (spaces) => '\\s'.repeat(spaces.length));
}

function buildTxtExport(list, shorten = true) {
  const { enabled, disabled, all } = groupForReading(list);
  const nameOf = (a) => txtEscape(shorten ? shortName(a.name) : a.name);

  // Column widths, so every line lines up. A very long name is allowed to
  // push its own line out rather than widening every other line.
  const NAME_MAX = 40;
  const nameWidth = Math.min(NAME_MAX, Math.max(0, ...all.map((a) => nameOf(a).length)));
  const versionWidth = Math.max(0, ...all.map((a) => txtEscape(a.version).length));
  const linkWidth = Math.max(0, ...all.map((a) => txtEscape(a.link).length));
  const line = (a) => {
    const type = typeLabel(a.type);
    const status = a.enabled ? 'Enabled' : 'Disabled';
    return [
      nameOf(a).padEnd(nameWidth),
      txtEscape(a.version).padEnd(versionWidth),
      type.padEnd('Extension'.length),
      status.padEnd('Disabled'.length),
      txtEscape(a.link).padEnd(linkWidth),
      txtEscape(a.id),
    ].join(' | ');
  };
  const section = (title, items) => {
    if (items.length === 0) return [];
    const heading = `${title} (${items.length})`;
    return [heading, '-'.repeat(heading.length), ...items.map(line), ''];
  };

  const total = all.length;
  const lines = [
    `# addons-hub-format-version: ${EXPORT_FORMAT_VERSION}`,
    '',
    `Firefox Add-ons - ${total} in total (${enabled.length} enabled, ${disabled.length} disabled)`,
    '',
    ...section('Enabled', enabled),
    ...section('Disabled', disabled),
  ];
  // No blank line left dangling at the end.
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\r\n');
}
