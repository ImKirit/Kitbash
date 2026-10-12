// Draws build/icon.png (256x256), build/icon.ico and src/renderer/logo.png
// without dependencies: raw RGBA pixels, zlib, hand built PNG chunks.
// A near-black rounded tile with a white K whose arms cross past the stem.
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 256;
const SS = 4; // supersampling per axis
const px = Buffer.alloc(S * S * 4);

function rrect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
function seg(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  let t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

const BG = [21, 21, 26];
const FG = [255, 255, 255];
const W = 15; // half stroke width

function sample(x, y) {
  if (rrect(x, y, 128, 128, 118, 118, 54) > 0) return null;
  const stem = rrect(x, y, 84, 128, W, 72, 5) <= 0;
  const armA = seg(x, y, 98, 186, 186, 62) <= W;   // rising arm
  const armB = seg(x, y, 98, 70, 186, 194) <= W;   // falling arm, crosses the other
  return stem || armA || armB ? FG : BG;
}

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const c = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
        if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
      }
    }
    const i = (y * S + x) * 4;
    if (a) { px[i] = Math.round(r / a); px[i + 1] = Math.round(g / a); px[i + 2] = Math.round(b / a); }
    px[i + 3] = Math.round((a / (SS * SS)) * 255);
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}
function png() {
  const raw = Buffer.alloc(S * (S * 4 + 1));
  for (let y = 0; y < S; y++) px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const out = png();
const root = path.join(__dirname, '..');
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.writeFileSync(path.join(root, 'build', 'icon.png'), out);
fs.writeFileSync(path.join(root, 'src', 'renderer', 'logo.png'), out);

// ICO container with the PNG embedded (Windows Vista and later).
const head = Buffer.alloc(22);
head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
head[6] = 0; head[7] = 0;
head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
head.writeUInt32LE(out.length, 14); head.writeUInt32LE(22, 18);
fs.writeFileSync(path.join(root, 'build', 'icon.ico'), Buffer.concat([head, out]));
console.log('wrote build/icon.png, build/icon.ico, src/renderer/logo.png');
