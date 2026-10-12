// The install, persist and clean-up engine. Pure Node, no Electron, so the
// whole thing runs under the test runner against fake game folders.
//
// One session per game:
//
//   prepare()  journal written first, then foreign loader files are moved
//              aside, loader and mods are installed, mod data is put back
//   (game runs)
//   finish()   mod data is copied into the launcher's store, everything the
//              launcher installed is removed, what was moved aside comes back
//
// The journal is the only authority for removal. A path that is not claimed
// in the journal is never deleted. If the launcher dies at any point, the
// journal stays on disk and recover() finishes the job on the next start.
'use strict';

const fs = require('fs');
const path = require('path');
const { readZip } = require('./zip');
const { loaderType, underAny } = require('./loaders');
const {
  sha256, inside, topLevel, readJson, writeJsonAtomic, exists,
  copyRecursive, removeTree, compareVersions, dirSize,
} = require('./util');

const JOURNAL_VERSION = 1;
const ASIDE = require('../brand').asideName;

// Folders and files that mean a game ships anti-cheat. Such games are refused.
const ANTI_CHEAT_MARKERS = [
  'EasyAntiCheat', 'EasyAntiCheat_EOS', 'BattlEye', 'BEService.exe', 'BEService_x64.exe',
  'start_protected_game.exe', 'GameGuard', 'nProtect', 'anticheat', 'AntiCheat', 'vgk.sys',
  'PunkBuster', 'XignCode', 'equ8_conf.json', 'ACE-BASE.sys',
];

// Phases in which the mod data in the game folder is the truth and has to be
// saved back. Before "restored" the game folder holds nothing worth keeping,
// after "saved" the store is already up to date.
const SAVE_PHASES = ['restored', 'launched', 'exited'];

class EngineError extends Error {
  constructor(code, message, extra) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    Object.assign(this, extra || {});
  }
}

// Thrown by test hooks to simulate the launcher dying. Never caught for
// rollback, exactly like a real crash.
class CrashSignal extends Error {
  constructor(step) { super('simulated crash at ' + step); this.name = 'CrashSignal'; this.step = step; }
}

class Engine {
  // opts: { dataDir, isRunning(processName) -> Promise<bool>, launcherVersion, log(line), hook(step) }
  constructor(opts) {
    this.dataDir = path.resolve(opts.dataDir);
    this.isRunning = opts.isRunning;
    this.launcherVersion = opts.launcherVersion || '0.0.0';
    this.log = opts.log || (() => { });
    this.hook = opts.hook || (() => { });
    this.sessionsDir = path.join(this.dataDir, 'sessions');
    this.storeRoot = path.join(this.dataDir, 'store');
    this.logsDir = path.join(this.dataDir, 'logs');
  }

  // ---- paths ---------------------------------------------------------------
  journalFile(gameId) { return path.join(this.sessionsDir, gameId + '.json'); }
  storeDir(gameId, modId) { return path.join(this.storeRoot, gameId, modId); }

  readJournal(gameId) {
    const j = readJson(this.journalFile(gameId), null);
    if (!j || j.version !== JOURNAL_VERSION || j.gameId !== gameId) return null;
    return j;
  }

  pendingJournals() {
    let names = [];
    try { names = fs.readdirSync(this.sessionsDir); } catch { return []; }
    return names.filter((n) => n.endsWith('.json'))
      .map((n) => this.readJournal(n.slice(0, -5)))
      .filter(Boolean);
  }

  _write(journal) { writeJsonAtomic(this.journalFile(journal.gameId), journal); }

  _setPhase(journal, phase) {
    journal.phase = phase;
    this._write(journal);
    this.hook('phase:' + phase);
  }

