// Genera icon PNG per manifest/apple-touch-icon (stesso design dell'SVG).
// Uso one-shot: node gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, pixelFn) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bit RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelFn(x + 0.5, y + 0.5, size);
      raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = a;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG = [0x0b, 0x0f, 0x14], ACC = [0x29, 0xb6, 0xf6];

// Rounded-square mask: rx = size*96/512 (come l'SVG)
function roundedAlpha(x, y, size) {
  const rx = size * 96 / 512;
  const r = rx;
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  const d = Math.hypot(x - cx, y - cy);
  return d <= r ? 255 : 0;
}

// Disegno: anello (raggio R, spessore W), lancetta ruotata 35°, centro.
function draw(x, y, size) {
  const S = size / 512;
  const cx = 256 * S, cy = 256 * S;
  const ringR = 150 * S, ringW = 24 * S;
  const dotR = 26 * S;
  // lancetta: segmento dal centro verso l'alto, ruotato di 35°, lunghezza 120*S, spessore 24*S
  const a = 35 * Math.PI / 180;
  const ux = Math.sin(a), uy = -Math.cos(a);           // direzione (ruota l'asse up)
  const px = x - cx, py = y - cy;
  const t = px * ux + py * uy;                          // proiezione lungo lancetta
  const perp = Math.abs(-px * uy + py * ux);
  const len = 120 * S;

  const inNeedle = t >= -dotR && t <= len && perp <= ringW / 2;
  const dRing = Math.abs(Math.hypot(px, py) - ringR);
  const inRing = dRing <= ringW / 2;
  const inDot = Math.hypot(px, py) <= dotR;

  const fg = inRing || inDot || inNeedle;
  const alpha = roundedAlpha(x, y, size);
  const col = fg ? ACC : BG;
  return [col[0], col[1], col[2], alpha];
}

const dir = join(root, 'icons');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'icon-192.png'), png(192, draw));
writeFileSync(join(dir, 'icon-512.png'), png(512, draw));
writeFileSync(join(dir, 'apple-touch-icon.png'), png(180, draw));
console.log('ok');
