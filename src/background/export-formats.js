// JSON, CSV and TXT export builders. Pure string building, nothing here
// touches browser.*. Needs core.js (groupForReading, shortName, typeLabel,
// EXPORT_FORMAT_VERSION...).

// Fields in reading order, name first and id last. The importer finds them by
// name, so the order is only for people.
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

// Same add-ons as the HTML report's embedded data, as a standalone .json.
// `shorten` is the Settings choice. The id is always written and the
// Importer matches on it first, so a shortened name never loses a match.
// `source` is the browser part of the source block; the file type and format
// version are added here.
function buildJsonExport(list, shorten = true, source = UNKNOWN_BROWSER) {
  return JSON.stringify({
    source: makeSource('json', EXPORT_FORMAT_VERSION, source),
    addons: groupForReading(list).all.map((a) => jsonAddon(a, shorten)),
  }, null, 2);
}

// CSV: source comment lines, a header row, then one row per add-on. Quoting
// follows RFC 4180.
function buildCsvExport(list, shorten = true, source = UNKNOWN_BROWSER) {
  const csvField = (val) => {
    let s = String(val == null ? '' : val);
    // Spreadsheets run a cell starting with = + - @ tab or CR as a formula,
    // and add-on names are attacker-controlled. A leading apostrophe makes
    // them read it as text. parseCsvPayload() strips exactly one back off.
    // Names that start with apostrophes and then one of those characters get
    // the guard too, so the importer returns the original name unchanged.
    if (/^'*[=+\-@\t\r]/.test(s)) {
      s = `'${s}`;
    }
    return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const row = (fields) => fields.map(csvField).join(',');

  // The BOM makes Excel read the file as UTF-8 (the importer ignores it).
  const lines = [
    ...sourceCommentLines(makeSource('csv', EXPORT_FORMAT_VERSION, source)),
    row(['name', 'version', 'type', 'enabled', 'link', 'linkType', 'id']),
    ...groupForReading(list).all.map((a) => row([shorten ? shortName(a.name) : a.name, a.version, a.type, a.enabled, a.link, a.linkType, a.id])),
  ];
  return '\uFEFF' + lines.join('\r\n');
}

// TXT is laid out to be read: a title, then Enabled and Disabled sections
// (A-Z) with aligned columns, one add-on per line:
//   Name | Version | Type | Status | Link | LinkType | Id
// The Importer ignores every line without " | " (title, headings,
// underlines), so none of those may contain it.
//
// Values are escaped so an add-on stays on one line and a name can't be
// mistaken for a separator. import.js's txtUnescape() reverses this.
//   \\  backslash        \|  pipe
//   \n  line break       \r  carriage return
//   \s  a space at the very start or end (the columns are padded with spaces,
//       so edge spaces would be lost otherwise)
function txtEscape(value) {
  return String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/^ +| +$/g, (spaces) => '\\s'.repeat(spaces.length));
}

function buildTxtExport(list, shorten = true, source = UNKNOWN_BROWSER) {
  const { enabled, disabled, all } = groupForReading(list);
  const nameOf = (a) => txtEscape(shorten ? shortName(a.name) : a.name);

  // A very long name pushes out its own line instead of widening all of them.
  const NAME_MAX = 40;
  const nameWidth = Math.min(NAME_MAX, Math.max(0, ...all.map((a) => nameOf(a).length)));
  const versionWidth = Math.max(0, ...all.map((a) => txtEscape(a.version).length));
  const linkWidth = Math.max(0, ...all.map((a) => txtEscape(a.link).length));
  const linkTypeWidth = Math.max(0, ...all.map((a) => txtEscape(a.linkType).length));
  const line = (a) => {
    const type = typeLabel(a.type);
    const status = a.enabled ? 'Enabled' : 'Disabled';
    return [
      nameOf(a).padEnd(nameWidth),
      txtEscape(a.version).padEnd(versionWidth),
      type.padEnd('Extension'.length),
      status.padEnd('Disabled'.length),
      txtEscape(a.link).padEnd(linkWidth),
      txtEscape(a.linkType).padEnd(linkTypeWidth),
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
    ...sourceCommentLines(makeSource('txt', EXPORT_FORMAT_VERSION, source)),
    '',
    `${normalizeBrowserSource(source).browser} Add-ons - ${total} in total (${enabled.length} enabled, ${disabled.length} disabled)`,
    '',
    ...section('Enabled', enabled),
    ...section('Disabled', disabled),
  ];
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\r\n');
}
