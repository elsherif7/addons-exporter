// Minimal ZIP writer. When several formats are ticked they go out as one
// file, because Firefox asks for a save location once per downloaded file.
// Entries are stored uncompressed (the exports are small text files).
// The CRC comes from common/crc32.js, shared with the reader.

// files: [{ name, content }]. Returns the whole .zip as a Uint8Array. `date`
// stamps every entry (ZIP uses local time).
function buildZip(files, date = new Date()) {
  const encoder = new TextEncoder();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = (Math.max(date.getFullYear() - 1980, 0) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();

  const entries = files.map((f) => {
    const nameBytes = encoder.encode(f.name);
    const data = encoder.encode(f.content);
    return { nameBytes, data, crc: zipCrc32(data) };
  });

  let localSize = 0;
  let centralSize = 0;
  for (const e of entries) {
    localSize += 30 + e.nameBytes.length + e.data.length;
    centralSize += 46 + e.nameBytes.length;
  }
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let pos = 0;
  const u16 = (v) => { view.setUint16(pos, v, true); pos += 2; };
  const u32 = (v) => { view.setUint32(pos, v, true); pos += 4; };

  // local headers + data
  for (const e of entries) {
    e.offset = pos;
    u32(0x04034b50); u16(20); u16(0x0800); u16(0); u16(dosTime); u16(dosDate);
    u32(e.crc); u32(e.data.length); u32(e.data.length); u16(e.nameBytes.length); u16(0);
    out.set(e.nameBytes, pos); pos += e.nameBytes.length;
    out.set(e.data, pos); pos += e.data.length;
  }
  // central directory
  const centralStart = pos;
  for (const e of entries) {
    u32(0x02014b50); u16(20); u16(20); u16(0x0800); u16(0); u16(dosTime); u16(dosDate);
    u32(e.crc); u32(e.data.length); u32(e.data.length); u16(e.nameBytes.length);
    u16(0); u16(0); u16(0); u16(0); u32(0); u32(e.offset);
    out.set(e.nameBytes, pos); pos += e.nameBytes.length;
  }
  // end record (size taken first, pos moves as it's written)
  const centralBytes = pos - centralStart;
  u32(0x06054b50); u16(0); u16(0); u16(entries.length); u16(entries.length);
  u32(centralBytes); u32(centralStart); u16(0);
  return out;
}
