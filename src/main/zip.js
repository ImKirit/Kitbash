// Minimal zip reader and writer on top of zlib. No dependencies.
// The reader is strict on purpose: every entry name is validated before
// anything is written, so an archive can never place a file outside the
// folder it is extracted into.
'use strict';

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

const MAX_ENTRIES = 5000;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

class ZipError extends Error {
  constructor(message) { super(message); this.name = 'ZipError'; this.code = 'EZIP'; }
}

// Returns the entry name as a clean relative path with forward slashes,
// or throws. Directory entries keep no trailing slash.
function safeEntryPath(name) {
  if (typeof name !== 'string' || name.length === 0) throw new ZipError('empty entry name');
  if (name.length > 400) throw new ZipError('entry name too long');
  if (name.includes('\\')) throw new ZipError('backslash in entry name: ' + name);
  if (name.includes('\0')) throw new ZipError('NUL in entry name');
  if (name.startsWith('/')) throw new ZipError('absolute entry name: ' + name);
  if (/^[a-zA-Z]:/.test(name)) throw new ZipError('drive letter in entry name: ' + name);
  const trimmed = name.endsWith('/') ? name.slice(0, -1) : name;
  const parts = trimmed.split('/');
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..') throw new ZipError('unsafe path segment in: ' + name);
    if (/[<>:"|?*\x00-\x1f]/.test(part)) throw new ZipError('illegal character in: ' + name);
    if (/[. ]$/.test(part)) throw new ZipError('segment ends with dot or space in: ' + name);
    if (RESERVED.test(part)) throw new ZipError('reserved device name in: ' + name);
  }
  return parts.join('/');
}

function readZip(buf) {
  if (!Buffer.isBuffer(buf)) throw new ZipError('not a buffer');
  // End of central directory: scan backwards (comment may follow).
  let eocd = -1;
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipError('not a zip archive');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new ZipError('zip64 archives are not supported');
  if (count > MAX_ENTRIES) throw new ZipError('too many entries');
  if (cdOffset + cdSize > buf.length) throw new ZipError('central directory out of range');

  const entries = [];
  const seen = new Set();
  let total = 0;
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) throw new ZipError('bad central directory');
    const madeBy = buf.readUInt16LE(p + 4);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const extAttr = buf.readUInt32LE(p + 38);
    const offset = buf.readUInt32LE(p + 42);
    const rawName = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;

    if (flags & 0x1) throw new ZipError('encrypted entries are not supported');
    if (method !== 0 && method !== 8) throw new ZipError('unsupported compression method ' + method);
    if (compSize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) throw new ZipError('zip64 entry');
    // Unix symlink (made-by upper byte 3, mode 0120000)
    if ((madeBy >> 8) === 3 && ((extAttr >>> 16) & 0xf000) === 0xa000) throw new ZipError('symlink entry: ' + rawName);

    const isDir = rawName.endsWith('/');
    const name = safeEntryPath(rawName);
    const key = name.toLowerCase();
    if (seen.has(key)) throw new ZipError('duplicate entry: ' + name);
    seen.add(key);
    total += size;
    if (total > MAX_TOTAL_BYTES) throw new ZipError('archive too large when unpacked');
    entries.push({ name, isDir, method, crc, compSize, size, offset });
  }

  function read(entry) {
    if (entry.isDir) return Buffer.alloc(0);
    const o = entry.offset;
    if (o + 30 > buf.length || buf.readUInt32LE(o) !== SIG_LOCAL) throw new ZipError('bad local header: ' + entry.name);
    const nameLen = buf.readUInt16LE(o + 26);
    const extraLen = buf.readUInt16LE(o + 28);
    const start = o + 30 + nameLen + extraLen;
    const end = start + entry.compSize;
    if (end > buf.length) throw new ZipError('entry data out of range: ' + entry.name);
    const raw = buf.slice(start, end);
    let data;
    if (entry.method === 0) data = Buffer.from(raw);
    else data = zlib.inflateRawSync(raw, { maxOutputLength: entry.size + 1 });
    if (data.length !== entry.size) throw new ZipError('size mismatch: ' + entry.name);
    if ((zlib.crc32(data) >>> 0) !== entry.crc) throw new ZipError('checksum mismatch: ' + entry.name);
    return data;
  }

  return { entries, read };
}

// Extracts every entry below destDir. `filter(name)` may veto an entry by
// throwing. Returns the list of written files (relative, forward slashes).
function extractZip(buf, destDir, opts = {}) {
  const zip = readZip(buf);
  const base = path.resolve(destDir);
  const written = [];
  // Validate everything first, write afterwards.
  const plan = [];
  for (const entry of zip.entries) {
    if (opts.filter) opts.filter(entry.name, entry);
    const target = path.resolve(base, entry.name);
    const rel = path.relative(base, target);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) throw new ZipError('entry escapes target: ' + entry.name);
    plan.push({ entry, target });
  }
  for (const { entry, target } of plan) {
    if (entry.isDir) { fs.mkdirSync(target, { recursive: true }); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, zip.read(entry));
    written.push(entry.name);
  }
  return written;
}

function dosTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  const day = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time, day };
}

// files: [{ name, data }]. Output is deterministic: entries sorted by name,
// one fixed timestamp, so the same input always gives the same SHA256.
// `raw: true` skips name validation (used by tests to build hostile archives).
function writeZip(files, opts = {}) {
  const { time, day } = dosTime(opts.date || new Date(Date.UTC(2020, 0, 1)));
  const list = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of list) {
    if (!opts.raw) safeEntryPath(f.name);
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = zlib.crc32(data) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(useDeflate ? 8 : 0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(list.length, 8);
  eocd.writeUInt16LE(list.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

module.exports = { readZip, extractZip, writeZip, safeEntryPath, ZipError };
