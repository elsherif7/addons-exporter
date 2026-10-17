// The Importer's file readers: the pure code that turns the text of an export
// file (HTML report data, JSON, CSV, TXT) into a list of add-ons, or a reason
// the file was rejected. Strict: a file must be exactly what the exporter
// writes. Nothing here touches the page, so it can be tested without a DOM.
// Needs core.js (EXPORT_FORMAT_VERSION, parseType) loaded first.

// SUPPORTED_FORMAT_VERSION tracks EXPORT_FORMAT_VERSION. Format 1 files (the
// add-ons only, with the format version at the top level) and format 2 files
// (also a "source" carrying the format version, the file type and where the
// export came from) are both read; each is checked against its own exact
// layout. migrateAddonsData() below is what's supposed to handle any shape
// change in the add-ons themselves between versions. These two are coupled: bumping the format
// version without also updating migrateAddonsData means old-format
// files get passed straight through unmigrated. A tripwire test in
// tests/import.test.js hardcodes today's version number specifically
// to fail when that happens - see "migrateAddonsData: bumping the
// format version requires updating this test and migrateAddonsData".
const SUPPORTED_FORMAT_VERSION = EXPORT_FORMAT_VERSION;

// No-op for format versions 1 and 2 (the add-on entries did not change; version
// 2 only added the source). Update this (and the tripwire test above) before
// bumping EXPORT_FORMAT_VERSION again.
function migrateAddonsData(addons, formatVersion) {
  return addons;
}