  // ---- checks before anything is touched -----------------------------------
  // plan: { game, gameDir, loader, mods }. Returns a list of problems, each
  // { code, message }. Empty list = good to go.
  async preflight(plan) {
    const problems = [];
    const add = (code, message, extra) => problems.push({ code, message, ...extra });
    const { game, gameDir, loader, mods } = plan;
    const type = loader ? loaderType(loader.type) : null;

    if (!mods || mods.length === 0) add('no-mods', 'No mod selected.');
    if (game.status !== 'available') add('game-unavailable', `${game.name} is not available yet.`);
    if (game.antiCheat !== false) add('anti-cheat', `${game.name} uses anti-cheat. The launcher does not touch such games.`);
    if (!type) add('loader-unknown', 'This launcher does not know the loader these mods need.');
    else if (!type.engines.includes(game.engine)) add('engine-mismatch', `${loader.type} cannot be used with ${game.engine}.`);

    for (const mod of mods || []) {
      if (mod.game !== game.id) add('different-game', `${mod.id} belongs to another game.`, { mod: mod.id });
      if (loader && mod.loader !== loader.id) add('loader-mismatch', `${mod.id} needs a different loader than the other selected mods.`, { mod: mod.id });
      if (mod.minLauncherVersion && compareVersions(this.launcherVersion, mod.minLauncherVersion) < 0) {
        add('launcher-too-old', `${mod.id} needs launcher ${mod.minLauncherVersion} or newer.`, { mod: mod.id, needs: mod.minLauncherVersion });
      }
      for (const other of mods) {
        if (other.id !== mod.id && (mod.conflicts || []).includes(other.id)) {
          add('mod-conflict', `${mod.id} cannot be combined with ${other.id}.`, { mod: mod.id, other: other.id });
        }
      }
    }

    if (!gameDir || !exists(gameDir)) {
      add('game-missing', `${game.name} is not installed.`);
      return problems;
    }
    if (!exists(path.join(gameDir, game.executable))) add('exe-missing', `${game.executable} was not found in the game folder.`);
    for (const marker of ANTI_CHEAT_MARKERS) {
      if (exists(path.join(gameDir, marker))) { add('anti-cheat', `Found ${marker} in the game folder. The launcher does not touch games with anti-cheat.`); break; }
    }
    if (game.engine === 'unity-mono') {
      const dataDir = path.join(gameDir, game.executable.replace(/\.exe$/i, '') + '_Data');
      if (exists(path.join(gameDir, 'GameAssembly.dll')) || !exists(path.join(dataDir, 'Managed'))) {
        add('engine-mismatch', 'The installed game is not a Unity Mono build any more. The mods cannot load.');
      }
    }
    if (this.readJournal(game.id)) add('pending-session', 'An earlier session of this game has not been cleaned up yet.');
    else if (exists(path.join(gameDir, ASIDE))) {
      add('leftover-aside', `The game folder contains ${ASIDE} but the launcher has no record of it. Look into that folder before launching.`);
    }
    if (await this.isRunning(game.processName)) add('game-running', `${game.name} is already running. Close it first.`);
    return problems;
  }

