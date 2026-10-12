// One catalog source: an https URL or a local folder. Reads the catalog,
// keeps a copy for offline use and hands out verified files from it.
//
// Where a file may come from is decided here, never by the catalog alone:
//   images    relative paths inside the catalog only
//   packages  relative paths, or https on the catalog's own host, or on
//             GitHub inside the very repository the catalog lives in
//   loaders   never from a catalog source at all (see loaders.js, sources.js)
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const brand = require('../brand');
const { validateCatalog } = require('./schema');
const { httpsGet } = require('./download');
const { sha256, sha256File, inside, cleanRel, readJson, writeJsonAtomic, exists } = require('./util');

const DEFAULT_SOURCE = brand.officialCatalogUrl;
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 200 * 1024 * 1024;
const GITHUB_ASSET_HOSTS = ['objects.githubusercontent.com', 'release-assets.githubusercontent.com'];

class CatalogError extends Error {
  constructor(code, message, extra) { super(message); this.name = 'CatalogError'; this.code = code; Object.assign(this, extra || {}); }
}

// Accepts what people paste: a GitHub repository address, a link to a
// catalog.json on GitHub, or a raw https URL. Returns the catalog URL.
function normalizeSourceUrl(input) {
  const s = String(input || '').trim();
  if (!/^https:\/\//i.test(s)) return s;
  let u;
  try { u = new URL(s); } catch { return s; }
  if (u.hostname.toLowerCase() === 'github.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const owner = parts[0];
      const repo = parts[1].replace(/\.git$/i, '');
      if (parts[2] === 'blob' && parts.length > 4) return `https://raw.githubusercontent.com/${owner}/${repo}/${parts.slice(3).join('/')}`;
      return `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/catalog.json`;
    }
  }
  return s;
}

// { kind: 'url' | 'dir', base, file, id, host?, github?: { owner, repo } }
function parseSource(source) {
  const s = String(source || '').trim();
  if (!s) throw new CatalogError('source-invalid', 'No catalog source set.');
  if (/^https:\/\//i.test(s)) {
    let u;
    try { u = new URL(s); } catch { throw new CatalogError('source-invalid', 'Not a valid address.'); }
    if (u.username || u.password || u.search || u.hash) throw new CatalogError('source-invalid', 'The catalog URL must be a plain https address.');
    if (!u.pathname.endsWith('.json')) throw new CatalogError('source-invalid', 'The catalog URL must point at a .json file.');
    const cut = u.href.lastIndexOf('/');
    const out = { kind: 'url', base: u.href.slice(0, cut + 1), file: u.href.slice(cut + 1), id: u.href, host: u.hostname.toLowerCase() };
    if (out.host === 'raw.githubusercontent.com') {
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length >= 3) out.github = { owner: parts[0], repo: parts[1] };
    }
    return out;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) throw new CatalogError('source-invalid', 'Only https addresses and local folders can be a catalog source.');
  const abs = path.resolve(s);
  let st;
  try { st = fs.statSync(abs); } catch { throw new CatalogError('source-missing', `Catalog not found: ${abs}`); }
  if (st.isDirectory()) return { kind: 'dir', base: abs, file: 'catalog.json', id: abs };
  return { kind: 'dir', base: path.dirname(abs), file: path.basename(abs), id: abs };
}

// Decides whether a package address is acceptable for a catalog source.
// Returns { url, redirectHosts } for a download or { file } for a local
// catalog. Throws CatalogError('url-not-allowed').
function resolvePackageUrl(src, url) {
  const deny = (why) => { throw new CatalogError('url-not-allowed', `Package address refused: ${why}`); };
  if (typeof url !== 'string' || !url) deny('empty');
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    const clean = cleanRel(url);
    if (src.kind === 'dir') return { file: inside(src.base, clean) };
    const full = new URL(clean.split('/').map(encodeURIComponent).join('/'), src.base).href;
    if (!full.startsWith(src.base)) deny('leaves the catalog');
    return { url: full, redirectHosts: [] };
  }
  let u;
  try { u = new URL(url); } catch { deny('not a URL'); }
  if (u.protocol !== 'https:') deny('only https is allowed');
  if (u.username || u.password) deny('credentials in the address');
  if (src.kind !== 'url') deny('a local catalog can only use relative paths');
  const host = u.hostname.toLowerCase();
  if (src.github) {
    const prefix = `/${src.github.owner}/${src.github.repo}/`.toLowerCase();
    const inRepo = u.pathname.toLowerCase().startsWith(prefix);
    if (host === 'raw.githubusercontent.com' && inRepo) return { url: u.href, redirectHosts: [] };
    if (host === 'github.com' && inRepo) return { url: u.href, redirectHosts: GITHUB_ASSET_HOSTS };
    deny(`${host}${u.pathname} is not inside the repository ${src.github.owner}/${src.github.repo}`);
  }
  if (host === src.host) return { url: u.href, redirectHosts: [] };
  deny(`${host} is not the host of the catalog (${src.host})`);
  return null;
}

