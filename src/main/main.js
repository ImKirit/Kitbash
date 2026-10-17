// Main process: window, tray, IPC, auto update. The actual work lives in
// engine.js, sources.js and session.js, which know nothing about Electron.
'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const brand = require('../brand');
const pkg = require('../../package.json');
const { Engine } = require('./engine');
const { Sources } = require('./sources');
const { Settings } = require('./settings');
const { Packs, resolvePack, exportPack, importPack } = require('./packs');
const { runSession, resumeSession, buildPlan, requirementProblems } = require('./session');
const { checkRequirements } = require('./requirements');
const steamLib = require('./steam');
const proc = require('./proc');
const { largestIcon } = require('./exeicon');

app.setName(brand.productName);
app.setAppUserModelId(brand.appId);

const argValue = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const DEV = process.argv.includes('--dev');
const ICON = path.join(__dirname, '..', '..', 'build', 'icon.png');
const REFRESH_MS = 30 * 60 * 1000;

let win = null;
let tray = null;
let quitting = false;
let dataDir, settings, engine, sources, packs, steam;
let merged = { games: [], mods: [], loaders: {}, sources: [] };
const sessions = {};   // gameId -> { gameId, modIds, stage, method, log, result, startedAt }
const downloads = {};  // mod id -> { got, total }
const update = { status: 'idle', version: null, percent: 0 };

// ---- small helpers ----------------------------------------------------------
function lang() {
  const l = settings.get('lang');
  if (l === 'de' || l === 'en') return l;
  return /^de/i.test(app.getLocale()) ? 'de' : 'en';
}
const L = (en, de) => (lang() === 'de' ? de : en);
const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
const changed = () => send('changed');
const activeSessions = () => Object.values(sessions).filter((s) => !s.result);
const modById = (id) => merged.mods.find((m) => m.id === id) || null;
const gameById = (id) => merged.games.find((g) => g.id === id) || null;
const saveSources = () => settings.patch({ sources: sources.list });

function gameInstall(game) {
  if (!steam || !game.steam) return { installed: false, dir: null };
  const a = steamLib.findApp(steam.path, game.steam.appId);
  return { installed: !!(a && a.installed), dir: a && a.installed ? a.dir : null };
}

// The game's own icon, read from the installed exe and cached as a PNG in
// the data folder. Nothing is shipped with the launcher. Returns a file URL.
const iconMemo = new Map();
function gameIcon(game, dir) {
  if (!dir || !game.executable) return null;
  const exe = path.join(dir, game.executable);
  let st;
  try { st = fs.statSync(exe); } catch { return null; }
  const name = String(game.id).replace(/[^a-z0-9@-]/g, '') + '-' + st.size + '-' + Math.round(st.mtimeMs) + '.png';
  const file = path.join(dataDir, 'cache', 'icons', name);
  if (iconMemo.has(file)) return iconMemo.get(file);
  let url = null;
  try {
    if (!fs.existsSync(file)) {
      const found = largestIcon(exe);
      let png = found && found.png;
      if (found && !png) {
        const tmp = file.replace(/\.png$/, '.ico');
        fs.mkdirSync(path.dirname(tmp), { recursive: true });
        fs.writeFileSync(tmp, found.ico);
        const img = nativeImage.createFromPath(tmp);
        fs.rmSync(tmp, { force: true });
        if (!img.isEmpty()) png = img.toPNG();
      }
      if (png) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, png); }
    }
    if (fs.existsSync(file)) url = pathToFileURL(file).href;
  } catch { url = null; }
  iconMemo.set(file, url);
  return url;
}

async function refreshCatalogs() {
  merged = await sources.refresh();
  changed();
}

