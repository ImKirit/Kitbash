// Renders the window offscreen WITHOUT the preload script, so demo.js supplies
// the data, and saves PNGs. The mod list comes from a real catalog folder.
//
//   npx electron scripts/screenshot.js [--out <folder>] [--catalog <folder>]
//
// Default output is docs/, default catalog is the sibling catalog repository.
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const brand = require('../src/brand');
const { nativeImage } = require('electron');
const os = require('os');
const steamLib = require('../src/main/steam');
const { largestIcon } = require('../src/main/exeicon');
const { gameArt, minecraftArt } = require('../src/main/art');
const { httpsGet } = require('../src/main/download');
const { findMinecraftVersions } = require('../src/main/requirements');

const ROOT = path.join(__dirname, '..');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const OUT = path.resolve(arg('--out', path.join(ROOT, 'docs')));
const CATALOG = path.resolve(arg('--catalog', path.join(ROOT, '..', brand.modsRepo)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const catalog = JSON.parse(fs.readFileSync(path.join(CATALOG, 'catalog.json'), 'utf8'));
  const imgs = {};
  for (const m of catalog.mods) for (const rel of m.images || []) imgs[m.id + '|' + rel] = pathToFileURL(path.join(CATALOG, rel)).href;

  // Game icons come from the games installed on this PC, like in the real app.
  // They are written to a temp folder, never into the repository.
  const icons = {};
  const steam = steamLib.findSteam();
  const iconDir = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-icons-'));
  for (const g of catalog.games) {
    if (!steam || !g.steam || !g.executable) continue;
    const a = steamLib.findApp(steam.path, g.steam.appId);
    const found = a && a.installed ? largestIcon(path.join(a.dir, g.executable)) : null;
    if (!found) continue;
    let png = found.png;
    if (!png) { const t = path.join(iconDir, g.id + '.ico'); fs.writeFileSync(t, found.ico); const img = nativeImage.createFromPath(t); if (!img.isEmpty()) png = img.toPNG(); }
    if (png) { const f = path.join(iconDir, g.id + '.png'); fs.writeFileSync(f, png); icons[g.id] = pathToFileURL(f).href; console.log('icon', g.id, found.size + 'px'); }
  }
  // --icons <folder>: icons cached by an earlier real run (<game>-*.png), for games not installed right now
  const iconArg = arg('--icons', null);
  if (iconArg) for (const n of fs.readdirSync(iconArg)) { const id = n.split('-')[0]; if (!icons[id] && n.endsWith('.png')) { icons[id] = pathToFileURL(path.join(iconArg, n)).href; console.log('icon from cache', id); } }

  // banners from Steam's local library cache, as the app does at runtime
  const banners = {};
  for (const g of catalog.games) {
    if (!g.steam) continue;
    const a = await gameArt(g, { cacheDir: iconDir, steamPath: steam ? steam.path : null, exeIcon: () => null, online: false });
    if (a.banner) banners[g.id] = pathToFileURL(a.banner).href;
    if (!icons[g.id] && a.icon) icons[g.id] = pathToFileURL(a.icon).href;
    console.log('art', g.id, a.source.banner || 'none', a.source.icon || 'none');
  }

  const upArt = {};
  for (const u of catalog.upcoming || []) {
    if (u.steamAppId) {
      const a = await gameArt({ id: u.id, steam: { appId: u.steamAppId } }, { cacheDir: iconDir, steamPath: steam ? steam.path : null, fetch: httpsGet });
      upArt[u.id] = { banner: a.banner ? pathToFileURL(a.banner).href : null, icon: a.icon ? pathToFileURL(a.icon).href : null };
      console.log('upcoming art', u.id, a.source.banner || 'none');
    } else if (u.minecraft) {
      const f = minecraftArt(iconDir, findMinecraftVersions().map((v) => v.file));
      upArt[u.id] = { logo: f ? pathToFileURL(f).href : null };
      console.log('upcoming art', u.id, f ? 'jar' : 'none');
    }
  }

  const win = new BrowserWindow({ width: 1280, height: 820, show: false, backgroundColor: '#0a0a0b', webPreferences: { offscreen: true } });
  let last = null;
  win.webContents.on('paint', (_e, _dirty, image) => { last = image; });
  win.webContents.setFrameRate(10);
  win.webContents.on('console-message', (_e, level, message, line, source) => { if (level >= 2) console.log('page error:', message, path.basename(String(source)) + ':' + line); });
  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => {
    await sleep(1150);
    let image = null;
    for (let i = 0; i < 5; i++) {
      win.webContents.invalidate();
      await sleep(350);
      image = await win.webContents.capturePage();
      if (!image.isEmpty()) break;
    }
    if (!image || image.isEmpty()) image = last;
    if (!image || image.isEmpty()) throw new Error('no frame for ' + name);
    fs.writeFileSync(path.join(OUT, name), image.toPNG());
    console.log('wrote', name, image.getSize().width + 'x' + image.getSize().height);
  };

  await win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
  await sleep(500);

  // ---- stage the sample data ------------------------------------------------
  await js(`(() => {
    const d = window.__demo, s = d.state;
    s.version = "0.2.0";
    s.brand.name = ${JSON.stringify(brand.productName)};
    s.sources[0].url = ${JSON.stringify(brand.officialCatalogUrl)};
    d.loadCatalog(${JSON.stringify(catalog)});
    s.demoImages = ${JSON.stringify(imgs)};
    const icons = ${JSON.stringify(icons)};
    for (const g of s.games) { g.icon = icons[g.id] || null; g.banner = (${JSON.stringify(banners)})[g.id] || null; }
    const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
    s.history = [
      { id: 'h1', gameId: 'repo', gameName: 'R.E.P.O.', modIds: ['repomimesis', 'repoportalgun'], modNames: ['Mimics', 'Portal Gun'], packName: 'Friday night', startedAt: ago(20), endedAt: ago(18.6), ok: true, played: true },
      { id: 'h2', gameId: 'peak', gameName: 'PEAK', modIds: ['peakminecraft'], modNames: ['Minecraft in PEAK'], packName: null, startedAt: ago(46), endedAt: ago(45.2), ok: true, played: true },
      { id: 'h3', gameId: 'peak', gameName: 'PEAK', modIds: ['peakrepomonsters', 'peakamongus'], modNames: ['R.E.P.O. Monsters', 'Among Us in PEAK'], packName: 'Mountain chaos', startedAt: ago(70), endedAt: ago(70), ok: false, played: false, stage: 'checking', error: 'PEAK is not installed.' },
    ];
    s.favorites = ['repomimesis'];
    const upArt = ${JSON.stringify(upArt)};
    s.upcoming = s.upcoming.map((u) => ({ ...u, ...(upArt[u.id] || {}) }));
    const m = (id) => s.mods.find((x) => x.id === id);
    m('repomimesis').download.state = 'ready';
    m('repomimesis').kept = { exists: true, bytes: 482113, savedAt: new Date(Date.now() - 3 * 3600e3).toISOString() };
    m('repoportalgun').download.state = 'ready';
    m('peakminecraft').download.state = 'ready';
    m('peakamongus').isNew = true;
    m('repominecraft').demoReqs = [{ type: 'minecraft-java', level: 'required', ok: true, detail: '1.21.11', minVersion: '1.20.2', text: m('repominecraft').requirements[0].text }];
    m('peakminecraft').demoReqs = m('repominecraft').demoReqs;
    m('peakrepomonsters').demoReqs = [{ type: 'steam-game', level: 'recommended', ok: true, name: 'R.E.P.O.', text: m('peakrepomonsters').requirements[0].text }];
    // one mod from an unofficial sample source
    s.sources.push({ ...d.other, url: 'https://raw.githubusercontent.com/someone/cool-mods/HEAD/catalog.json', fetchedAt: new Date().toISOString(), error: null, offline: false, mods: 1, skipped: [] });
    s.mods.push({ ...m('repoportalgun'), id: 'flashlight@' + d.other.id, localId: 'flashlight', name: { en: 'Brighter Flashlight', de: 'Hellere Taschenlampe' }, author: 'someone',
      summary: { en: 'Sample entry of a third-party source.', de: 'Beispieleintrag einer fremden Quelle.' }, description: { en: 'Sample entry of a third-party source.', de: 'Beispieleintrag einer fremden Quelle.' },
      source: d.other, download: { state: 'none' }, package: { size: 18432 }, images: [], controls: [], notes: [], kept: { exists: false }, isNew: false });
    s.packs = [
      { id: 'p1', name: 'Friday night', gameId: 'repo', mods: [{ id: 'repomimesis', version: '0.2.0' }, { id: 'repoportalgun', version: '0.1.0' }], lastPlayed: new Date(Date.now() - 20 * 3600e3).toISOString() },
      { id: 'p2', name: 'Mountain chaos', gameId: 'peak', mods: [{ id: 'peakrepomonsters', version: '0.2.0' }, { id: 'peakamongus', version: '0.1.0' }] },
      { id: 'p3', name: 'Block party', gameId: 'peak', mods: [{ id: 'peakminecraft', version: '0.1.0' }], lastPlayed: new Date(Date.now() - 46 * 3600e3).toISOString() },
    ];
    s.library = [
      { id: 'repomimesis', source: 'official', version: '0.2.0', size: 74423, at: new Date(Date.now() - 3 * 3600e3).toISOString() },
      { id: 'repoportalgun', source: 'official', version: '0.1.0', size: 29025, at: new Date(Date.now() - 3 * 3600e3).toISOString() },
      { id: 'peakminecraft', source: 'official', version: '0.1.0', size: 60285, at: new Date(Date.now() - 26 * 3600e3).toISOString() },
    ];
    s.cacheBytes = 74423 + 29025 + 60285 + 639118;
    s.settings.selection = { repo: ['repomimesis', 'repoportalgun'] };
    s.demoCode = 'KB1-eyJ2IjoxLCJuYW1lIjoiRnJpZGF5IG5pZ2h0IiwiZ2FtZSI6InJlcG8iLCJnYW1lU291cmNlIjoib2ZmaWNpYWwiLCJzb3VyY2VzIjpbXSwibW9kcyI6W3siaWQiOiJyZXBvbWltZXNpcyIsInNvdXJjZSI6Im9mZmljaWFsIiwidmVyc2lvbiI6IjAuMi4wIn0seyJpZCI6InJlcG9wb3J0YWxndW4iLCJzb3VyY2UiOiJvZmZpY2lhbCIsInZlcnNpb24iOiIwLjEuMCJ9XX0';
    d.refresh();
  })()`);
  await sleep(400);

  const go = (v) => js(`window.__go(${JSON.stringify(v)})`);
  await go({ name: 'settings' });
  await sleep(300);
  await go({ name: 'home' });
  await shot('home.png');

  await go({ name: 'browse' });
  await shot('browse.png');
  await js(`(() => { const i = document.getElementById('browseQuery'); i.value = 'minecraft'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await shot('browse-search.png');
  await js(`(() => { const i = document.getElementById('browseQuery'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await go({ name: 'packs' });
  await shot('packs.png');
  await js(`document.querySelector('.page-head [data-act="pack-new"]').click()`);
  await shot('pack-game-picker.png');
  await js(`document.querySelector('[data-act="modal-close"]').click()`);
  await go({ name: 'history' });
  await shot('history.png');
  await go({ name: 'news' });
  await shot('news.png');
  await go({ name: 'account' });
  await shot('account-signed-out.png');
  await js(`(() => { const s = window.__demo.state; s.account = { signedIn: true, user: { id: '1', name: 'Kirit', avatar: null }, lastSync: new Date(Date.now() - 4 * 60e3).toISOString(), error: null }; window.__demo.refresh(); })()`);
  await sleep(300);
  await go({ name: 'account' });
  await shot('account.png');
  await js(`window.__menu('[data-act="account-menu"]', 'account-menu')`);
  await shot('account-menu.png');
  await js(`document.body.click()`);
  await go({ name: 'game', gameId: 'repo' });
  await shot('game.png');
  await js(`window.__menu('[data-act="mod-menu"]', 'mod-menu')`);
  await shot('mod-menu.png');
  await js(`document.body.click()`);
  await js(`window.__menu('#tbBrand', 'app-menu')`);
  await shot('app-menu.png');
  await js(`document.body.click()`);

  await go({ name: 'mod', gameId: 'repo', modId: 'repomimesis' });
  await shot('mod.png');

  await go({ name: 'mod', gameId: 'peak', modId: 'peakrepomonsters' });
  await shot('mod-requirements.png');

  await go({ name: 'game', gameId: 'repo', tab: 'packs' });
  await shot('modpacks.png');
  await js(`document.querySelector('[data-act="pack-edit"]').click()`);
  await shot('modpack-edit.png');
  await js(`document.querySelector('[data-act="modal-close"]').click(); document.querySelector('[data-act="pack-share"]').click()`);
  await shot('modpack-share.png');
  await js(`document.querySelector('[data-act="modal-close"]').click()`);

  // a running session, then a finished one
  await js(`(() => { const s = window.__demo.state;
    s.sessions = { repo: { gameId: 'repo', modIds: ['repomimesis', 'repoportalgun'], stage: 'running', method: 'steam-applaunch', result: null, startedAt: Date.now(),
      log: ['moved aside: BepInEx', 'moved aside: winhttp.dll', 'moved aside: doorstop_config.ini', 'installed loader: BepInEx 5.4.23.5', 'installed mod: repomimesis 0.2.0', 'installed mod: repoportalgun 0.1.0', 'restored data of repomimesis: 2 item(s)'] } };
    window.__demo.refresh(); })()`);
  await sleep(300);
  await go({ name: 'game', gameId: 'repo' });
  await shot('session-running.png');
  await js(`(() => { const s = window.__demo.state.sessions.repo; s.stage = 'done';
    s.log.push('saved data of repomimesis: 2 item(s)', 'saved data of repoportalgun: 1 item(s)', 'game folder restored');
    s.result = { ok: true, stage: 'done', saved: [{ id: 'repomimesis', items: 2 }, { id: 'repoportalgun', items: 1 }], leftovers: [] };
    window.__demo.refresh(); })()`);
  await shot('session-done.png');
  await js(`(() => { window.__demo.state.sessions = {}; window.__demo.refresh(); })()`);

  await go({ name: 'library' });
  await shot('downloads.png');

  await go({ name: 'sources' });
  await shot('sources.png');
  await js(`document.querySelector('[data-act="source-add"]').click()`);
  await shot('source-warning.png');
  await js(`document.querySelector('[data-act="modal-close"]').click()`);

  await go({ name: 'mod', gameId: 'repo', modId: 'flashlight@someone-cool-mods-1a2b3c' });
  await shot('mod-unofficial.png');

  await go({ name: 'settings' });
  await shot('settings.png');

  // proof for the hover tilt and sheen: one card, cursor at two places
  await go({ name: 'browse' });
  await sleep(1300);
  const r = await js(`(() => { const b = document.querySelector('.tiles .tile.click').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
  const area = { x: Math.max(0, Math.round(r.x - 24)), y: Math.max(0, Math.round(r.y - 24)), width: Math.round(r.w + 48), height: Math.round(r.h + 48) };
  for (const [name, fx, fy, at] of [['sweep-rest.png', 0.85, 0.3, null]]) {
    for (let k = 0; k < 6; k++) { win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(r.x + r.w * fx) + k, y: Math.round(r.y + r.h * fy) }); await sleep(40); }
    await sleep(1100);
    // freeze the sweep at one moment so the picture shows the band
    if (at) await js(`(() => { const t = document.querySelector('.tiles .tile.click'); t.style.setProperty('--sweep-state', 'paused'); t.style.setProperty('--sweep-delay', '${at}'); t.classList.remove('fx-sweep'); void t.offsetWidth; t.classList.add('fx-sweep'); })()`);
    await sleep(200);
    win.webContents.invalidate();
    await sleep(300);
    const img = await win.webContents.capturePage(area);
    fs.writeFileSync(path.join(OUT, name), img.toPNG());
    console.log('wrote', name, JSON.stringify(await js(`(() => { const t = document.querySelector('.tiles .tile.click'); const a = getComputedStyle(t, '::after'); return [t.className, t.style.getPropertyValue('--rx'), t.style.getPropertyValue('--ry'), a.animationName, a.animationPlayState, a.opacity, a.transform, a.content, a.height]; })()`)));
  }
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 5, y: 5 });

  // German and the light theme
  await js(`window.launcher.saveSettings({ lang: 'de', theme: 'light' }).then(() => window.__demo.refresh())`);
  await sleep(300);
  await go({ name: 'home' });
  await shot('home-light-de.png');
  await go({ name: 'mod', gameId: 'repo', modId: 'repomimesis' });
  await shot('mod-light-de.png');

  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
