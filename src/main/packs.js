// Modpacks: a named set of mods for one game. A pack only refers to mods, it
// owns no files. Mod data stays per mod, whatever pack a mod was started from.
//
// A pack can be handed to a friend as a short text code. The code lists the
// game, the mods with their versions and the unofficial sources they come
// from. Importing a code never adds a source by itself.
'use strict';

const path = require('path');
const brand = require('../brand');
const { readJson, writeJsonAtomic, compareVersions } = require('./util');
const { OFFICIAL } = require('./sources');

const MAX_MODS = 60;
const ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
const UID = /^[a-z0-9][a-z0-9-]{1,39}(@[a-z0-9][a-z0-9-]{1,39})?$/;
const cleanName = (n) => String(n || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60);

class PackError extends Error {
  constructor(code, message) { super(message); this.name = 'PackError'; this.code = code; }
}

class Packs {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'packs.json');
    const raw = readJson(this.file, []);
    this.list = Array.isArray(raw) ? raw.filter((p) => p && typeof p.id === 'string' && Array.isArray(p.mods)) : [];
  }
  _save() { writeJsonAtomic(this.file, this.list); }
  all() { return JSON.parse(JSON.stringify(this.list)); }
  get(id) { return this.list.find((p) => p.id === id) || null; }

  // pack: { id?, name, gameId, mods: [{ id, version }] }
  save(pack) {
    const name = cleanName(pack.name);
    if (!name) throw new PackError('pack-name', 'A pack needs a name.');
    if (typeof pack.gameId !== 'string' || !UID.test(pack.gameId)) throw new PackError('pack-game', 'A pack belongs to one game.');
    const seen = new Set();
    const mods = [];
    for (const m of pack.mods || []) {
      if (!m || !UID.test(m.id || '') || seen.has(m.id)) continue;
      seen.add(m.id);
      mods.push({ id: m.id, version: String(m.version || '').slice(0, 20) });
    }
    if (mods.length > MAX_MODS) throw new PackError('pack-size', 'Too many mods in one pack.');
    const now = new Date().toISOString();
    let target = pack.id ? this.get(pack.id) : null;
    if (target) Object.assign(target, { name, mods, updatedAt: now });
    else {
      target = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, gameId: pack.gameId, mods, createdAt: now, updatedAt: now };
      this.list.push(target);
    }
    this._save();
    return JSON.parse(JSON.stringify(target));
  }

  // Replaces the whole list (after a sync).
  replaceAll(list) { this.list = list.filter((p) => p && typeof p.id === 'string' && Array.isArray(p.mods)); this._save(); }

  played(id) { const p = this.get(id); if (p) { p.lastPlayed = new Date().toISOString(); this._save(); } }

  remove(id) {
    const n = this.list.length;
    this.list = this.list.filter((p) => p.id !== id);
    this._save();
    return this.list.length !== n;
  }
}

// What a pack means against the catalogs as they are now.
// Returns { game, mods, missing: [id], changed: [{ id, packed, current }] }.
function resolvePack(pack, merged) {
  const game = merged.games.find((g) => g.id === pack.gameId) || null;
  const mods = [];
  const missing = [];
  const changed = [];
  for (const ref of pack.mods) {
    const mod = merged.mods.find((m) => m.id === ref.id && m.game === pack.gameId);
    if (!mod) { missing.push(ref.id); continue; }
    mods.push(mod);
    if (ref.version && compareVersions(ref.version, mod.version) !== 0) changed.push({ id: ref.id, packed: ref.version, current: mod.version });
  }
  return { game, mods, missing, changed };
}

// Text code for sharing. Lists sources by address, mods by their own id.
function exportPack(pack, merged) {
  const sources = {};
  const mods = [];
  for (const ref of pack.mods) {
    const [local, sid] = ref.id.split('@');
    const src = sid ? merged.sources.find((s) => s.id === sid) : null;
    if (sid && !src) continue; // the source is gone, the mod cannot be described
    if (sid) sources[sid] = src.url;
    mods.push({ id: local, source: sid || OFFICIAL, version: ref.version || '' });
  }
  const [gameLocal, gameSid] = pack.gameId.split('@');
  if (gameSid) { const s = merged.sources.find((x) => x.id === gameSid); if (s) sources[gameSid] = s.url; }
  const body = {
    v: 1, name: pack.name, game: gameLocal, gameSource: gameSid || OFFICIAL,
    sources: Object.entries(sources).map(([id, url]) => ({ id, url })), mods,
  };
  return brand.packPrefix + Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
}

// Parses a code. Returns { pack: { name, gameId, mods }, sources: [{ id, url }] }.
// `sources` are the unofficial sources the pack needs. The caller decides,
// together with the user, whether to add the ones that are not set up yet.
function importPack(code) {
  const text = String(code || '').trim().replace(/\s+/g, '');
  if (!text.startsWith(brand.packPrefix)) throw new PackError('pack-code', 'This is not a modpack code.');
  if (text.length > 20000) throw new PackError('pack-code', 'The code is too long.');
  let body;
  try { body = JSON.parse(Buffer.from(text.slice(brand.packPrefix.length), 'base64url').toString('utf8')); }
  catch { throw new PackError('pack-code', 'The code is damaged.'); }
  if (!body || body.v !== 1 || !Array.isArray(body.mods) || !ID.test(body.game || '')) throw new PackError('pack-code', 'The code is damaged.');
  const sid = (s) => (s === OFFICIAL || s === undefined ? '' : (ID.test(s) ? '@' + s : null));
  const sources = [];
  for (const s of Array.isArray(body.sources) ? body.sources.slice(0, 20) : []) {
    if (s && ID.test(s.id || '') && typeof s.url === 'string' && /^https:\/\//i.test(s.url) && s.url.length < 500) sources.push({ id: s.id, url: s.url });
  }
  const gs = sid(body.gameSource);
  if (gs === null) throw new PackError('pack-code', 'The code is damaged.');
  const mods = [];
  for (const m of body.mods.slice(0, MAX_MODS)) {
    const suffix = m ? sid(m.source) : null;
    if (suffix === null || !ID.test(m.id || '')) continue;
    mods.push({ id: m.id + suffix, version: String(m.version || '').slice(0, 20) });
  }
  return { pack: { name: cleanName(body.name) || 'Modpack', gameId: body.game + gs, mods }, sources };
}

module.exports = { Packs, PackError, resolvePack, exportPack, importPack };
