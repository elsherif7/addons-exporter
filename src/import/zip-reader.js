// Reads the export files out of a .zip, so the Importer can open the .zip the
// Exporter writes when several formats are ticked (and a .zip made by any
// other tool). Pure: no page, no extension APIs - only the standard Blob,
// DecompressionStream and TextDecoder plus the shared CRC-32
// (src/common/crc32.js), so it can be tested on its own.
//
// What it supports: files that are stored or deflated (the two methods every
// zip tool uses), UTF-8 text, any number of entries. What it refuses, with a
// plain message instead of guessing: encrypted entries, zip64 (archives over
// 4 GB), split archives, a damaged entry (its CRC does not match), and any
// entry that is bigger than the limit it is given.
//
// readZipEntries(bytes, { extensions, maxEntryBytes }) resolves to
//   { ok: true, entries: [{ name, text }] }   - only the entries whose file
//                                               name ends in one of `extensions`,
//                                               in the order they are in the zip
//   { ok: false, error }                      - one readable sentence
// It never rejects: every failure becomes { ok: false, error }.

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_MAX_COMMENT = 0xFFFF;
const ZIP_MAX_ENTRIES_READ = 50; // an export holds at most one file per format

// An entry's checksum is checked with zipCrc32() from src/common/crc32.js - the
// very same function the writer stamps entries with.

const unzipError = (detail) => ({ ok: false, error: `This isn't a .zip file the Importer can read (${detail}).` });

// Finds the "end of central directory" record by looking back from the end of
// the file (a comment of up to 64 KB can follow it). Returns its offset or -1.
function findZipEnd(view) {
  const last = view.byteLength - 22;
  const first = Math.max(0, last - ZIP_MAX_COMMENT);
  for (let i = last; i >= first; i--) {
    if (view.getUint32(i, true) === ZIP_EOCD_SIGNATURE && i + 22 + view.getUint16(i + 20, true) <= view.byteLength) return i;
  }
  return -1;
}

// Inflates raw deflate data, giving up as soon as more than `limit` bytes come
// out (so a tiny zip that expands to gigabytes cannot fill the memory).
async function unzipInflate(bytes, limit) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new Error('too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}

async function readZipEntries(bytes, { extensions, maxEntryBytes }) {
  try {
    if (!bytes || bytes.length < 22) return unzipError('the file is too short');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const end = findZipEnd(view);
    if (end === -1) return unzipError('it has no zip directory, so it is not a zip or it is cut short');

    const diskNumber = view.getUint16(end + 4, true);
    const count = view.getUint16(end + 10, true);
    const centralSize = view.getUint32(end + 12, true);
    const centralStart = view.getUint32(end + 16, true);
    if (count === 0xFFFF || centralSize === 0xFFFFFFFF || centralStart === 0xFFFFFFFF) return unzipError('zip64 archives are not supported');
    if (diskNumber !== 0 || view.getUint16(end + 6, true) !== 0) return unzipError('split archives are not supported');
    if (centralStart + centralSize > end) return unzipError('its directory is damaged');

    const decoder = new TextDecoder('utf-8');
    const wanted = [];
    let pos = centralStart;
    for (let i = 0; i < count; i++) {
      if (pos + 46 > end || view.getUint32(pos, true) !== ZIP_CENTRAL_SIGNATURE) return unzipError('its directory is damaged');
      const flags = view.getUint16(pos + 8, true);
      const method = view.getUint16(pos + 10, true);
      const crc = view.getUint32(pos + 16, true);
      const compressedSize = view.getUint32(pos + 20, true);
      const size = view.getUint32(pos + 24, true);
      const nameLength = view.getUint16(pos + 28, true);
      const extraLength = view.getUint16(pos + 30, true);
      const commentLength = view.getUint16(pos + 32, true);
      const localStart = view.getUint32(pos + 42, true);
      if (pos + 46 + nameLength + extraLength + commentLength > end) return unzipError('its directory is damaged');
      const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength));
      pos += 46 + nameLength + extraLength + commentLength;

      // Folders, the "__MACOSX" copies and "._" files macOS adds are not exports.
      const baseName = name.slice(name.lastIndexOf('/') + 1);
      if (name.endsWith('/') || name.startsWith('__MACOSX/') || baseName.startsWith('._')) continue;
      const dot = baseName.lastIndexOf('.');
      if (dot === -1 || !extensions.has(baseName.slice(dot + 1).toLowerCase())) continue;

      if (flags & 1) return unzipError(`"${name}" is password-protected`);
      if (method !== 0 && method !== 8) return unzipError(`"${name}" uses a compression method that is not supported`);
      if (compressedSize === 0xFFFFFFFF || size === 0xFFFFFFFF || localStart === 0xFFFFFFFF) return unzipError('zip64 archives are not supported');
      if (size > maxEntryBytes) return { ok: false, error: `"${name}" inside the .zip is too large (over ${Math.round(maxEntryBytes / (1024 * 1024))} MB) to be a real export.` };
      wanted.push({ name, method, crc, compressedSize, size, localStart });
      if (wanted.length > ZIP_MAX_ENTRIES_READ) return unzipError('it holds far more files than an export does');
    }

    const entries = [];
    for (const e of wanted) {
      if (e.localStart + 30 > bytes.length || view.getUint32(e.localStart, true) !== ZIP_LOCAL_SIGNATURE) return unzipError(`"${e.name}" is damaged`);
      const dataStart = e.localStart + 30 + view.getUint16(e.localStart + 26, true) + view.getUint16(e.localStart + 28, true);
      if (dataStart + e.compressedSize > bytes.length) return unzipError(`"${e.name}" is cut short`);
      const stored = bytes.subarray(dataStart, dataStart + e.compressedSize);

      let data;
      if (e.method === 0) {
        data = stored;
      } else {
        if (typeof DecompressionStream !== 'function') return unzipError('this browser cannot unpack compressed zips');
        try {
          data = await unzipInflate(stored, e.size);
        } catch {
          return unzipError(`"${e.name}" is damaged`);
        }
      }
      if (data.length !== e.size || zipCrc32(data) !== e.crc) return unzipError(`"${e.name}" is damaged`);
      entries.push({ name: e.name, text: decoder.decode(data) });
    }
    return { ok: true, entries };
  } catch (err) {
    return unzipError(err && err.message ? err.message : 'unknown problem');
  }
}
