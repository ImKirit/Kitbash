// Reads the largest icon out of a Windows executable (PE resource section).
// Used to show a game's own icon, taken from the player's installed game.
// Read only. Returns an .ico file as a Buffer, or null.
'use strict';

const fs = require('fs');

const RT_ICON = 3;
const RT_GROUP_ICON = 14;
const MAX_EXE_BYTES = 300 * 1024 * 1024;

function largestIcon(exePath) {
  let buf;
  try {
    if (fs.statSync(exePath).size > MAX_EXE_BYTES) return null;
    buf = fs.readFileSync(exePath);
  } catch { return null; }
  try { return parse(buf); } catch { return null; }
}

function parse(buf) {
  if (buf.readUInt16LE(0) !== 0x5a4d) return null;                 // MZ
  const pe = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(pe) !== 0x00004550) return null;            // PE\0\0
  const sections = buf.readUInt16LE(pe + 6);
  const optSize = buf.readUInt16LE(pe + 20);
  const opt = pe + 24;
  const pe32plus = buf.readUInt16LE(opt) === 0x20b;
  const dirs = opt + (pe32plus ? 112 : 96);
  const rsrcRva = buf.readUInt32LE(dirs + 2 * 8);                  // resource table
  if (!rsrcRva) return null;

  const table = opt + optSize;
  const secs = [];
  for (let i = 0; i < sections; i++) {
    const o = table + i * 40;
    secs.push({ vsize: buf.readUInt32LE(o + 8), rva: buf.readUInt32LE(o + 12), rawSize: buf.readUInt32LE(o + 16), raw: buf.readUInt32LE(o + 20) });
  }
  const toOffset = (rva) => {
    for (const s of secs) if (rva >= s.rva && rva < s.rva + Math.max(s.vsize, s.rawSize)) return rva - s.rva + s.raw;
    throw new Error('rva outside sections');
  };
  const base = toOffset(rsrcRva);

  // One directory level: [{ id, offset, isDir }]
  const entries = (dirOff) => {
    const named = buf.readUInt16LE(dirOff + 12);
    const ids = buf.readUInt16LE(dirOff + 14);
    const out = [];
    for (let i = 0; i < named + ids && i < 4096; i++) {
      const e = dirOff + 16 + i * 8;
      const name = buf.readUInt32LE(e);
      const off = buf.readUInt32LE(e + 4);
      out.push({ id: name & 0x80000000 ? null : name, offset: base + (off & 0x7fffffff), isDir: !!(off & 0x80000000) });
    }
    return out;
  };
  const dataOf = (leafDir) => {
    // language level: take the first language
    const lang = entries(leafDir)[0];
    if (!lang || lang.isDir) return null;
    const rva = buf.readUInt32LE(lang.offset);
    const size = buf.readUInt32LE(lang.offset + 4);
    const start = toOffset(rva);
    return buf.subarray(start, start + size);
  };

  const types = entries(base);
  const groupType = types.find((t) => t.id === RT_GROUP_ICON && t.isDir);
  const iconType = types.find((t) => t.id === RT_ICON && t.isDir);
  if (!groupType || !iconType) return null;
  const icons = new Map(entries(iconType.offset).filter((e) => e.isDir && e.id !== null).map((e) => [e.id, e.offset]));

  let best = null;
  for (const g of entries(groupType.offset)) {
    if (!g.isDir) continue;
    const grp = dataOf(g.offset);
    if (!grp || grp.length < 6) continue;
    const count = grp.readUInt16LE(4);
    for (let i = 0; i < count && 6 + (i + 1) * 14 <= grp.length; i++) {
      const o = 6 + i * 14;
      const w = grp[o] || 256;
      const h = grp[o + 1] || 256;
      const bits = grp.readUInt16LE(o + 6);
      const id = grp.readUInt16LE(o + 12);
      const score = w * 1000 + bits;
      if (icons.has(id) && (!best || score > best.score)) best = { score, w, h, planes: grp.readUInt16LE(o + 4), bits, id };
    }
    if (best) break; // the first group is the application icon
  }
  if (!best) return null;
  const data = dataOf(icons.get(best.id));
  if (!data || !data.length) return null;

  // Wrap the single image into an .ico container.
  const head = Buffer.alloc(22);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(1, 4);
  head[6] = best.w >= 256 ? 0 : best.w;
  head[7] = best.h >= 256 ? 0 : best.h;
  head.writeUInt16LE(best.planes || 1, 10);
  head.writeUInt16LE(best.bits || 32, 12);
  head.writeUInt32LE(data.length, 14);
  head.writeUInt32LE(22, 18);
  const isPng = data.length > 8 && data.readUInt32BE(0) === 0x89504e47;
  return { ico: Buffer.concat([head, data]), png: isPng ? Buffer.from(data) : null, size: best.w };
}

module.exports = { largestIcon };