  // ---- read and verify the archives (nothing on disk changes) --------------
  _loadArchives(plan, files) {
    const { loader, mods } = plan;
    const type = loaderType(loader.type);

    const loaderBuf = fs.readFileSync(files.loaderZip);
    if (sha256(loaderBuf) !== loader.sha256) throw new EngineError('hash-mismatch', `The ${loader.name} download does not match its SHA256.`, { what: loader.id });
    const loaderZip = readZip(loaderBuf);
    const allowedTop = new Set(type.topLevel.map((t) => t.toLowerCase()));
    for (const e of loaderZip.entries) {
      if (!allowedTop.has(topLevel(e.name).toLowerCase())) {
        throw new EngineError('loader-layout', `The loader archive contains an unexpected entry: ${e.name}`);
      }
    }

    const taken = new Map();
    const modArchives = [];
    for (const mod of mods) {
      const buf = fs.readFileSync(files.modZips[mod.id]);
      if (sha256(buf) !== mod.package.sha256) throw new EngineError('hash-mismatch', `The package of ${mod.id} does not match its SHA256.`, { what: mod.id });
      const zip = readZip(buf);
      const listed = new Map(mod.files.map((f) => [f.path.toLowerCase(), f]));
      const out = [];
      for (const e of zip.entries) {
        if (e.isDir) continue;
        const key = e.name.toLowerCase();
        const spec = listed.get(key);
        if (!spec) throw new EngineError('package-layout', `The package of ${mod.id} contains a file the catalog does not list: ${e.name}`);
        if (!underAny(spec.path, type.installRoots)) throw new EngineError('package-layout', `${mod.id} wants to install outside the mod folders: ${spec.path}`);
        if (taken.has(key)) throw new EngineError('file-collision', `${mod.id} and ${taken.get(key)} both install ${spec.path}.`);
        const data = zip.read(e);
        if (data.length !== spec.size || sha256(data) !== spec.sha256) {
          throw new EngineError('hash-mismatch', `${spec.path} in the package of ${mod.id} does not match the catalog.`, { what: mod.id });
        }
        taken.set(key, mod.id);
        listed.delete(key);
        out.push({ rel: spec.path, data });
      }
      if (listed.size) throw new EngineError('package-layout', `The package of ${mod.id} is missing ${[...listed.values()][0].path}.`);
      for (const p of mod.persist || []) {
        if (!underAny(p, type.persistRoots)) throw new EngineError('package-layout', `${mod.id} keeps data outside the allowed folders: ${p}`);
      }
      modArchives.push({ mod, files: out });
    }
    return { loaderZip, modArchives, type };
  }

  // ---- prepare the game folder ---------------------------------------------
  // files: { loaderZip: path, modZips: { modId: path } }
  // Returns the journal. On any error the game folder is rolled back.
  async prepare(plan, files) {
    const { game, gameDir, loader, mods } = plan;
    const problems = await this.preflight(plan);
    if (problems.length) throw new EngineError(problems[0].code, problems[0].message, { problems });

    const { loaderZip, modArchives, type } = this._loadArchives(plan, files);

    const claimNames = [...type.topLevel, ...type.alsoAside];
    const journal = {
      version: JOURNAL_VERSION,
      sessionId: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      startedAt: new Date().toISOString(),
      launcherVersion: this.launcherVersion,
      gameId: game.id,
      gameName: game.name,
      gameDir: path.resolve(gameDir),
      appId: game.steam ? game.steam.appId : null,
      executable: game.executable,
      processName: game.processName,
      loaderId: loader.id,
      loaderType: loader.type,
      mods: mods.map((m) => ({ id: m.id, version: m.version, persist: [...(m.persist || [])] })),
      phase: 'preparing',
      // What the launcher takes over in the game folder. `foreign` records
      // that something was already there and has to come back untouched.
      claims: claimNames.map((rel) => ({ rel, foreign: exists(path.join(gameDir, rel)) })),
      topLevelBefore: fs.readdirSync(gameDir).sort(),
    };
    this._write(journal);
    this.hook('journal');

    try {
      const aside = path.join(journal.gameDir, ASIDE);
      fs.mkdirSync(aside);
      for (const claim of journal.claims) {
        if (!claim.foreign) continue;
        fs.renameSync(path.join(journal.gameDir, claim.rel), path.join(aside, claim.rel));
        this.log(`moved aside: ${claim.rel}`);
        this.hook('moved:' + claim.rel);
      }

      for (const e of loaderZip.entries) {
        const target = inside(journal.gameDir, e.name);
        if (e.isDir) { fs.mkdirSync(target, { recursive: true }); continue; }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, loaderZip.read(e));
      }
      for (const must of type.mustExist) {
        if (!exists(inside(journal.gameDir, must))) throw new EngineError('loader-layout', `The loader archive is missing ${must}.`);
      }
      this.log(`installed loader: ${loader.name} ${loader.version}`);
      this.hook('loader');

      for (const { mod, files: list } of modArchives) {
        for (const f of list) {
          const target = inside(journal.gameDir, f.rel);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, f.data);
        }
        this.log(`installed mod: ${mod.id} ${mod.version}`);
        this.hook('mod:' + mod.id);
      }
      this._setPhase(journal, 'installed');

