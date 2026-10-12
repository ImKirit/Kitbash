// All catalog sources together: the built-in official one and the ones a
// user added. Merges them into one list of games and mods, keeps the ids of
// different sources apart and tracks which packages are on disk.
//
// Rules that hold for every unofficial source:
//   * its mod ids are namespaced ("modid@sourceid"), so it can never replace
//     or shadow a mod of the official source
//   * a game it defines under an id the official source uses is ignored, the
//     official definition stays
//   * its "loaders" section is ignored, loaders only come from the list
//     built into the launcher
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Catalog, CatalogError, parseSource, normalizeSourceUrl, DEFAULT_SOURCE } = require('./catalog');
const { BUILTIN_LOADERS, loaderType } = require('./loaders');
const { httpsGet } = require('./download');
const { sha256, sha256File, readJson, writeJsonAtomic, exists, removeTree, dirSize } = require('./util');

const OFFICIAL = 'official';

// A short, file system safe id for a source address.
function sourceIdFor(url) {
  const src = parseSource(url);
  let label;
  if (src.github) label = `${src.github.owner}-${src.github.repo}`;
  else if (src.kind === 'url') label = src.host;
  else label = path.basename(src.base);
  label = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'source';
  const hash = crypto.createHash('sha1').update(src.id.toLowerCase()).digest('hex').slice(0, 6);
  return `${label}-${hash}`;
}

function sourceLabel(url) {
  try {
    const src = parseSource(url);
    if (src.github) return `${src.github.owner}/${src.github.repo}`;
    return src.kind === 'url' ? src.host : src.base;
  } catch { return String(url); }
}

class Sources {
  // opts: { dataDir, officialUrl, list: [{ id, url, name, confirmedDownload }], fetch }
  constructor(opts) {
    this.dataDir = path.resolve(opts.dataDir);
    this.fetch = opts.fetch || httpsGet;
    this.officialUrl = opts.officialUrl || DEFAULT_SOURCE;
    this.list = (opts.list || []).map((s) => ({ ...s }));
    this.downloadsFile = path.join(this.dataDir, 'downloads.json');
    this.state = new Map(); // id -> { catalog, fetchedAt, error, offline }
    this._catalogs = new Map();
  }

  entries() {
    return [{ id: OFFICIAL, url: this.officialUrl, name: 'ImKirit', official: true }, ...this.list.map((s) => ({ ...s, official: false }))];
  }

  entry(id) { return this.entries().find((s) => s.id === id) || null; }

  catalogFor(id) {
    const e = this.entry(id);
    if (!e) return null;
    const key = id + '|' + e.url;
    if (!this._catalogs.has(key)) {
      this._catalogs.set(key, new Catalog({
        dataDir: this.dataDir, id, source: e.url, fetch: this.fetch,
        // an unofficial catalog may refer to games of the official one
        outside: () => (id === OFFICIAL ? {} : { games: this._officialGames() }),
      }));
    }
    return this._catalogs.get(key);
  }

  _officialGames() {
    const st = this.state.get(OFFICIAL);
    return st && st.catalog ? st.catalog.games.map((g) => [g.id, g]) : [];
  }

  // ---- managing sources ----------------------------------------------------
  // Validates an address a user typed and returns the entry it would become.
  // Nothing is stored. Throws CatalogError.
  prepareAdd(input) {
    const url = normalizeSourceUrl(input);
    const src = parseSource(url);
    if (src.kind === 'url' && src.id.toLowerCase() === parseSource(this.officialUrl).id.toLowerCase()) {
      throw new CatalogError('source-duplicate', 'This is the official source, it is already built in.');
    }
    const id = sourceIdFor(url);
    if (this.list.some((s) => s.id === id)) throw new CatalogError('source-duplicate', 'This source has already been added.');
    return { id, url: src.kind === 'url' ? src.id : src.base, name: sourceLabel(url), confirmedDownload: false, addedAt: new Date().toISOString() };
  }

  // `accepted` must be true: the caller has shown the warning and the user agreed.
  add(input, accepted) {
    if (accepted !== true) throw new CatalogError('warning-not-accepted', 'The warning has to be accepted first.');
    const entry = this.prepareAdd(input);
    this.list.push(entry);
    return entry;
  }

