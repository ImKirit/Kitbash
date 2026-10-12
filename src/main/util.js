// Small shared helpers: hashing, safe paths, atomic JSON, version compare.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const chunk = Buffer.alloc(1024 * 1024);
    let n;
    while ((n = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) hash.update(chunk.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

// A relative path as used in the catalog: forward slashes, no dot segments,
// no drive letters. Returns the cleaned path or throws.
function cleanRel(rel) {
  if (typeof rel !== 'string' || rel.length === 0) throw new Error('empty path');
  if (rel.includes('\\') || rel.includes('\0') || rel.includes(':')) throw new Error('illegal path: ' + rel);
  if (rel.startsWith('/')) throw new Error('absolute path: ' + rel);
  const parts = rel.replace(/\/+$/, '').split('/');
  for (const p of parts) {
    if (p === '' || p === '.' || p === '..') throw new Error('unsafe path: ' + rel);
    if (/[<>"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p)) throw new Error('illegal path: ' + rel);
  }
  return parts.join('/');
}

// Joins base and a catalog-relative path and guarantees the result stays
// inside base.
function inside(base, rel) {
  const clean = cleanRel(rel);
  const root = path.resolve(base);
  const target = path.resolve(root, clean);
  const back = path.relative(root, target);
  if (back === '' || back.startsWith('..') || path.isAbsolute(back)) throw new Error('path escapes its folder: ' + rel);
  return target;
}

function topLevel(rel) {
  return rel.split('/')[0];
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// Write to a temp file in the same folder, then rename over the target.
function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(data, null, 2));
    try { fs.fsyncSync(fd); } catch { /* not every file system supports it */ }
  } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

function exists(p) {
  try { fs.lstatSync(p); return true; } catch { return false; }
}

function copyRecursive(src, dest) {
  const st = fs.lstatSync(src);
  if (st.isSymbolicLink()) return; // never follow links out of a game folder
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) copyRecursive(path.join(src, name), path.join(dest, name));
  } else if (st.isFile()) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function dirSize(p) {
  let total = 0;
  let st;
  try { st = fs.lstatSync(p); } catch { return 0; }
  if (st.isFile()) return st.size;
  if (!st.isDirectory()) return 0;
  for (const name of fs.readdirSync(p)) total += dirSize(path.join(p, name));
  return total;
}

// Removes a file or folder. Retries while Windows still holds a lock on a
// file of a process that has just ended.
function removeTree(p) {
  fs.rmSync(p, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}

function parseVersion(v) {
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(v || ''));
  if (!m) return null;
  return [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)];
}

// -1, 0, 1. Unparseable versions sort lowest.
function compareVersions(a, b) {
  const x = parseVersion(a) || [-1, 0, 0];
  const y = parseVersion(b) || [-1, 0, 0];
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  }
  return 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  sha256, sha256File, cleanRel, inside, topLevel, readJson, writeJsonAtomic,
  exists, copyRecursive, dirSize, removeTree, parseVersion, compareVersions, sleep,
};