      for (const m of journal.mods) {
        const n = this._restorePersist(journal, m);
        if (n) this.log(`restored data of ${m.id}: ${n} item(s)`);
        this.hook('restore:' + m.id);
      }
      this._setPhase(journal, 'restored');
      return journal;
    } catch (err) {
      if (err instanceof CrashSignal) throw err;
      this.log(`preparation failed, rolling back: ${err.message}`);
      try { this.cleanup(journal); } catch (e) { this.log(`rollback failed: ${e.message}`); }
      throw err;
    }
  }

  // Records progress of the running session.
  mark(journal, phase, extra) {
    Object.assign(journal, extra || {});
    this._setPhase(journal, phase);
  }

  // ---- the store -----------------------------------------------------------
  // Brings a half finished swap back into a clean state.
  _normalizeStore(base) {
    const data = path.join(base, 'data');
    const old = path.join(base, 'data.old');
    if (!exists(data) && exists(old)) fs.renameSync(old, data);
    else if (exists(old)) removeTree(old);
    if (exists(path.join(base, 'data.new'))) removeTree(path.join(base, 'data.new'));
  }

  _checkPersistPath(journal, rel) {
    const type = loaderType(journal.loaderType);
    if (!type || !underAny(rel, type.persistRoots)) throw new EngineError('journal-invalid', `Refusing mod data path ${rel}.`);
  }

  _restorePersist(journal, m) {
    const base = this.storeDir(journal.gameId, m.id);
    this._normalizeStore(base);
    let count = 0;
    for (const rel of m.persist) {
      this._checkPersistPath(journal, rel);
      const src = inside(path.join(base, 'data'), rel);
      if (!exists(src)) continue;
      copyRecursive(src, inside(journal.gameDir, rel));
      count++;
    }
    return count;
  }

  // Copies the mod data from a game folder into the store. The new copy is
  // built next to the old one and swapped in, so a crash never leaves the
  // store half written.
  _savePersist(gameId, gameDir, m, check) {
    const base = this.storeDir(gameId, m.id);
    this._normalizeStore(base);
    const fresh = path.join(base, 'data.new');
    fs.mkdirSync(fresh, { recursive: true });
    let count = 0;
    for (const rel of m.persist) {
      if (check) check(rel);
      const src = inside(gameDir, rel);
      if (!exists(src)) continue;
      copyRecursive(src, inside(fresh, rel));
      count++;
    }
    this.hook('store-built:' + m.id);
    const data = path.join(base, 'data');
    const old = path.join(base, 'data.old');
    if (exists(data)) fs.renameSync(data, old);
    this.hook('store-swap:' + m.id);
    fs.renameSync(fresh, data);
    removeTree(old);
    writeJsonAtomic(path.join(base, 'meta.json'), { modId: m.id, version: m.version, savedAt: new Date().toISOString(), items: count });
    return count;
  }

  // What the store holds for a mod: { exists, bytes, savedAt }.
  storeInfo(gameId, modId) {
    const base = this.storeDir(gameId, modId);
    const data = path.join(base, 'data');
    const meta = readJson(path.join(base, 'meta.json'), null);
    const bytes = dirSize(data);
    return { exists: bytes > 0, bytes, savedAt: meta ? meta.savedAt : null };
  }

  // Import help: data of a known mod that sits in a game folder from a manual
  // install. Lists what is there, importPersist copies it. Nothing is removed.
  findImportable(game, gameDir, mods) {
    const out = [];
    if (!gameDir || !exists(gameDir)) return out;
    for (const mod of mods) {
      if (mod.game !== game.id || !(mod.persist || []).length) continue;
      if (this.storeInfo(game.id, mod.id).exists) continue;
      const found = mod.persist.filter((rel) => { try { return exists(inside(gameDir, rel)); } catch { return false; } });
      if (found.length) out.push({ gameId: game.id, modId: mod.id, paths: found });
    }
    return out;
  }

  importPersist(game, gameDir, mod) {
    if (this.readJournal(game.id)) throw new EngineError('pending-session', 'A session of this game is active.');
    return this._savePersist(game.id, gameDir, { id: mod.id, version: mod.version, persist: [...(mod.persist || [])] });
  }

  // ---- after the game ------------------------------------------------------
  // Saves mod data (when the phase says it is worth saving), then cleans up.
  // Returns { saved: [{id, items}], leftovers: [names], restored: [rels] }.
  finish(journal) {
    const result = { saved: [], leftovers: [], restored: [] };
    if (SAVE_PHASES.includes(journal.phase)) {
      for (const m of journal.mods) {
        const items = this._savePersist(journal.gameId, journal.gameDir, m, (rel) => this._checkPersistPath(journal, rel));
        result.saved.push({ id: m.id, items });
        this.log(`saved data of ${m.id}: ${items} item(s)`);
        this.hook('saved:' + m.id);
      }
      this._collectLogs(journal);
      this._setPhase(journal, 'saved');
    }
    Object.assign(result, this.cleanup(journal));
    return result;
  }

  _collectLogs(journal) {
    const type = loaderType(journal.loaderType);
    if (!type) return;
    for (const rel of type.logs) {
      try {
        const src = inside(journal.gameDir, rel);
        if (!exists(src)) continue;
        const dest = path.join(this.logsDir, journal.gameId, path.basename(rel));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
      } catch { /* a log is nice to have, never a reason to fail */ }
    }
  }

  // Removes what the journal claims and puts back what was moved aside.
  // Safe to run again after an interruption at any point.
  cleanup(journal) {
    const type = loaderType(journal.loaderType);
    if (!type) throw new EngineError('journal-invalid', 'The journal names an unknown loader type.');
    const allowed = new Set([...type.topLevel, ...type.alsoAside]);
    for (const claim of journal.claims) {
      if (!allowed.has(claim.rel)) throw new EngineError('journal-invalid', `The journal claims a path this loader never owns: ${claim.rel}`);
    }
    if (!exists(journal.gameDir)) {
      // The game was uninstalled meanwhile. Nothing left to put back.
      this._dropJournal(journal);
      return { leftovers: [], restored: [] };
    }

    this._setPhase(journal, 'cleaning');
    const aside = path.join(journal.gameDir, ASIDE);
    const restored = [];
    for (const claim of [...journal.claims].reverse()) {
      const here = path.join(journal.gameDir, claim.rel);
      const parked = path.join(aside, claim.rel);
      if (exists(parked)) {
        // Ours sits in the game folder (or nothing does), the original waits aside.
        removeTree(here);
        this.hook('removed:' + claim.rel);
        fs.renameSync(parked, here);
        restored.push(claim.rel);
        this.hook('unmoved:' + claim.rel);
      } else if (!claim.foreign) {
        removeTree(here);
        this.hook('removed:' + claim.rel);
      }
      // foreign and not parked: the original was never moved or is already
      // back in place. Leave it alone.
    }
    if (exists(aside)) {
      try { fs.rmdirSync(aside); } catch (e) { this.log(`${ASIDE} is not empty, leaving it in place: ${e.message}`); }
    }
    this.hook('aside-removed');

    const before = new Set(journal.topLevelBefore || []);
    const leftovers = fs.readdirSync(journal.gameDir).filter((n) => !before.has(n));
    if (leftovers.length) this.log(`new entries in the game folder that the launcher does not own: ${leftovers.join(', ')}`);
    this._dropJournal(journal);
    this.log('game folder restored');
    return { leftovers, restored };
  }

  _dropJournal(journal) {
    fs.rmSync(this.journalFile(journal.gameId), { force: true });
    this.hook('journal-removed');
  }

  // Called on launcher start for every journal found. When the game is still
  // running nothing is touched and the caller keeps waiting for it.
  async recover(gameId) {
    const journal = this.readJournal(gameId);
    if (!journal) return { status: 'none' };
    if (await this.isRunning(journal.processName)) return { status: 'running', journal };
    const result = this.finish(journal);
    return { status: 'cleaned', journal, ...result };
  }
}

module.exports = { Engine, EngineError, CrashSignal, ASIDE, JOURNAL_VERSION, SAVE_PHASES };