  // Removes a source together with its cached catalog, packages and images.
  remove(id) {
    if (id === OFFICIAL) throw new CatalogError('source-official', 'The official source cannot be removed.');
    const at = this.list.findIndex((s) => s.id === id);
    if (at < 0) return false;
    const cat = this.catalogFor(id);
    this.list.splice(at, 1);
    this.state.delete(id);
    removeTree(cat.packageDir);
    removeTree(cat.imageDir);
    fs.rmSync(cat.cacheFile, { force: true });
    const dl = this._downloads();
    for (const uid of Object.keys(dl)) if (dl[uid].source === id) delete dl[uid];
    writeJsonAtomic(this.downloadsFile, dl);
    return true;
  }

  // ---- loading -------------------------------------------------------------
  loadCached() {
    for (const e of this.entries()) {
      const cat = this.catalogFor(e.id);
      const c = cat.cached();
      if (c) this.state.set(e.id, { catalog: c.catalog, fetchedAt: c.fetchedAt, error: null, offline: true });
    }
  }

  // Refreshes every source, the official one first. A source that cannot be
  // reached keeps its cached copy and is flagged offline.
  async refresh() {
    for (const e of this.entries()) {
      const cat = this.catalogFor(e.id);
      try {
        const r = await cat.refresh();
        this.state.set(e.id, { catalog: r.catalog, fetchedAt: r.fetchedAt, error: null, offline: false });
      } catch (err) {
        const prev = this.state.get(e.id) || cat.cached();
        this.state.set(e.id, {
          catalog: prev ? prev.catalog : null, fetchedAt: prev ? prev.fetchedAt : null,
          error: { code: err.code || 'error', message: err.message }, offline: true,
        });
      }
    }
    return this.merged();
  }

  // ---- the merged view -----------------------------------------------------
  // { games, mods, loaders, sources }. Every mod carries
  //   id       unique across sources ("modid" or "modid@sourceid")
  //   localId  the id inside its own catalog
  //   source   { id, name, official }
  merged() {
    const loaders = {};
    for (const [id, l] of Object.entries(BUILTIN_LOADERS)) loaders[id] = { id, ...l };
    const games = [];
    const mods = [];
    const gameIds = new Set();
    const sources = [];

    for (const e of this.entries()) {
      const st = this.state.get(e.id) || { catalog: null, fetchedAt: null, error: null, offline: true };
      const tag = { id: e.id, name: e.name, official: e.official };
      const info = { ...tag, url: e.url, fetchedAt: st.fetchedAt, error: st.error, offline: !!st.offline, mods: 0, skipped: [], confirmedDownload: !!e.confirmedDownload };
      sources.push(info);
      if (!st.catalog) continue;
      const suffix = e.official ? '' : '@' + e.id;

      // the official catalog may bring loader builds the launcher does not
      // know yet, but only from the official download location of that loader
      if (e.official) {
        for (const [id, l] of Object.entries(st.catalog.loaders || {})) {
          const type = loaderType(l.type);
          if (!loaders[id] && type && type.downloadPrefixes.some((p) => String(l.url).startsWith(p))) loaders[id] = { id, ...l };
        }
      }

      const localGames = new Map();
      for (const g of st.catalog.games) {
        if (e.official) { games.push({ ...g, source: tag }); gameIds.add(g.id); continue; }
        if (gameIds.has(g.id)) { continue; } // official definition wins, silently
        const gid = g.id + suffix;
        localGames.set(g.id, gid);
        games.push({ ...g, id: gid, localId: g.id, source: tag });
      }

      for (const m of st.catalog.mods) {
        const game = localGames.get(m.game) || m.game;
        if (!games.some((g) => g.id === game)) { info.skipped.push({ id: m.id, why: 'unknown game' }); continue; }
        if (!loaders[m.loader]) { info.skipped.push({ id: m.id, why: 'loader not supported by this launcher' }); continue; }
        const conflicts = [];
        for (const c of m.conflicts || []) { conflicts.push(c); if (suffix) conflicts.push(c + suffix); }
        mods.push({ ...m, id: m.id + suffix, localId: m.id, game, conflicts, source: tag, catalogUpdated: st.catalog.updated || '' });
        info.mods++;
      }
    }
    return { games, mods, loaders, sources };
  }

  // ---- downloads -----------------------------------------------------------
  _downloads() { return readJson(this.downloadsFile, {}) || {}; }