// De-duplicates by id+link (or, lacking an id, name+link) - an exact
// repeat entry would otherwise show up as two rows, and if both got
// selected in the Importer, open the same add-on's page twice. Shared by
// parseAddonsPayload() and parseCsvPayload() below.
function dedupeAddonKey(a) {
  return `${a.id || (a.name || '').toLowerCase()}\u0000${a.link || ''}`;
}
function dedupeAddons(list) {
  const seen = new Set();
  const out = [];
  for (const a of list) {
    const key = dedupeAddonKey(a);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

// Validates the add-ons payload of an export: the JSON file, and the data
// embedded in an HTML report (the script tag #addons-exporter-data). Takes the
// raw text (or null if that tag wasn't found in the HTML file) and returns
// either the ready-to-render list or a user-facing reason the file was
// rejected.
//
// The check is strict: the file must be exactly what the exporter writes,
// including the HTML report from the version released on addons.mozilla.org
// (the same payload):
//   format 2: { "source": { formatVersion, fileType, browser, basedOn, browserVersion, extensionVersion },
//               "addons": [ { id, name, version, enabled, type, link, linkType }, ... ] }
//   format 1: { "formatVersion": 1, "addons": [ ... ] } (what the release on addons.mozilla.org wrote)
// Anything else - another key, a missing field, a field of the wrong type - is
// rejected as a whole, naming the first problem, rather than guessed at.
// Pulled out of loadFile() as a pure function so it can be unit tested without
// a DOM. Throws if jsonText is present but isn't valid JSON - loadFile()'s
// try/catch handles that.
// The field order of an entry in each file: the HTML report's embedded data
// (also what the AMO release wrote) starts with the id; the JSON export lists
// the name first and the id last. A file must use its own format's order.
const HTML_ENTRY_KEYS = ['id', 'name', 'version', 'enabled', 'type', 'link', 'linkType'];
const JSON_ENTRY_KEYS = ['name', 'version', 'type', 'enabled', 'link', 'linkType', 'id'];
const payloadError = (detail) => ({ ok: false, error: `This file doesn't match the Add-ons Exporter format (${detail}).` });
// "Exactly these keys, in exactly this order" is hasExactKeys() in core.js -
// the same check sourceProblem() uses on a source block.

// Returns null when the entry is exactly what the exporter writes, otherwise a
// short reason.
function addonEntryProblem(a, keys) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return 'it is not an object';
  if (!hasExactKeys(a, keys)) return 'its fields are not exactly ' + keys.join(', ') + ', in that order';
  if (typeof a.id !== 'string' || a.id === '') return 'it has no id';
  if (typeof a.name !== 'string' || a.name.trim() === '') return 'it has no name';
  if (typeof a.version !== 'string') return 'its version is not text';
  if (typeof a.enabled !== 'boolean') return 'enabled is not true or false';
  if (a.type !== 'extension' && a.type !== 'theme') return 'its type is not extension or theme';
  if (typeof a.link !== 'string') return 'its link is not text';
  if (typeof a.linkType !== 'string') return 'its linkType is not text';
  return null;
}

// Checks an already-parsed export payload (the HTML report's embedded data, or
// a JSON file's contents) and returns its add-ons, or a reason it was rejected.
function validateAddonsPayload(parsed, entryKeys, fileType) {
  if (!parsed || typeof parsed !== 'object') {
    return payloadError('the data is not an object');
  }

  // Format 2+: the format version, the file type and where the export came from
  // are all inside the "source". Format 1 had no source and carried the format
  // version at the top level. The version is found and checked before anything
  // about the add-ons, so an incompatible file gets a version-specific message.
  const hasSource = parsed.source !== undefined;
  let source = null;
  let formatVersion;
  if (hasSource) {
    const problem = sourceProblem(parsed.source, fileType);
    if (problem) return payloadError(`source: ${problem}`);
    source = parsed.source;
    formatVersion = source.formatVersion;
  } else {
    formatVersion = parsed.formatVersion;
  }
  if (!Number.isInteger(formatVersion) || formatVersion < 1) {
    return { ok: false, error: 'This file is missing its export format version and can\'t be imported.' };
  }
  if (formatVersion > SUPPORTED_FORMAT_VERSION) {
    return { ok: false, error: 'This file was exported by a newer version of Add-ons Exporter. Please update the extension and try again.' };
  }

  const list = Array.isArray(parsed.addons) ? parsed.addons : null;
  if (!list || list.length === 0) {
    return { ok: false, error: 'No add-ons found in that file' };
  }
  const topKeys = formatVersion >= 2 ? ['source', 'addons'] : ['formatVersion', 'addons'];
  if (!hasExactKeys(parsed, topKeys)) {
    return payloadError('the data is not exactly ' + topKeys.join(', then '));
  }

  for (let n = 0; n < list.length; n++) {
    const problem = addonEntryProblem(list[n], entryKeys);
    if (problem) return payloadError(`add-on ${n + 1}: ${problem}`);
  }

  return { ok: true, addons: migrateAddonsData(dedupeAddons(list), formatVersion), source };
}

// Reads the embedded data out of an HTML report's text (the data element's
// content) and validates it. Same return shape as validateAddonsPayload().
function parseAddonsPayload(jsonText, entryKeys = HTML_ENTRY_KEYS, fileType = 'html') {
  if (jsonText == null) {
    return { ok: false, error: 'This file doesn\'t look like an Add-ons Exporter file (no embedded data found)' };
  }
  return validateAddonsPayload(JSON.parse(jsonText), entryKeys, fileType);
}

// Validates and parses a JSON export file's text content. Same return
// shape as validateAddonsPayload(): { ok, addons, source } or { ok: false, error }.
// Throws on malformed JSON - loadFile()'s try/catch handles it.
function parseJsonPayload(text) {
  return validateAddonsPayload(JSON.parse(text), JSON_ENTRY_KEYS, 'json');
}

// Undoes the leading-apostrophe formula-injection guard buildCsvExport()
// (export-formats.js) adds to a field that would otherwise be read as a
// formula by a spreadsheet app (one starting with =, +, -, @, tab, or
// CR). Only strips it when what follows the leading apostrophe(s) is one of
// those - a value that genuinely starts with an apostrophe followed by
// something else is left alone. The exporter guards every value that starts
// with any number of apostrophes then one of those characters, so exactly
// one apostrophe is removed here and the original value comes back.
function stripCsvFormulaGuard(s) {
  return /^'+[=+\-@\t\r]/.test(s) ? s.slice(1) : s;
}

// The one header row buildCsvExport() (export-formats.js) writes.
const CSV_HEADER = ['name', 'version', 'type', 'enabled', 'link', 'linkType', 'id'];

// One message for every "this file is from the future" case below.
const NEWER_VERSION_ERROR = 'This file was exported by a newer version of Add-ons Exporter. Please update the extension and try again.';

// Reads the header a CSV or TXT export starts with: the format-2 source
// comments (whose first line carries the format version) or the format-1 plain
// format-version comment. `formatError` is the format's own error builder
// (csvError/txtError). Returns { ok: true, formatVersion, source, start } -
// `start` is the index of the first body line - or { ok: false, error }.
function readFormatHeader(lines, fileType, formatError) {
  const first = (lines && lines[0]) || '';
  const sourceVersion = first.match(/^# addons-hub-source-formatVersion: (\d+)$/);
  if (sourceVersion) {
    const formatVersion = parseInt(sourceVersion[1], 10);
    if (formatVersion > SUPPORTED_FORMAT_VERSION) return { ok: false, error: NEWER_VERSION_ERROR };
    const source = parseSourceCommentLines(lines.slice(0, SOURCE_KEYS.length), fileType);
    if (!source) return formatError('the file must start with the source comments, "# addons-hub-source-formatVersion: ..." and the five more');
    return { ok: true, formatVersion, source, start: SOURCE_KEYS.length };
  }
  const versionMatch = first.match(/^# addons-hub-format-version: (\d+)$/);
  if (!versionMatch) return { ok: false, error: 'This file doesn\'t look like an Add-ons Exporter file (no format-version comment found)' };
  const formatVersion = parseInt(versionMatch[1], 10);
  if (formatVersion > SUPPORTED_FORMAT_VERSION) return { ok: false, error: NEWER_VERSION_ERROR };
  return { ok: true, formatVersion, source: null, start: 1 };
}

const csvError = (detail) => ({ ok: false, error: `This file doesn't match the Add-ons Exporter CSV format (${detail}).` });

// Validates and parses a CSV export file's text content. Accepts only what
// buildCsvExport() writes:
//   line 1 (format 2): # addons-hub-source-formatVersion: <n>
//   lines 2-6 (format 2): the rest of the source, one comment line per field
//   line 1 (format 1):  # addons-hub-format-version: <n>, no source
//   next:   name,version,type,enabled,link,linkType,id (this exact header)
//   then:   one row per add-on, exactly seven fields, no blank lines
// Anything else is rejected, with the first problem found named.
// Returns { ok, addons, source } (source is null for format 1) or { ok: false, error }.
function parseCsvPayload(text) {
  // The export starts with a byte-order mark (so Excel reads UTF-8); it is not part of the text.
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');

  // Format 2 starts with the source comments, whose first line carries the
  // format version. Format 1 (what the releases wrote) has no source: it starts
  // with a plain format-version comment and its version is only there.
  const header = readFormatHeader(lines, 'csv', csvError);
  if (!header.ok) return header;
  const { formatVersion, source } = header;
  const body = lines.slice(header.start).join('\n');

  // The rest is parsed as a whole, not line by line, so a quoted name that
  // contains a line break stays one field.
  let records;
  try {
    records = parseCsvRecords(body);
  } catch (err) {
    return csvError(err.message);
  }

  if (records.length === 0 || records[0].join(',') !== CSV_HEADER.join(',')) {
    return csvError('the header row must be: ' + CSV_HEADER.join(','));
  }
  if (records.length === 1) {
    return { ok: false, error: 'No add-ons found in that file' };
  }

  const addons = [];
  for (let n = 1; n < records.length; n++) {
    const fields = records[n];
    const where = `row ${n}`;
    if (fields.length !== CSV_HEADER.length) {
      return csvError(`${where} has ${fields.length} fields instead of ${CSV_HEADER.length}`);
    }
    const [name, version, type, enabled, link, linkType, id] = fields.map(stripCsvFormulaGuard);
    if (name.trim() === '') return csvError(`${where} has no name`);
    if (id === '') return csvError(`${where} has no id`);
    if (type !== 'extension' && type !== 'theme') return csvError(`${where} has an unknown type`);
    if (enabled !== 'true' && enabled !== 'false') return csvError(`${where} has an unknown enabled value`);
    addons.push({ name, version, type, enabled: enabled === 'true', link, linkType, id });
  }

  return { ok: true, addons: migrateAddonsData(dedupeAddons(addons), formatVersion), source };
}

// Parses an entire CSV text (RFC 4180) into an array of records, each an
// array of field strings. It walks the whole text in one pass, so a quoted
// field containing a literal newline stays part of that one field. Throws an
// Error (with a short reason) for text buildCsvExport() never writes: a quote
// inside an unquoted field, an unclosed quote, or anything between a closing
// quote and the next comma or line end. A blank line is a record with one
// empty field, which the caller rejects as having the wrong field count.
function parseCsvRecords(text) {
  const records = [];
  let fields = [];
  let i = 0;
  const n = text.length;

  function readField() {
    let field = '';
    if (text[i] === '"') {
      i++; // skip opening quote
      let closed = false;
      while (i < n) {
        if (text[i] === '"' && text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else if (text[i] === '"') {
          i++; // skip closing quote
          closed = true;
          break;
        } else {
          field += text[i++];
        }
      }
      if (!closed) throw new Error('a quoted value is never closed');
      if (i < n && text[i] !== ',' && text[i] !== '\n') {
        throw new Error('unexpected text after a closing quote');
      }
    } else {
      while (i < n && text[i] !== ',' && text[i] !== '\n') {
        if (text[i] === '"') throw new Error('a quote inside an unquoted value');
        field += text[i++];
      }
    }
    return field;
  }

  // No text at all is no records.
  if (n === 0) return records;
  while (i <= n) {
    fields.push(readField());
    if (text[i] === ',') {
      i++;
      continue;
    }
    records.push(fields);
    fields = [];
    if (text[i] === '\n') {
      i++;
    } else {
      break; // end of text
    }
  }
  return records;
}


// Reverses the escaping buildTxtExport() (export-formats.js) applies to every
// column: \\ is a backslash, \| a pipe, \n a line break, \r a carriage
// return, \s a space (used for a space at the very start or end of a value).
// Returns null for a backslash followed by anything else, which the exporter
// never writes.
function txtUnescape(text) {
  // Take the valid escapes out first; any backslash left over is not one.
  if (text.replace(/\\[\\|nrs]/g, '').includes('\\')) return null;
  return text.replace(/\\([\\|nrs])/g, (m, c) => ({ '\\': '\\', '|': '|', n: '\n', r: '\r', s: ' ' }[c]));
}

// A column's text with only the padding spaces removed (not tabs or other
// whitespace, which belong to the value), then unescaped. null if invalid.
function readTxtCell(text) {
  return txtUnescape(text.replace(/^ +| +$/g, ''));
}

const txtError = (detail) => ({ ok: false, error: `This file doesn't match the Add-ons Exporter TXT format (${detail}).` });

// Validates and parses a TXT export file's text content. Accepts only what
// buildTxtExport() writes:
//   line 1 (format 2): # addons-hub-source-formatVersion: <n>
//   lines 2-6 (format 2): the rest of the source, one comment line per field
//   line 1 (format 1):  # addons-hub-format-version: <n>, no source
//   then the title, the section headings and their underlines (any line with
//   no " | " in it is skipped)
//   then one add-on per line, exactly seven columns - six in a format 1 file,
//   which predates the link type:
//     Name | Version | Type | Status | Link | LinkType | Id
// A line with " | " in it that is not a valid add-on line rejects the whole
// file, with its line number. Returns { ok, addons, source } (source is null for
// format 1) or { ok: false, error }.
function parseTxtPayload(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  // Format 2 starts with the source comments, whose first line carries the
  // format version. Format 1 (what the releases wrote) has no source: it starts
  // with a plain format-version comment and its version is only there.
  const header = readFormatHeader(lines, 'txt', txtError);
  if (!header.ok) return header;
  const { formatVersion, source } = header;
  const start = header.start;

  // Format 2 added the link-type column (before the id); format 1 files, which
  // predate it, have one column fewer. Both are read, each against its own
  // exact layout.
  const columnCount = formatVersion >= 2 ? 7 : 6;
  const addons = [];
  for (let n = start; n < lines.length; n++) {
    const line = lines[n];
    if (!line.includes(' | ')) continue;
    const parts = line.split(' | ');
    const where = `line ${n + 1}`;
    if (parts.length !== columnCount) return txtError(`${where} has ${parts.length} columns instead of ${columnCount}`);
    const cells = parts.map(readTxtCell);
    if (cells.includes(null)) return txtError(`${where} has a backslash that is not an escape`);
    const name = cells[0];
    const version = cells[1];
    const type = cells[2];
    const status = cells[3];
    const link = cells[4];
    const id = cells[cells.length - 1];
    if (name === '') return txtError(`${where} has no name`);
    if (id === '') return txtError(`${where} has no id`);
    const parsedType = parseType(type);
    if (!parsedType) return txtError(`${where} has an unknown type`);
    if (status !== 'Enabled' && status !== 'Disabled') return txtError(`${where} has an unknown status`);
    const addon = { name, version, type: parsedType, enabled: status === 'Enabled', link, id };
    if (formatVersion >= 2) addon.linkType = cells[5];
    addons.push(addon);
  }

  if (addons.length === 0) {
    return { ok: false, error: 'No add-ons found in that file' };
  }

  return { ok: true, addons: migrateAddonsData(dedupeAddons(addons), formatVersion), source };
}
