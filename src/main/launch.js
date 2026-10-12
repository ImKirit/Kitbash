// Starts a game and tells whether its process really appeared.
// Order: steam.exe -applaunch, then the steam:// link, then the exe itself.
'use strict';

const path = require('path');
const { spawn: nodeSpawn } = require('child_process');
const { sleep: realSleep } = require('./util');

function detached(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = nodeSpawn(file, args, { detached: true, stdio: 'ignore', windowsHide: false, ...opts });
    } catch (e) { return reject(e); }
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

const DEFAULT_TIMEOUTS = { 'steam-applaunch': 75000, 'steam-url': 45000, 'direct-exe': 45000 };

// target: { steamExe, appId, gameDir, executable, processName }
// deps:   { isRunning, spawn, sleep, timeouts, pollMs, onAttempt }
// Returns { ok, method, attempts: [{ method, ok, waitedMs, error }] }.
async function launchGame(target, deps = {}) {
  const isRunning = deps.isRunning;
  const spawn = deps.spawn || detached;
  const sleep = deps.sleep || realSleep;
  const timeouts = { ...DEFAULT_TIMEOUTS, ...(deps.timeouts || {}) };
  const pollMs = deps.pollMs || 1000;
  const attempts = [];

  const methods = [];
  if (target.steamExe && target.appId) {
    methods.push({ id: 'steam-applaunch', run: () => spawn(target.steamExe, ['-applaunch', String(target.appId)]) });
  }
  if (target.appId) {
    methods.push({ id: 'steam-url', run: () => spawn('rundll32.exe', ['url.dll,FileProtocolHandler', `steam://rungameid/${Number(target.appId)}`]) });
  }
  methods.push({ id: 'direct-exe', run: () => spawn(path.join(target.gameDir, target.executable), [], { cwd: target.gameDir }) });

  for (const m of methods) {
    const attempt = { method: m.id, ok: false, waitedMs: 0, error: null };
    attempts.push(attempt);
    if (deps.onAttempt) deps.onAttempt(m.id);
    try { await m.run(); } catch (e) { attempt.error = e.message; continue; }
    const limit = timeouts[m.id];
    while (attempt.waitedMs < limit) {
      await sleep(pollMs);
      attempt.waitedMs += pollMs;
      let up = false;
      try { up = await isRunning(target.processName); } catch (e) { attempt.error = e.message; }
      if (up) { attempt.ok = true; break; }
    }
    if (attempt.ok) return { ok: true, method: m.id, attempts };
    if (!attempt.error) attempt.error = `process ${target.processName} did not appear within ${Math.round(limit / 1000)} s`;
  }
  return { ok: false, method: null, attempts };
}

// Resolves once the process has been gone for a few polls in a row, so a
// short gap (a game restarting itself) does not count as the end.
async function waitForExit(processName, deps = {}) {
  const isRunning = deps.isRunning;
  const sleep = deps.sleep || realSleep;
  const pollMs = deps.pollMs || 2000;
  const settle = deps.settle || 3;
  let gone = 0;
  while (gone < settle) {
    await sleep(pollMs);
    let up = true;
    try { up = await isRunning(processName); } catch { up = true; }
    gone = up ? 0 : gone + 1;
  }
}

module.exports = { launchGame, waitForExit, DEFAULT_TIMEOUTS };
