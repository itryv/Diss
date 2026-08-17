'use strict';

/**
 * Writes build/icon.png — the Diss mark (rounded dark tile + accent dot) — so the
 * packaged app carries a real icon without checking a binary into the repo.
 * Hand-rolled PNG encoder: no image dependency for one generated file.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 1024;
const BG = [26, 22, 19];        // #1a1613
const ACCENT = [240, 139, 95];  // #f08b5f
const INK = [244, 238, 229];    // #f4eee5

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

const crc32 = buf => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** Coverage of a rounded rectangle, antialiased by distance to the edge. */
function roundedRectCoverage(x, y, w, h, r) {
  const cx = Math.min(Math.max(x, r), w - r);
  const cy = Math.min(Math.max(y, r), h - r);
  const d = Math.hypot(x - cx, y - cy);
  return Math.min(1, Math.max(0, r - d + 0.5));
}

function build() {
  const px = Buffer.alloc(SIZE * SIZE * 4);
  const radius = SIZE * 0.22;
  const dotR = SIZE * 0.115;
  const dotX = SIZE * 0.5, dotY = SIZE * 0.5;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      const tile = roundedRectCoverage(x + 0.5, y + 0.5, SIZE, SIZE, radius);
      // Subtle top-down warm gradient so the tile isn't a flat block.
      const t = y / SIZE;
      let r = BG[0] + 14 * (1 - t), g = BG[1] + 10 * (1 - t), b = BG[2] + 8 * (1 - t);

      const dd = Math.hypot(x + 0.5 - dotX, y + 0.5 - dotY);
      const dot = Math.min(1, Math.max(0, dotR - dd + 0.5));
      if (dot > 0) {
        r = r * (1 - dot) + ACCENT[0] * dot;
        g = g * (1 - dot) + ACCENT[1] * dot;
        b = b * (1 - dot) + ACCENT[2] * dot;
      }

      // The wordmark's descender stroke, echoing "diss."
      const barW = SIZE * 0.30, barH = SIZE * 0.035;
      const bx = Math.abs(x + 0.5 - SIZE * 0.5), by = Math.abs(y + 0.5 - SIZE * 0.74);
      if (bx < barW / 2 && by < barH / 2) {
        const a = 0.85;
        r = r * (1 - a) + INK[0] * a;
        g = g * (1 - a) + INK[1] * a;
        b = b * (1 - a) + INK[2] * a;
      }

      px[i] = Math.round(r); px[i + 1] = Math.round(g); px[i + 2] = Math.round(b);
      px[i + 3] = Math.round(255 * tile);
    }
  }

  // Filter type 0 per scanline.
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0;
    px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, build());
console.log(`icon written: ${out} (${SIZE}×${SIZE})`);
