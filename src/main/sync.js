// What follows a signed-in user from PC to PC: modpacks, favourites, a few
// settings and the session history. merge() is pure and decides how a local
// copy and the account copy come together.
'use strict';

const SYNCED_SETTINGS = ['lang', 'theme', 'overlay', 'overlayHotkey', 'overlayOpacity'];
const MAX_HISTORY = 200;
const MAX_PACKS = 300;

const time = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : 0; };

// doc: { packs: [], favorites: [], settings: { values, updatedAt }, history: [], deleted: { packs: [] }, updatedAt }
function empty() {
  return { packs: [], favorites: [], settings: { values: {}, updatedAt: null }, history: [], deleted: { packs: [] }, updatedAt: null };
}

function normalize(doc) {
  const d = { ...empty(), ...(doc && typeof doc === 'object' ? doc : {}) };
  d.packs = Array.isArray(d.packs) ? d.packs.filter((p) => p && typeof p.id === 'string') : [];
  d.favorites = Array.isArray(d.favorites) ? d.favorites.filter((f) => typeof f === 'string') : [];
  d.history = Array.isArray(d.history) ? d.history.filter((h) => h && typeof h.id === 'string') : [];
  d.settings = d.settings && typeof d.settings === 'object' ? { values: { ...(d.settings.values || {}) }, updatedAt: d.settings.updatedAt || null } : { values: {}, updatedAt: null };
  d.deleted = { packs: Array.isArray(d.deleted && d.deleted.packs) ? d.deleted.packs.filter((x) => x && x.id) : [] };
  return d;
}

// Combines two copies. Nothing is lost by accident:
//   packs      union by id, the newer updatedAt wins, a deletion wins only if newer than the pack
//   favourites union
//   settings   the copy that was changed last wins as a whole
//   history    union by id, newest first, at most 200
function merge(localDoc, remoteDoc) {
  const a = normalize(localDoc);
  const b = normalize(remoteDoc);
  const deleted = new Map();
  for (const x of [...a.deleted.packs, ...b.deleted.packs]) {
    if (!deleted.has(x.id) || time(x.at) > time(deleted.get(x.id).at)) deleted.set(x.id, x);
  }
  const packs = new Map();
  for (const p of [...a.packs, ...b.packs]) {
    const prev = packs.get(p.id);
    if (!prev || time(p.updatedAt) > time(prev.updatedAt)) packs.set(p.id, p);
  }
  for (const [id, del] of deleted) {
    const p = packs.get(id);
    if (p && time(del.at) >= time(p.updatedAt)) packs.delete(id);
  }
  const history = new Map();
  for (const h of [...a.history, ...b.history]) if (!history.has(h.id)) history.set(h.id, h);
  const settings = time(b.settings.updatedAt) > time(a.settings.updatedAt) ? b.settings : a.settings;
  return {
    packs: [...packs.values()].slice(0, MAX_PACKS),
    favorites: [...new Set([...a.favorites, ...b.favorites])],
    settings: { values: pick(settings.values), updatedAt: settings.updatedAt },
    history: [...history.values()].sort((x, y) => time(y.startedAt) - time(x.startedAt)).slice(0, MAX_HISTORY),
    deleted: { packs: [...deleted.values()].filter((x) => Date.now() - time(x.at) < 90 * 24 * 3600 * 1000) },
    updatedAt: new Date().toISOString(),
  };
}

function pick(values) {
  const out = {};
  for (const k of SYNCED_SETTINGS) if (values && k in values) out[k] = values[k];
  return out;
}

module.exports = { merge, normalize, empty, pick, SYNCED_SETTINGS, MAX_HISTORY };