// ---- state for the window ---------------------------------------------------
function buildState() {
  const seen = settings.get('seen');
  const firstRun = Object.keys(seen).length === 0;
  const games = merged.games.map((g) => { const inst = gameInstall(g); return { ...g, ...inst, icon: gameIcon(g, inst.dir) }; });
  const mods = merged.mods.map((m) => ({
    ...m,
    download: sources.downloadState(m),
    kept: engine.storeInfo(m.game, m.id),
    isNew: !firstRun && !seen[m.id],
    isUpdated: !!seen[m.id] && seen[m.id] !== m.version,
  }));
  const dismissed = settings.get('importDismissed');
  const imports = [];
  for (const g of games) {
    if (!g.installed || sessions[g.id] && !sessions[g.id].result) continue;
    for (const f of engine.findImportable(g, g.dir, merged.mods)) {
      if (!dismissed[f.gameId + '/' + f.modId]) imports.push(f);
    }
  }
  return {
    brand: { name: brand.productName, homepage: brand.homepage },
    version: pkg.version, dev: DEV, lang: lang(),
    settings: { lang: settings.get('lang'), theme: settings.get('theme'), minecraftPath: settings.get('minecraftPath'), selection: settings.get('selection'), overlay: settings.get('overlay') !== false, overlayHotkey: settings.get('overlayHotkey') || 'F10' },
    steamFound: !!steam, games, mods, loaders: merged.loaders, sources: merged.sources,
    packs: packs.all(), library: sources.library(), cacheBytes: sources.cacheBytes(),
    sessions, downloads, update, imports,
  };
}

// ---- sessions ---------------------------------------------------------------
function sessionCtx() {
  return {
    engine, sources, steam, isRunning: proc.isRunning, minecraftPath: settings.get('minecraftPath'),
    overlay: { enabled: settings.get('overlay') !== false, hotkey: settings.get('overlayHotkey') || 'F10', lang: lang() },
  };
}

function trackSession(gameId, modIds, runner) {
  const s = { gameId, modIds, stage: 'checking', method: null, log: [], result: null, startedAt: Date.now(), progress: null };
  sessions[gameId] = s;
  const emit = (e) => {
    if (e.stage === 'downloading' && e.what) { s.progress = { what: e.what, got: e.got, total: e.total }; send('session', sessions); return; }
    s.stage = e.stage;
    s.progress = null;
    if (e.method) s.method = e.method;
    if (e.resumed) s.resumed = true;
    send('session', sessions);
    updateTray();
  };
  engine.log = (line) => { s.log.push(line); if (s.log.length > 200) s.log.shift(); send('session', sessions); };
  send('session', sessions);
  updateTray();
  runner(emit).then((result) => {
    s.result = result;
    s.stage = result.ok ? 'done' : 'failed';
    s.endedAt = Date.now();
    send('session', sessions);
    changed();
    updateTray();
    if (win && !win.isVisible() && tray) {
      tray.displayBalloon({
        title: brand.productName,
        content: result.ok ? L('Game closed. The game folder is back to how it was.', 'Spiel beendet. Der Spielordner ist wieder wie vorher.')
          : L('The session ended with a problem. Open the launcher for details.', 'Die Sitzung endete mit einem Problem. Öffne den Launcher für Details.'),
      });
    }
  });
}

// Finishes what an earlier launcher run left behind.
async function recoverPending() {
  for (const j of engine.pendingJournals()) {
    let r;
    try { r = await engine.recover(j.gameId); } catch (e) {
      sessions[j.gameId] = { gameId: j.gameId, modIds: j.mods.map((m) => m.id), stage: 'failed', log: [e.message], result: { ok: false, error: e.message, code: e.code, cleanupPending: true, recovered: true }, startedAt: Date.now() };
      continue;
    }
    if (r.status === 'running') {
      trackSession(j.gameId, j.mods.map((m) => m.id), (emit) => resumeSession(sessionCtx(), j, emit));
    } else if (r.status === 'cleaned') {
      sessions[j.gameId] = {
        gameId: j.gameId, modIds: j.mods.map((m) => m.id), stage: 'done', log: ['recovered after an interrupted session'],
        result: { ok: true, recovered: true, saved: r.saved || [], leftovers: r.leftovers || [] }, startedAt: Date.now(), endedAt: Date.now(),
      };
    }
  }
}