  // state: 'none' | 'ready' | 'update' (an older build is on disk)
  downloadState(mod) {
    const cat = this.catalogFor(mod.source.id);
    if (cat && cat.hasPackage(mod.package)) return { state: 'ready', version: mod.version, size: mod.package.size };
    const rec = this._downloads()[mod.id];
    if (rec && cat && exists(cat.packagePath(rec.sha256))) return { state: 'update', version: rec.version, size: rec.size };
    return { state: 'none', version: null, size: mod.package.size };
  }

  // Unofficial sources need one explicit confirmation before their first download.
  needsConfirmation(mod) {
    if (mod.source.official) return false;
    const e = this.entry(mod.source.id);
    return !e || !e.confirmedDownload;
  }

  confirmSource(id) {
    const e = this.list.find((s) => s.id === id);
    if (e) e.confirmedDownload = true;
  }

  // Makes sure the package is on disk and verified. Returns its path.
  async ensurePackage(mod, onProgress) {
    const cat = this.catalogFor(mod.source.id);
    if (!cat) throw new CatalogError('source-unknown', `The source of ${mod.id} is not configured any more.`);
    if (!cat.hasPackage(mod.package) && this.needsConfirmation(mod)) {
      throw new CatalogError('confirmation-needed', `Downloads from ${mod.source.name} have not been confirmed.`, { source: mod.source.id });
    }
    const file = await cat.packageFile({ ...mod, id: mod.localId || mod.id }, onProgress);
    const dl = this._downloads();
    const old = dl[mod.id];
    if (old && old.sha256 !== mod.package.sha256) fs.rmSync(cat.packagePath(old.sha256), { force: true });
    dl[mod.id] = { source: mod.source.id, version: mod.version, sha256: mod.package.sha256, size: mod.package.size, at: new Date().toISOString() };
    writeJsonAtomic(this.downloadsFile, dl);
    return file;
  }

  // Everything that is on disk: [{ id, source, version, size, at }].
  library() {
    const dl = this._downloads();
    const out = [];
    for (const [id, rec] of Object.entries(dl)) {
      const cat = this.catalogFor(rec.source);
      if (cat && exists(cat.packagePath(rec.sha256))) out.push({ id, ...rec });
    }
    return out;
  }

  deletePackage(uid) {
    const dl = this._downloads();
    const rec = dl[uid];
    if (!rec) return false;
    const cat = this.catalogFor(rec.source);
    if (cat) fs.rmSync(cat.packagePath(rec.sha256), { force: true });
    delete dl[uid];
    writeJsonAtomic(this.downloadsFile, dl);
    return true;
  }

  // The loader archive, from the address built into the launcher, verified.
  async loaderFile(loader, onProgress) {
    const known = this.merged().loaders[loader.id];
    if (!known || known.sha256 !== loader.sha256 || known.url !== loader.url) {
      throw new CatalogError('loader-unknown', `Loader ${loader.id} is not one this launcher installs.`);
    }
    const type = loaderType(known.type);
    if (!type || !type.downloadPrefixes.some((p) => known.url.startsWith(p))) {
      throw new CatalogError('source-invalid', 'The loader download is not at its official location.');
    }
    const dir = path.join(this.dataDir, 'cache', 'loaders');
    const file = path.join(dir, known.sha256 + '.zip');
    if (exists(file) && sha256File(file) === known.sha256) return file;
    let buf;
    try { buf = await this.fetch(known.url, { maxBytes: known.size + 1024, redirectHosts: type.redirectHosts, onProgress: onProgress ? (g) => onProgress(g, known.size) : undefined }); }
    catch (e) { throw new CatalogError('source-unreachable', `Could not download ${known.name}: ${e.message}`); }
    if (buf.length !== known.size || sha256(buf) !== known.sha256) {
      throw new CatalogError('hash-mismatch', `The ${known.name} download does not match its SHA256.`, { what: known.name });
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file + '.part', buf);
    fs.renameSync(file + '.part', file);
    return file;
  }

  async imageFile(mod, rel) {
    const cat = this.catalogFor(mod.source.id);
    return cat ? cat.imageFile(rel, mod.catalogUpdated) : null;
  }

  cacheBytes() { return dirSize(path.join(this.dataDir, 'cache')); }
}

module.exports = { Sources, OFFICIAL, sourceIdFor, sourceLabel };
