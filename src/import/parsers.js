// The Importer's file readers: turn the text of an export file (HTML report
// data, JSON, CSV, TXT) into a list of add-ons, or a reason it was rejected.
// Strict: a file must be exactly what the exporter writes. No page code.
// Needs core.js (EXPORT_FORMAT_VERSION, parseType).

// Format 1 files (add-ons only, version at the top level), format 2 files
// (with a "source"), and format 3 files (with a device in the source) are all
// read, each against its own exact layout. migrateAddonsData() handles any
// change in the add-ons themselves between versions, so the two go together:
// bumping the format version without updating it would pass old files through
// unmigrated. A tripwire test in tests/import.test.js hardcodes today's version
// to fail when that happens.
const SUPPORTED_FORMAT_VERSION = EXPORT_FORMAT_VERSION;

// The two ways a format version can be unusable: none at all (missing,
// non-numeric, or a hand-edited "0"), or newer than this Importer knows. Every
// reader uses these, so the wording is the same whatever the format.
const NO_VERSION_ERROR = 'This file is missing its export format version and can\'t be imported.';
const NEWER_VERSION_ERROR = 'This file was exported by a newer version of Add-ons Exporter. Please update the extension and try again.';

// No-op for versions 1, 2 and 3 (version 2 added the source, version 3 added
// the device to it). Update this and the tripwire test before bumping
// EXPORT_FORMAT_VERSION again.
function migrateAddonsData(addons, formatVersion) {
  return addons;
}

// De-duplicates by id+link (name+link without an id). An exact repeat would
// show as two rows, and selecting both would open the same page twice.
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

// Validates the add-ons payload of an export (the JSON file, or the data in an
// HTML report's #addons-exporter-data tag). Takes the raw text, or null if the
// tag wasn't found, and returns the list or a user-facing reason.
//
// Strict: exactly what the exporter writes, HTML reports from the release on
// addons.mozilla.org included:
//   format 3: { "source": { formatVersion, fileType, device, basedOn, browser, browserVersion, extensionVersion },
//               "addons": [ { id, name, version, enabled, type, link, linkType }, ... ] }
//   format 2: the same, without device in the source
//   format 1: { "formatVersion": 1, "addons": [ ... ] }
// Anything else (another key, a missing field, a wrong type) rejects the whole
// file and names the first problem. Throws if jsonText isn't valid JSON, so
// the caller (parseChosenFile() in import.js) needs a try/catch.
// Entry field order differs per file: the HTML data (and the AMO release)
// starts with the id, the JSON export has the name first and the id last.
const HTML_ENTRY_KEYS = ['id', 'name', 'version', 'enabled', 'type', 'link', 'linkType'];
const JSON_ENTRY_KEYS = ['name', 'version', 'type', 'enabled', 'link', 'linkType', 'id'];
const payloadError = (detail) => ({ ok: false, error: `This file doesn't match the Add-ons Exporter format (${detail}).` });

// null if the entry is exactly what the exporter writes, else a short reason
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