// ---- window and tray --------------------------------------------------------
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 1020, minHeight: 680,
    backgroundColor: settings.get('theme') === 'light' ? '#f4f4f1' : '#0a0a0b',
    icon: ICON, show: false, autoHideMenuBar: true, title: brand.productName, frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  const sendWin = () => send('window', { maximized: win.isMaximized() });
  win.on('maximize', sendWin);
  win.on('unmaximize', sendWin);
  // --smoke <file>: start for real, save a picture of the window, quit.
  const smoke = argValue('--smoke');
  if (smoke) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      const view = argValue('--smoke-view');
      if (view) await win.webContents.executeJavaScript('window.__go(' + view + ')');
      setTimeout(async () => { fs.writeFileSync(smoke, (await win.webContents.capturePage()).toPNG()); quitting = true; app.quit(); }, 1500);
    }, 3500));
  }
  // The window only ever shows the bundled page.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('close', (e) => {
    if (quitting || activeSessions().length === 0) return;
    // A game is running with mods: stay in the tray until it is cleaned up.
    e.preventDefault();
    win.hide();
    if (tray) {
      tray.displayBalloon({
        title: L(`${brand.productName} keeps running`, `${brand.productName} läuft weiter`),
        content: L('It waits in the tray and puts the game folder back as soon as you close the game.', 'Es wartet im Tray und stellt den Spielordner wieder her, sobald du das Spiel beendest.'),
      });
    }
  });
  win.on('closed', () => { win = null; if (!quitting && activeSessions().length === 0) app.quit(); });
}

function showWindow() {
  if (!win) createWindow();
  else { win.show(); win.focus(); }
}

function updateTray() {
  if (!tray) return;
  const active = activeSessions();
  const names = active.map((s) => (gameById(s.gameId) || { name: s.gameId }).name).join(', ');
  tray.setToolTip(active.length ? L(`${brand.productName}: ${names} is running, cleaning up afterwards`, `${brand.productName}: ${names} läuft, danach wird aufgeräumt`) : brand.productName);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: L('Open', 'Öffnen'), click: showWindow },
    { type: 'separator' },
    { label: L('Quit', 'Beenden'), click: requestQuit },
  ]));
}

function requestQuit() {
  if (activeSessions().length) {
    const choice = dialog.showMessageBoxSync(win || undefined, {
      type: 'warning', buttons: [L('Keep running', 'Weiterlaufen lassen'), L('Quit anyway', 'Trotzdem beenden')], defaultId: 0, cancelId: 0,
      title: brand.productName,
      message: L('A game is still running with mods.', 'Ein Spiel läuft noch mit Mods.'),
      detail: L('If you quit now, the game folder is put back the next time you start the launcher.', 'Wenn du jetzt beendest, wird der Spielordner beim nächsten Start des Launchers wiederhergestellt.'),
    });
    if (choice !== 1) return;
  }
  quitting = true;
  app.quit();
}

