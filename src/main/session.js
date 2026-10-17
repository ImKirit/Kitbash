// One launch from start to finish: check, download, prepare, start the game,
// wait for it to end, save mod data, clean up. Used by the app and the CLI.
'use strict';

const { EngineError } = require('./engine');
const { launchGame, waitForExit } = require('./launch');
const { checkRequirements } = require('./requirements');
const steamLib = require('./steam');
const { sleep: realSleep } = require('./util');
const overlay = require('./overlay');

// Turns ids into the objects the engine works with.
// Returns { game, gameDir, loader, mods, app } or throws EngineError.
function buildPlan(catalogData, gameId, modIds, steam) {
  const game = catalogData.games.find((g) => g.id === gameId);
  if (!game) throw new EngineError('game-unknown', `Unknown game ${gameId}.`);
  const mods = modIds.map((id) => {
    const m = catalogData.mods.find((x) => x.id === id);
    if (!m) throw new EngineError('mod-unknown', `Unknown mod ${id}.`);
    return m;
  });
  const loaderId = mods.length ? mods[0].loader : null;
  const loader = loaderId && catalogData.loaders[loaderId] ? { ...catalogData.loaders[loaderId], id: loaderId } : null;
  let app = null;
  if (steam && game.steam) app = steamLib.findApp(steam.path, game.steam.appId);
  return { game, gameDir: app && app.installed ? app.dir : null, loader, mods, app };
}

function requirementProblems(mods, ctx) {
  const problems = [];
  for (const mod of mods) {
    for (const r of checkRequirements(mod, ctx)) {
      if (r.ok || r.level !== 'required') continue;
      const what = r.type === 'steam-game' ? r.name : 'Minecraft Java' + (r.minVersion ? ' ' + r.minVersion + ' or newer' : '');
      problems.push({ code: 'requirement-missing', message: `${mod.id} needs ${what} on this PC.`, mod: mod.id, requirement: r });
    }
  }
  return problems;
}

const BUSY = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY', 'EACCES']);

// Windows can keep files locked for a moment after a game has ended.
async function finishWithRetry(engine, gameId, sleep, emit) {
  let lastError;
  for (let attempt = 0; attempt < 20; attempt++) {
    const journal = engine.readJournal(gameId);
    if (!journal) return { saved: [], leftovers: [], restored: [] };
    try { return engine.finish(journal); } catch (e) {
      lastError = e;
      if (!BUSY.has(e.code)) throw e;
      emit({ stage: 'cleaning', detail: 'waiting-for-files' });
      await sleep(2000);
    }
  }
  throw lastError;
}

// ctx: { engine, sources, steam, isRunning, minecraftPath, launchDeps, sleep }
// req: { catalogData, gameId, modIds }
// emit({ stage, ... }) reports progress. Never throws: the result carries
// { ok, stage, error?, problems?, attempts?, saved?, leftovers? }.
async function runSession(ctx, req, emit = () => { }) {
  const sleep = ctx.sleep || realSleep;
  const { engine } = ctx;
  let journal = null;
  const out = { ok: false, gameId: req.gameId, modIds: req.modIds, stage: 'checking' };
  try {
    emit({ stage: 'checking' });
    const plan = buildPlan(req.catalogData, req.gameId, req.modIds, ctx.steam);
    const problems = await engine.preflight(plan);
    problems.push(...requirementProblems(plan.mods, { steamPath: ctx.steam ? ctx.steam.path : null, minecraftPath: ctx.minecraftPath }));
    if (problems.length) return { ...out, problems };

    out.stage = 'downloading';
    emit({ stage: 'downloading' });
    // Only what is missing is fetched. What is already on disk works offline.
    const progress = (what) => (got, total) => emit({ stage: 'downloading', what, got, total });
    const files = { loaderZip: await ctx.sources.loaderFile(plan.loader, progress(plan.loader.name)), modZips: {} };
    for (const mod of plan.mods) files.modZips[mod.id] = await ctx.sources.ensurePackage(mod, progress(mod.id));
    if (ctx.overlay && ctx.overlay.enabled !== false && overlay.available()) {
      files.extra = overlay.overlayFiles(plan.mods, ctx.overlay);
    }

    out.stage = 'preparing';
    emit({ stage: 'preparing' });
    journal = await engine.prepare(plan, files);

    out.stage = 'launching';
    emit({ stage: 'launching' });
    const launched = await launchGame({
      steamExe: ctx.steam ? ctx.steam.exe : null,
      appId: plan.game.steam.appId,
      gameDir: plan.gameDir,
      executable: plan.game.executable,
      processName: plan.game.processName,
    }, {
      isRunning: ctx.isRunning,
      sleep,
      onAttempt: (method) => emit({ stage: 'launching', method }),
      ...(ctx.launchDeps || {}),
    });
    out.attempts = launched.attempts;
    out.method = launched.method;

    if (launched.ok) {
      engine.mark(journal, 'launched');
      out.stage = 'running';
      emit({ stage: 'running', method: launched.method });
      await waitForExit(plan.game.processName, { isRunning: ctx.isRunning, sleep, ...(ctx.waitDeps || {}) });
      engine.mark(journal, 'exited');
    }

    emit({ stage: 'saving' });
    const fin = await finishWithRetry(engine, req.gameId, sleep, emit);
    journal = null;
    Object.assign(out, fin);
    if (!launched.ok) return { ...out, stage: 'launching', error: 'The game did not start.', code: 'launch-failed' };
    emit({ stage: 'done' });
    return { ...out, ok: true, stage: 'done' };
  } catch (e) {
    if (e && e.name === 'CrashSignal') throw e;
    // A journal that is still on disk is picked up by recovery later.
    const pending = !!engine.readJournal(req.gameId);
    return { ...out, error: e.message, code: e.code || 'error', problems: e.problems, cleanupPending: pending };
  }
}

// Picks up a session whose game is still running after a launcher restart.
async function resumeSession(ctx, journal, emit = () => { }) {
  const sleep = ctx.sleep || realSleep;
  const out = { ok: false, gameId: journal.gameId, modIds: journal.mods.map((m) => m.id), stage: 'running', resumed: true };
  try {
    emit({ stage: 'running', resumed: true });
    await waitForExit(journal.processName, { isRunning: ctx.isRunning, sleep, ...(ctx.waitDeps || {}) });
    const fresh = ctx.engine.readJournal(journal.gameId);
    if (fresh && ['restored', 'launched'].includes(fresh.phase)) ctx.engine.mark(fresh, 'exited');
    emit({ stage: 'saving' });
    const fin = await finishWithRetry(ctx.engine, journal.gameId, sleep, emit);
    emit({ stage: 'done' });
    return { ...out, ...fin, ok: true, stage: 'done' };
  } catch (e) {
    return { ...out, error: e.message, code: e.code || 'error', cleanupPending: !!ctx.engine.readJournal(journal.gameId) };
  }
}

module.exports = { buildPlan, requirementProblems, runSession, resumeSession, finishWithRetry };
