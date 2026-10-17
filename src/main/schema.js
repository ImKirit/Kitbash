// Catalog format, version 1. Used by the launcher when it reads a catalog and
// by scripts/publish-mod.js before it writes one. Hand written checks, no
// dependencies. validateCatalog returns a list of problems (empty = valid).
'use strict';

const { cleanRel, parseVersion } = require('./util');
const { loaderType, underAny, ENGINES, BUILTIN_LOADERS } = require('./loaders');

const SCHEMA_VERSION = 1;

const ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
const SHA = /^[a-f0-9]{64}$/;
const GAME_STATUS = ['available', 'coming-later'];
const MOD_STATUS = ['stable', 'beta', 'experimental'];
const REQ_TYPES = ['steam-game', 'minecraft-java'];
const REQ_LEVELS = ['required', 'recommended'];
const NOTE_KINDS = ['multiplayer', 'privacy', 'testing', 'info'];
const IMAGE_EXT = /\.(png|jpg|jpeg|webp)$/i;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v, max = 4000) => typeof v === 'string' && v.length > 0 && v.length <= max;
const isInt = (v) => Number.isInteger(v) && v >= 0;

// Text is either a plain string or { en, de }. English is mandatory.
function checkText(v, where, errors, max = 4000) {
  if (isStr(v, max)) return;
  if (isObj(v) && isStr(v.en, max) && (v.de === undefined || isStr(v.de, max))) {
    for (const k of Object.keys(v)) if (k !== 'en' && k !== 'de') errors.push(`${where}: unknown language "${k}"`);
    return;
  }
  errors.push(`${where}: must be text or { en, de }`);
}

function checkRel(v, where, errors) {
  if (typeof v !== 'string') { errors.push(`${where}: must be a relative path`); return null; }
  try { return cleanRel(v); } catch (e) { errors.push(`${where}: ${e.message}`); return null; }
}