// ---- auto update ------------------------------------------------------------
// Checks GitHub releases. Any failure (offline, no release yet, repository
// not public) is swallowed: the launcher just keeps its version.
function setupUpdater() {
  if (!app.isPackaged) { update.status = 'dev'; ipcMain.handle('update:install', () => false); return; }
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  const set = (status, extra) => { Object.assign(update, { status }, extra || {}); send('update', update); };
  autoUpdater.on('checking-for-update', () => set('checking'));
  autoUpdater.on('update-not-available', () => set('current'));
  autoUpdater.on('update-available', (i) => set('downloading', { version: i.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => set('downloading', { percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => set('ready', { version: i.version }));
  autoUpdater.on('error', () => set('idle'));
  const check = () => autoUpdater.checkForUpdates().catch(() => { });
  check();
  setInterval(check, 4 * 60 * 60 * 1000);
  ipcMain.handle('update:install', () => {
    if (update.status !== 'ready' || activeSessions().length) return false;
    quitting = true;
    autoUpdater.quitAndInstall();
    return true;
  });
}

// ---- IPC --------------------------------------------------------------------
function fail(e) { return { error: e.message, code: e.code || 'error', source: e.source }; }

function registerIpc() {
  const handle = (name, fn) => ipcMain.handle(name, async (_e, ...args) => {
    try { return await fn(...args); } catch (e) { return fail(e); }
  });

  handle('state:get', () => buildState());
  handle('win:minimize', () => { if (win) win.minimize(); return true; });
  handle('win:maximize', () => { if (win) { if (win.isMaximized()) win.unmaximize(); else win.maximize(); } return true; });
  handle('win:close', () => { if (win) win.close(); return true; });
  handle('catalog:refresh', async () => { await refreshCatalogs(); return buildState(); });

  handle('mod:check', async (gameId, modIds) => {
    const plan = buildPlan(merged, gameId, modIds, steam);
    const ctx = { steamPath: steam ? steam.path : null, minecraftPath: settings.get('minecraftPath') };
    const problems = await engine.preflight(plan);
    problems.push(...requirementProblems(plan.mods, ctx));
    const requirements = {};
    for (const m of plan.mods) requirements[m.id] = checkRequirements(m, ctx);
    return { problems, requirements };
  });

  // Downloads one package. Unofficial sources need `confirmed` once.
  handle('mod:download', async (id, confirmed) => {
    const mod = modById(id);
    if (!mod) return { error: 'unknown mod', code: 'mod-unknown' };
    if (sources.needsConfirmation(mod)) {
      if (confirmed !== true) return { needsConfirm: [mod.source] };
      sources.confirmSource(mod.source.id);
      saveSources();
    }
    downloads[id] = { got: 0, total: mod.package.size };
    send('download', downloads);
    try {
      await sources.ensurePackage(mod, (got, total) => { downloads[id] = { got, total }; send('download', downloads); });
    } finally { delete downloads[id]; send('download', downloads); }
    changed();
    return { ok: true };
  });
  handle('mod:delete', (id) => { const ok = sources.deletePackage(id); changed(); return { ok }; });
  handle('mod:seen', (id) => {
    const mod = modById(id);
    if (mod) settings.patch({ seen: { ...settings.get('seen'), [id]: mod.version } });
    return true;
  });
  handle('mod:image', async (id, rel) => {
    const mod = modById(id);
    if (!mod || !(mod.images || []).includes(rel)) return null;
    const file = await sources.imageFile(mod, rel);
    return file ? pathToFileURL(file).href : null;
  });

  handle('launch:start', async (gameId, modIds, confirmed) => {
    if (sessions[gameId] && !sessions[gameId].result) return { error: 'already running', code: 'pending-session' };
    const mods = modIds.map(modById).filter(Boolean);
    if (mods.length !== modIds.length) return { error: 'unknown mod', code: 'mod-unknown' };
    const ask = [];
    for (const m of mods) {
      if (sources.downloadState(m).state !== 'ready' && sources.needsConfirmation(m) && !ask.some((s) => s.id === m.source.id)) ask.push(m.source);
    }
    if (ask.length) {
      if (confirmed !== true) return { needsConfirm: ask };
      for (const s of ask) sources.confirmSource(s.id);
      saveSources();
    }
    settings.patch({ selection: { ...settings.get('selection'), [gameId]: modIds } });
    trackSession(gameId, modIds, (emit) => runSession(sessionCtx(), { catalogData: merged, gameId, modIds }, emit));
    return { started: true };
  });
  handle('session:dismiss', (gameId) => { if (sessions[gameId] && sessions[gameId].result) delete sessions[gameId]; send('session', sessions); return true; });

  handle('pack:save', (pack) => { const p = packs.save(pack); changed(); return { pack: p }; });
  handle('pack:remove', (id) => { packs.remove(id); changed(); return { ok: true }; });
  handle('pack:export', (id) => {
    const p = packs.get(id);
    if (!p) return { error: 'unknown pack', code: 'pack-unknown' };
    return { code: exportPack(p, merged) };
  });
  // Reads a code. Tells which sources and mods are missing, stores nothing.
  handle('pack:import', (code) => {
    const { pack, sources: needed } = importPack(code);
    const missingSources = needed.filter((s) => !merged.sources.some((x) => x.id === s.id));
    const r = resolvePack(pack, merged);
    return { pack, missingSources, missing: r.missing, changed: r.changed, gameKnown: !!r.game };
  });

  handle('source:preview', (input) => ({ entry: sources.prepareAdd(input) }));
  handle('source:add', async (input, accepted) => {
    const entry = sources.add(input, accepted);
    saveSources();
    await refreshCatalogs();
    return { entry, info: merged.sources.find((s) => s.id === entry.id) };
  });
  handle('source:remove', async (id) => {
    if (activeSessions().length) return { error: 'a game is running', code: 'pending-session' };
    sources.remove(id);
    saveSources();
    merged = sources.merged();
    changed();
    return { ok: true };
  });

  handle('settings:save', async (patch) => {
    const allowed = {};
    for (const k of ['lang', 'theme', 'minecraftPath', 'overlay', 'overlayHotkey']) if (patch && k in patch) allowed[k] = patch[k];
    if ('overlayHotkey' in allowed && !/^F([1-9]|1[0-2])$/.test(String(allowed.overlayHotkey))) delete allowed.overlayHotkey;
    settings.patch(allowed);
    updateTray();
    return buildState();
  });

  handle('import:run', (gameId, modId) => {
    const game = gameById(gameId);
    const mod = modById(modId);
    const inst = game ? gameInstall(game) : null;
    if (!game || !mod || !inst.installed) return { error: 'not found', code: 'game-missing' };
    const items = engine.importPersist(game, inst.dir, mod);
    changed();
    return { ok: true, items };
  });
  handle('import:dismiss', (gameId, modId) => {
    settings.patch({ importDismissed: { ...settings.get('importDismissed'), [gameId + '/' + modId]: true } });
    changed();
    return true;
  });

  handle('open:data', () => shell.openPath(dataDir));
  handle('open:game', (gameId) => { const g = gameById(gameId); const i = g ? gameInstall(g) : null; return i && i.dir ? shell.openPath(i.dir) : null; });
  handle('open:log', (gameId) => {
    const file = path.join(engine.logsDir, String(gameId).replace(/[^a-z0-9@-]/g, ''), 'LogOutput.log');
    return fs.existsSync(file) ? shell.openPath(file) : 'missing';
  });
  handle('open:external', (url) => { if (/^https:\/\//i.test(String(url))) shell.openExternal(String(url)); return true; });
  handle('dialog:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('clipboard:write', (text) => { clipboard.writeText(String(text).slice(0, 30000)); return true; });
  handle('clipboard:read', () => clipboard.readText().slice(0, 30000));
}

// ---- start ------------------------------------------------------------------
// A separate data folder (tests, a second profile) also gets its own Electron profile and lock.
if (argValue('--data')) app.setPath('userData', path.join(path.resolve(argValue('--data')), 'electron'));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showWindow);
  app.whenReady().then(async () => {
    dataDir = path.resolve(argValue('--data') || path.join(app.getPath('userData'), 'data'));
    fs.mkdirSync(dataDir, { recursive: true });
    settings = new Settings(dataDir);
    engine = new Engine({ dataDir, isRunning: proc.isRunning, launcherVersion: pkg.version });
    sources = new Sources({ dataDir, officialUrl: argValue('--catalog') || settings.get('catalogSource') || undefined, list: settings.get('sources') });
    packs = new Packs(dataDir);
    steam = steamLib.findSteam();

    registerIpc();
    sources.loadCached();
    merged = sources.merged();
    await recoverPending();

    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
    tray.on('click', showWindow);
    updateTray();
    createWindow();
    setupUpdater();

    refreshCatalogs().catch(() => { });
    setInterval(() => refreshCatalogs().catch(() => { }), REFRESH_MS);
  });
  app.on('window-all-closed', () => { if (activeSessions().length === 0) app.quit(); });
  app.on('before-quit', () => { quitting = true; });
}