function validateAddonsPayload(parsed, entryKeys, fileType) {
  if (!parsed || typeof parsed !== 'object') {
    return payloadError('the data is not an object');
  }

  // Format 2+ keeps the version inside "source"; format 1 had it at the top
  // level. It's checked before anything else so an incompatible file gets a
  // version-specific message.
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
    return { ok: false, error: NO_VERSION_ERROR };
  }
  if (formatVersion > SUPPORTED_FORMAT_VERSION) {
    return { ok: false, error: NEWER_VERSION_ERROR };
  }

  const list = Array.isArray(parsed.addons) ? parsed.addons : null;
  if (!list || list.length === 0) {
    return { ok: false, error: 'No add-ons found in that file.' };
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

// Validates the HTML report's embedded data text. Same result as validateAddonsPayload().
function parseAddonsPayload(jsonText, entryKeys = HTML_ENTRY_KEYS, fileType = 'html') {
  if (jsonText == null) {
    return { ok: false, error: 'This file doesn\'t look like an Add-ons Exporter file (no embedded data found)' };
  }
  // empty isn't JSON, and "Unexpected end of JSON input" would be all the user saw
  if (jsonText.trim() === '') return { ok: false, error: 'No add-ons found in that file.' };
  return validateAddonsPayload(JSON.parse(jsonText), entryKeys, fileType);
}

// Same result as validateAddonsPayload(). Throws on malformed JSON.
function parseJsonPayload(text) {
  return validateAddonsPayload(JSON.parse(text), JSON_ENTRY_KEYS, 'json');
}

// Undoes the leading apostrophe buildCsvExport() adds to values a spreadsheet
// would read as formulas. The exporter guards any run of apostrophes followed
// by one of = + - @ tab CR, so removing exactly one gives the original back.
// An apostrophe followed by anything else is left alone.
function stripCsvFormulaGuard(s) {
  return /^'+[=+\-@\t\r]/.test(s) ? s.slice(1) : s;
}

const CSV_HEADER = ['name', 'version', 'type', 'enabled', 'link', 'linkType', 'id'];

// Reads the header of a CSV or TXT export: the format-2/3 source comments or
// the format-1 version comment. `formatError` is the format's own error
// builder. Returns { ok: true, formatVersion, source, start } (`start` is the
// first body line) or { ok: false, error }.
function readFormatHeader(lines, fileType, formatError) {
  const first = (lines && lines[0]) || '';
  const sourceVersion = first.match(/^# addons-hub-source-formatVersion: (\d+)$/);
  if (sourceVersion) {
    const formatVersion = parseInt(sourceVersion[1], 10);
    // refused before the rest of the source is read, so a "0" isn't blamed on the comments
    if (formatVersion < 1) return { ok: false, error: NO_VERSION_ERROR };
    if (formatVersion > SUPPORTED_FORMAT_VERSION) return { ok: false, error: NEWER_VERSION_ERROR };
    const sourceKeys = sourceKeysFor(formatVersion);
    const source = parseSourceCommentLines(lines.slice(0, sourceKeys.length), fileType);
    if (!source) return formatError(`the file must start with the source comments, "# addons-hub-source-formatVersion: ..." and the other ${sourceKeys.length - 1}`);
    return { ok: true, formatVersion, source, start: sourceKeys.length };
  }
  const versionMatch = first.match(/^# addons-hub-format-version: (\d+)$/);
  if (!versionMatch) return { ok: false, error: 'This file doesn\'t look like an Add-ons Exporter file (no format-version comment found)' };
  const formatVersion = parseInt(versionMatch[1], 10);
  if (formatVersion < 1) return { ok: false, error: NO_VERSION_ERROR };
  if (formatVersion > SUPPORTED_FORMAT_VERSION) return { ok: false, error: NEWER_VERSION_ERROR };
  return { ok: true, formatVersion, source: null, start: 1 };
}

const csvError = (detail) => ({ ok: false, error: `This file doesn't match the Add-ons Exporter CSV format (${detail}).` });

// Accepts only what buildCsvExport() writes:
//   line 1 (format 2/3): # addons-hub-source-formatVersion: <n>
//   the next lines (format 2/3): the rest of the source, one comment per field
//   line 1 (format 1): # addons-hub-format-version: <n>, no source
//   next: name,version,type,enabled,link,linkType,id (this exact header)
//   then: one row per add-on, exactly seven fields, no blank lines
// Anything else is rejected and the first problem named. Returns { ok, addons,
// source } (source is null for format 1) or { ok: false, error }.
function parseCsvPayload(text) {
  // drop the BOM the export starts with
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');

  const header = readFormatHeader(lines, 'csv', csvError);
  if (!header.ok) return header;
  const { formatVersion, source } = header;
  const body = lines.slice(header.start).join('\n');

  // parsed as a whole so a quoted name with a line break stays one field
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
    return { ok: false, error: 'No add-ons found in that file.' };
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

// Parses a whole CSV text (RFC 4180) into records of field strings, in one
// pass so a quoted field with a newline stays one field. Throws a short reason
// for text the exporter never writes: a quote inside an unquoted field, an
// unclosed quote, or anything between a closing quote and the next comma or
// line end. A blank line is a record with one empty field, which the caller
// rejects for the wrong field count.
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

// Reverses buildTxtExport()'s escaping: \\ backslash, \| pipe, \n line break,
// \r carriage return, \s a space at the start or end of a value. Returns null
// for a backslash followed by anything else, which the exporter never writes.
function txtUnescape(text) {
  // after removing the valid escapes, any backslash left is invalid
  if (text.replace(/\\[\\|nrs]/g, '').includes('\\')) return null;
  return text.replace(/\\([\\|nrs])/g, (m, c) => ({ '\\': '\\', '|': '|', n: '\n', r: '\r', s: ' ' }[c]));
}

// Strips only the padding spaces (tabs and other whitespace belong to the
// value), then unescapes. null if invalid.
function readTxtCell(text) {
  return txtUnescape(text.replace(/^ +| +$/g, ''));
}

const txtError = (detail) => ({ ok: false, error: `This file doesn't match the Add-ons Exporter TXT format (${detail}).` });

// Accepts only what buildTxtExport() writes:
//   line 1 (format 2/3): # addons-hub-source-formatVersion: <n>
//   the next lines (format 2/3): the rest of the source, one comment per field
//   line 1 (format 1): # addons-hub-format-version: <n>, no source
//   then the title, section headings and underlines (any line without " | "
//   is skipped)
//   then one add-on per line: seven columns, six in format 1 (no link type)
//     Name | Version | Type | Status | Link | LinkType | Id
// A line with " | " that isn't a valid add-on line rejects the whole file,
// with its line number. Returns { ok, addons, source } (source is null for
// format 1) or { ok: false, error }.
function parseTxtPayload(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  const header = readFormatHeader(lines, 'txt', txtError);
  if (!header.ok) return header;
  const { formatVersion, source } = header;
  const start = header.start;

  // format 2 added the link-type column before the id
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
    if (name.trim() === '') return txtError(`${where} has no name`);
    if (id === '') return txtError(`${where} has no id`);
    const parsedType = parseType(type);
    if (!parsedType) return txtError(`${where} has an unknown type`);
    if (status !== 'Enabled' && status !== 'Disabled') return txtError(`${where} has an unknown status`);
    const addon = { name, version, type: parsedType, enabled: status === 'Enabled', link, id };
    if (formatVersion >= 2) addon.linkType = cells[5];
    addons.push(addon);
  }

  if (addons.length === 0) {
    return { ok: false, error: 'No add-ons found in that file.' };
  }

  return { ok: true, addons: migrateAddonsData(dedupeAddons(addons), formatVersion), source };
}
