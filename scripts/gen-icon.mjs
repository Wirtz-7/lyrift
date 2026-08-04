// Generates the Lyrift app icon (1024x1024 RGBA PNG) with no dependencies:
// rounded-square indigo/violet gradient + five white equalizer bars.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const S = 1024;
const R = 228; // corner radius

// crc32
const TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  TABLE[n] = c;
}
const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

// gradient stops (top -> bottom)
const top = [124, 58, 237]; // violet-600
const bottom = [30, 27, 75]; // indigo-950

// equalizer bars: [centerX, topY, bottomY], half-width 34
const bars = [
  [300, 400, 624],
  [408, 300, 724],
  [516, 216, 808],
  [624, 336, 688],
  [732, 428, 596],
];
const BW = 34;

const roundRectSdf = (x, y) => {
  const qx = Math.abs(x - S / 2) - (S / 2 - R);
  const qy = Math.abs(y - S / 2) - (S / 2 - R);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - R;
};
const barDist = (x, y, [cx, y0, y1]) => {
  const sy = Math.min(Math.max(y, y0 + BW), y1 - BW);
  return Math.hypot(x - cx, y - sy);
};

const raw = Buffer.alloc(S * (S * 4 + 1));
let o = 0;
for (let y = 0; y < S; y++) {
  raw[o++] = 0; // filter: none
  const t = y / (S - 1);
  const bg = [0, 1, 2].map((i) => top[i] + (bottom[i] - top[i]) * t);
  for (let x = 0; x < S; x++) {
    const cover = Math.min(Math.max(0.5 - roundRectSdf(x, y), 0), 1);
    let r = bg[0], g = bg[1], b = bg[2], a = cover;
    for (const bar of bars) {
      const bc = Math.min(Math.max(BW + 0.5 - barDist(x, y, bar), 0), 1);
      if (bc > 0) {
        // blend white bar over gradient
        r = r + (250 - r) * bc;
        g = g + (250 - g) * bc;
        b = b + (252 - b) * bc;
      }
    }
    raw[o++] = Math.round(r);
    raw[o++] = Math.round(g);
    raw[o++] = Math.round(b);
    raw[o++] = Math.round(a * 255);
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(new URL("./icon-1024.png", import.meta.url), png);
console.log("icon-1024.png written", png.length, "bytes");
