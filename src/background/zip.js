// A minimal ZIP writer, used when several export formats are ticked so they
// can be saved as ONE file - Firefox only lets an extension pick a save
// location once per downloaded file, so several files would mean several
// Save dialogs. Files are stored uncompressed (the exports are small text),
// which keeps this short and dependable. Plain classic script, like the rest
// of the background scripts: buildZip() is a global.

const ZIP_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function zipCrc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = ZIP_CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// files: [{ name: 'a.json', content: '...text...' }]. Returns a Uint8Array
// holding the whole .zip. `date` stamps every entry (ZIP stores local time).
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

  // Local file headers + data.
  for (const e of entries) {
    e.offset = pos;
    u32(0x04034b50); u16(20); u16(0x0800); u16(0); u16(dosTime); u16(dosDate);
    u32(e.crc); u32(e.data.length); u32(e.data.length); u16(e.nameBytes.length); u16(0);
    out.set(e.nameBytes, pos); pos += e.nameBytes.length;
    out.set(e.data, pos); pos += e.data.length;
  }
  // Central directory.
  const centralStart = pos;
  for (const e of entries) {
    u32(0x02014b50); u16(20); u16(20); u16(0x0800); u16(0); u16(dosTime); u16(dosDate);
    u32(e.crc); u32(e.data.length); u32(e.data.length); u16(e.nameBytes.length);
    u16(0); u16(0); u16(0); u16(0); u32(0); u32(e.offset);
    out.set(e.nameBytes, pos); pos += e.nameBytes.length;
  }
  // End of central directory (its size is taken first: pos moves as it is written).
  const centralBytes = pos - centralStart;
  u32(0x06054b50); u16(0); u16(0); u16(entries.length); u16(entries.length);
  u32(centralBytes); u32(centralStart); u16(0);
  return out;
}
