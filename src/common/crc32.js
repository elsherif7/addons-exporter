// CRC-32 (the checksum ZIP stores for every entry), shared by the extension's
// zip writer (background/zip.js, which stamps each entry) and its zip reader
// (import/zip-reader.js, which checks each entry). One implementation, so the
// two can never disagree about what a correct entry looks like.
//
// Pure: it touches nothing - no page, no extension APIs - so it loads in the
// background and in the Importer page alike, before zip.js / zip-reader.js.

const ZIP_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

// The CRC-32 of a byte array, as a non-negative 32-bit number.
function zipCrc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = ZIP_CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