function checkLoader(id, l, errors) {
  const w = `loaders.${id}`;
  if (!ID.test(id)) errors.push(`${w}: bad id`);
  if (!isObj(l)) { errors.push(`${w}: must be an object`); return; }
  const type = loaderType(l.type);
  if (!type) { errors.push(`${w}.type: unknown loader type "${l.type}"`); }
  if (!isStr(l.name, 60)) errors.push(`${w}.name: missing`);
  if (!parseVersion(l.version)) errors.push(`${w}.version: missing`);
  if (!isStr(l.url, 500) || !/^https:\/\//.test(l.url)) errors.push(`${w}.url: must be an https URL`);
  else if (type && !type.downloadPrefixes.some((p) => l.url.startsWith(p))) {
    errors.push(`${w}.url: not an official download location for ${l.type}`);
  }
  if (!isInt(l.size) || l.size === 0) errors.push(`${w}.size: missing`);
  if (!SHA.test(l.sha256 || '')) errors.push(`${w}.sha256: must be 64 lowercase hex characters`);
}

function checkGame(g, i, errors) {
  const w = `games[${i}]${isObj(g) && g.id ? ` (${g.id})` : ''}`;
  if (!isObj(g)) { errors.push(`${w}: must be an object`); return; }
  if (!ID.test(g.id || '')) errors.push(`${w}.id: bad id`);
  if (!isStr(g.name, 80)) errors.push(`${w}.name: missing`);
  if (!GAME_STATUS.includes(g.status)) errors.push(`${w}.status: must be one of ${GAME_STATUS.join(', ')}`);
  if (g.tagline !== undefined) checkText(g.tagline, `${w}.tagline`, errors, 200);
  if (g.art !== undefined) {
    if (!isObj(g.art)) errors.push(`${w}.art: must be an object`);
    else if (g.art.image !== undefined) {
      const rel = checkRel(g.art.image, `${w}.art.image`, errors);
      if (rel && !IMAGE_EXT.test(rel)) errors.push(`${w}.art.image: must be png, jpg or webp`);
    }
  }
  if (g.status !== 'available') return;
  if (g.platform !== 'steam') errors.push(`${w}.platform: only "steam" is supported`);
  if (!isObj(g.steam) || !isInt(g.steam.appId) || g.steam.appId === 0) errors.push(`${w}.steam.appId: missing`);
  if (!isStr(g.executable, 120) || /[\\/:]/.test(g.executable) || !/\.exe$/i.test(g.executable)) {
    errors.push(`${w}.executable: must be an .exe file name in the game folder`);
  }
  if (!isStr(g.processName, 120) || /[\\/:]/.test(g.processName)) errors.push(`${w}.processName: missing`);
  if (!ENGINES.includes(g.engine)) errors.push(`${w}.engine: must be one of ${ENGINES.join(', ')}`);
  if (g.antiCheat !== false) errors.push(`${w}.antiCheat: must be false. Games with anti-cheat are not allowed in the catalog`);
}

function checkRequirement(r, w, errors) {
  if (!isObj(r)) { errors.push(`${w}: must be an object`); return; }
  if (!REQ_TYPES.includes(r.type)) { errors.push(`${w}.type: must be one of ${REQ_TYPES.join(', ')}`); return; }
  if (!REQ_LEVELS.includes(r.level)) errors.push(`${w}.level: must be required or recommended`);
  if (r.text !== undefined) checkText(r.text, `${w}.text`, errors, 400);
  if (r.type === 'steam-game') {
    if (!isInt(r.appId) || r.appId === 0) errors.push(`${w}.appId: missing`);
    if (!isStr(r.name, 80)) errors.push(`${w}.name: missing`);
  }
  if (r.type === 'minecraft-java' && r.minVersion !== undefined && !parseVersion(r.minVersion)) {
    errors.push(`${w}.minVersion: not a version`);
  }
}

function checkMod(m, i, ctx, errors) {
  const w = `mods[${i}]${isObj(m) && m.id ? ` (${m.id})` : ''}`;
  if (!isObj(m)) { errors.push(`${w}: must be an object`); return; }
  if (!ID.test(m.id || '')) errors.push(`${w}.id: bad id`);
  const game = ctx.games.get(m.game);
  if (!game) errors.push(`${w}.game: unknown game "${m.game}"`);
  else if (game.status !== 'available') errors.push(`${w}.game: game "${m.game}" is not available yet`);
  checkText(m.name, `${w}.name`, errors, 80);
  if (!parseVersion(m.version)) errors.push(`${w}.version: missing`);
  if (!isStr(m.author, 80)) errors.push(`${w}.author: missing`);
  if (!MOD_STATUS.includes(m.status)) errors.push(`${w}.status: must be one of ${MOD_STATUS.join(', ')}`);
  checkText(m.summary, `${w}.summary`, errors, 240);
  checkText(m.description, `${w}.description`, errors, 6000);
  if (m.released !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(m.released)) errors.push(`${w}.released: must be YYYY-MM-DD`);
  if (m.minLauncherVersion !== undefined && !parseVersion(m.minLauncherVersion)) errors.push(`${w}.minLauncherVersion: not a version`);

  const loader = ctx.loaders.get(m.loader);
  if (!loader) errors.push(`${w}.loader: unknown loader "${m.loader}"`);
  const type = loader ? loaderType(loader.type) : null;
  if (type && game && game.engine && !type.engines.includes(game.engine)) {
    errors.push(`${w}.loader: ${loader.type} does not support engine ${game.engine}`);
  }

  if (!isObj(m.package)) errors.push(`${w}.package: missing`);
  else {
    const rel = checkRel(m.package.url, `${w}.package.url`, errors);
    if (rel && !/\.zip$/i.test(rel)) errors.push(`${w}.package.url: must be a .zip inside the catalog`);
    if (!isInt(m.package.size) || m.package.size === 0) errors.push(`${w}.package.size: missing`);
    if (!SHA.test(m.package.sha256 || '')) errors.push(`${w}.package.sha256: must be 64 lowercase hex characters`);
  }

  const filePaths = [];
  if (!Array.isArray(m.files) || m.files.length === 0) errors.push(`${w}.files: must list at least one file`);
  else {
    m.files.forEach((f, k) => {
      const fw = `${w}.files[${k}]`;
      if (!isObj(f)) { errors.push(`${fw}: must be an object`); return; }
      const rel = checkRel(f.path, `${fw}.path`, errors);
      if (!isInt(f.size)) errors.push(`${fw}.size: missing`);
      if (!SHA.test(f.sha256 || '')) errors.push(`${fw}.sha256: must be 64 lowercase hex characters`);
      if (!rel) return;
      if (type && !underAny(rel, type.installRoots)) errors.push(`${fw}.path: ${rel} is outside the folders a ${loader.type} mod may install into`);
      if (filePaths.includes(rel.toLowerCase())) errors.push(`${fw}.path: listed twice`);
      filePaths.push(rel.toLowerCase());
    });
  }

  if (m.persist !== undefined) {
    if (!Array.isArray(m.persist)) errors.push(`${w}.persist: must be a list`);
    else m.persist.forEach((p, k) => {
      const rel = checkRel(p, `${w}.persist[${k}]`, errors);
      if (!rel) return;
      const low = rel.toLowerCase();
      if (type && !underAny(rel, type.persistRoots)) errors.push(`${w}.persist[${k}]: ${rel} is outside the folders mod data may live in`);
      for (const f of filePaths) {
        if (f === low || f.startsWith(low + '/') || low.startsWith(f + '/')) {
          errors.push(`${w}.persist[${k}]: overlaps the installed file ${f}`);
        }
      }
    });
  }

  if (m.requirements !== undefined) {
    if (!Array.isArray(m.requirements)) errors.push(`${w}.requirements: must be a list`);
    else m.requirements.forEach((r, k) => checkRequirement(r, `${w}.requirements[${k}]`, errors));
  }
  if (m.notes !== undefined) {
    if (!Array.isArray(m.notes)) errors.push(`${w}.notes: must be a list`);
    else m.notes.forEach((n, k) => {
      if (!isObj(n) || !NOTE_KINDS.includes(n.kind)) errors.push(`${w}.notes[${k}].kind: must be one of ${NOTE_KINDS.join(', ')}`);
      else checkText(n.text, `${w}.notes[${k}].text`, errors, 600);
    });
  }
  if (m.controls !== undefined) {
    if (!Array.isArray(m.controls)) errors.push(`${w}.controls: must be a list`);
    else m.controls.forEach((c, k) => {
      if (!isObj(c) || !isStr(c.key, 40)) errors.push(`${w}.controls[${k}].key: missing`);
      else checkText(c.text, `${w}.controls[${k}].text`, errors, 200);
    });
  }
  if (m.usage !== undefined) {
    if (!isObj(m.usage)) errors.push(`${w}.usage: must be an object with keys and steps`);
    else {
      if (m.usage.keys !== undefined) {
        if (!Array.isArray(m.usage.keys)) errors.push(`${w}.usage.keys: must be a list`);
        else m.usage.keys.forEach((k, j) => {
          if (!isObj(k) || !isStr(k.key, 40)) errors.push(`${w}.usage.keys[${j}].key: missing`);
          else checkText(k.text, `${w}.usage.keys[${j}].text`, errors, 300);
        });
      }
      if (m.usage.steps !== undefined) {
        if (!Array.isArray(m.usage.steps) || m.usage.steps.length > 20) errors.push(`${w}.usage.steps: must be a list of at most 20 steps`);
        else m.usage.steps.forEach((st, j) => checkText(st, `${w}.usage.steps[${j}]`, errors, 400));
      }
      for (const k of Object.keys(m.usage)) if (k !== 'keys' && k !== 'steps') errors.push(`${w}.usage: unknown field "${k}"`);
    }
  }
  if (m.images !== undefined) {
    if (!Array.isArray(m.images)) errors.push(`${w}.images: must be a list`);
    else m.images.forEach((img, k) => {
      const rel = checkRel(img, `${w}.images[${k}]`, errors);
      if (rel && !IMAGE_EXT.test(rel)) errors.push(`${w}.images[${k}]: must be png, jpg or webp`);
    });
  }
  if (m.conflicts !== undefined) {
    if (!Array.isArray(m.conflicts) || m.conflicts.some((c) => !ID.test(c || ''))) errors.push(`${w}.conflicts: must be a list of mod ids`);
  }
  if (m.thirdParty !== undefined) {
    if (!Array.isArray(m.thirdParty)) errors.push(`${w}.thirdParty: must be a list`);
    else m.thirdParty.forEach((t, k) => {
      if (!isObj(t) || !isStr(t.name, 120) || !isStr(t.license, 60)) errors.push(`${w}.thirdParty[${k}]: needs name and license`);
      else if (t.url !== undefined && !/^https:\/\//.test(t.url)) errors.push(`${w}.thirdParty[${k}].url: must be https`);
    });
  }
}

// outside: { games: Map, loaders: Map } known from elsewhere. A third-party
// catalog may add mods to a game of the official catalog without repeating it.
function validateCatalog(c, outside = {}) {
  const errors = [];
  if (!isObj(c)) return ['catalog: must be a JSON object'];
  if (c.schemaVersion !== SCHEMA_VERSION) {
    return [`catalog.schemaVersion: this launcher reads version ${SCHEMA_VERSION}, the catalog is version ${c.schemaVersion}`];
  }
  if (c.loaders !== undefined && !isObj(c.loaders)) errors.push('catalog.loaders: must be an object');
  if (!Array.isArray(c.games)) errors.push('catalog.games: must be a list');
  if (!Array.isArray(c.mods)) errors.push('catalog.mods: must be a list');
  if (errors.length) return errors;

  const ctx = { loaders: new Map(Object.entries(BUILTIN_LOADERS)), games: new Map(outside.games || []) };
  for (const [id, l] of (outside.loaders || [])) ctx.loaders.set(id, l);
  const ownGames = new Set();
  for (const [id, l] of Object.entries(c.loaders || {})) { checkLoader(id, l, errors); if (!ctx.loaders.has(id)) ctx.loaders.set(id, l); }
  c.games.forEach((g, i) => {
    checkGame(g, i, errors);
    if (isObj(g) && g.id) {
      if (ownGames.has(g.id)) errors.push(`games[${i}]: id "${g.id}" used twice`);
      ownGames.add(g.id);
      if (!ctx.games.has(g.id)) ctx.games.set(g.id, g);
    }
  });
  const modIds = new Set();
  c.mods.forEach((m, i) => {
    checkMod(m, i, ctx, errors);
    if (isObj(m) && m.id) {
      if (modIds.has(m.id)) errors.push(`mods[${i}]: id "${m.id}" used twice`);
      modIds.add(m.id);
    }
  });
  return errors;
}

// Picks the text for a language, falling back to English.
function text(v, lang) {
  if (typeof v === 'string') return v;
  if (isObj(v)) return v[lang] || v.en || '';
  return '';
}

module.exports = { SCHEMA_VERSION, validateCatalog, text, MOD_STATUS, NOTE_KINDS };