class Catalog {
  // opts: { dataDir, id, source, fetch, outside() -> { games, loaders } }
  constructor(opts) {
    this.dataDir = path.resolve(opts.dataDir);
    this.id = opts.id || 'official';
    this.source = opts.source || DEFAULT_SOURCE;
    this.fetch = opts.fetch || httpsGet;
    this.outside = opts.outside || (() => ({}));
    this.cacheFile = path.join(this.dataDir, 'catalogs', this.id + '.json');
    this.cacheDir = path.join(this.dataDir, 'cache');
    this.packageDir = path.join(this.cacheDir, 'mods', this.id);
    this.imageDir = path.join(this.cacheDir, 'images', this.id);
  }

  // The last good copy, but only if it came from the source in use now.
  cached() {
    const c = readJson(this.cacheFile, null);
    if (!c || c.source !== this.source || !c.catalog) return null;
    if (validateCatalog(c.catalog, this.outside()).length) return null;
    return { catalog: c.catalog, fetchedAt: c.fetchedAt };
  }

  // Fetches, validates and caches the catalog. Throws CatalogError.
  async refresh() {
    const src = parseSource(this.source);
    let raw;
    if (src.kind === 'url') {
      try { raw = await this.fetch(src.base + src.file, { maxBytes: MAX_CATALOG_BYTES, redirectHosts: [] }); }
      catch (e) { throw new CatalogError('source-unreachable', e.message, { status: e.status || 0 }); }
    } else {
      try { raw = fs.readFileSync(path.join(src.base, src.file)); }
      catch { throw new CatalogError('source-missing', `Catalog not found: ${path.join(src.base, src.file)}`); }
      if (raw.length > MAX_CATALOG_BYTES) throw new CatalogError('catalog-invalid', 'The catalog file is too large.');
    }
    let catalog;
    try { catalog = JSON.parse(raw.toString('utf8').replace(/^﻿/, '')); }
    catch { throw new CatalogError('catalog-invalid', 'The catalog is not valid JSON.'); }
    const errors = validateCatalog(catalog, this.outside());
    if (errors.length) throw new CatalogError('catalog-invalid', errors[0], { errors });
    for (const mod of catalog.mods) {
      try { resolvePackageUrl(src, mod.package.url); }
      catch (e) { throw new CatalogError('catalog-invalid', `mods (${mod.id}): ${e.message}`); }
    }
    const fetchedAt = new Date().toISOString();
    writeJsonAtomic(this.cacheFile, { source: this.source, fetchedAt, catalog });
    return { catalog, fetchedAt };
  }

  _store(dir, name, buf) {
    const file = path.join(dir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file + '.part', buf);
    fs.renameSync(file + '.part', file);
    return file;
  }

  packagePath(sha) { return path.join(this.packageDir, sha + '.zip'); }

  // Cheap check for the mod list: is the package of this exact build on disk?
  hasPackage(pkg) {
    try { return fs.statSync(this.packagePath(pkg.sha256)).size === pkg.size; } catch { return false; }
  }

  // The package of a mod as a local file whose SHA256 matches the catalog.
  // Downloads it when it is not in the cache yet.
  async packageFile(mod, onProgress) {
    const want = mod.package.sha256;
    const file = this.packagePath(want);
    if (exists(file) && sha256File(file) === want) return file;
    const src = parseSource(this.source);
    const where = resolvePackageUrl(src, mod.package.url);
    let buf;
    if (where.file) buf = fs.readFileSync(where.file);
    else {
      try {
        buf = await this.fetch(where.url, {
          maxBytes: Math.min(MAX_PACKAGE_BYTES, mod.package.size + 1024),
          redirectHosts: where.redirectHosts,
          onProgress: onProgress ? (got) => onProgress(got, mod.package.size) : undefined,
        });
      } catch (e) { throw new CatalogError('source-unreachable', `Could not download ${mod.id}: ${e.message}`); }
    }
    if (buf.length !== mod.package.size || sha256(buf) !== want) {
      throw new CatalogError('hash-mismatch', `The package of ${mod.id} does not match the catalog.`, { what: mod.id });
    }
    return this._store(this.packageDir, want + '.zip', buf);
  }

  // An image as a local file, or null when it cannot be had right now.
  async imageFile(rel, stamp) {
    let clean;
    try { clean = cleanRel(rel); } catch { return null; }
    const ext = path.extname(clean).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) return null;
    const key = crypto.createHash('sha1').update(clean + '|' + (stamp || '')).digest('hex');
    const file = path.join(this.imageDir, key + ext);
    if (exists(file)) return file;
    try {
      const src = parseSource(this.source);
      let buf;
      if (src.kind === 'dir') {
        const from = inside(src.base, clean);
        if (fs.statSync(from).size > MAX_IMAGE_BYTES) return null;
        buf = fs.readFileSync(from);
      } else {
        const url = new URL(clean.split('/').map(encodeURIComponent).join('/'), src.base).href;
        if (!url.startsWith(src.base)) return null;
        buf = await this.fetch(url, { maxBytes: MAX_IMAGE_BYTES, redirectHosts: [] });
      }
      return this._store(this.imageDir, key + ext, buf);
    } catch { return null; }
  }
}

module.exports = { Catalog, CatalogError, parseSource, normalizeSourceUrl, resolvePackageUrl, DEFAULT_SOURCE };
