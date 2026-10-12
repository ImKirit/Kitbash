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

  const win = new BrowserWindow({ width: 1280, height: 820, show: false, backgroundColor: '#f4f4f1', webPreferences: { offscreen: true } });
  let last = null;
  win.webContents.on('paint', (_e, _dirty, image) => { last = image; });
  win.webContents.setFrameRate(10);
  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => {
    await sleep(350);
    win.webContents.invalidate();
    await sleep(650);
    if (!last) throw new Error('no frame for ' + name);
    fs.writeFileSync(path.join(OUT, name), last.toPNG());
    console.log('wrote', name);
  };

  await win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
  await sleep(500);

  // ---- stage the sample data ------------------------------------------------
  await js(`(() => {
    const d = window.__demo, s = d.state;
    s.brand.name = ${JSON.stringify(brand.productName)};
    s.sources[0].url = ${JSON.stringify(brand.officialCatalogUrl)};
    d.loadCatalog(${JSON.stringify(catalog)});
    s.demoImages = ${JSON.stringify(imgs)};
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
    s.packs = [{ id: 'p1', name: 'Friday night', gameId: 'repo', mods: [{ id: 'repomimesis', version: '0.2.0' }, { id: 'repoportalgun', version: '0.1.0' }] }];
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
  await go({ name: 'home' });
  await shot('home.png');

  await go({ name: 'game', gameId: 'repo' });
  await shot('game.png');

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

  // German and dark
  await js(`window.launcher.saveSettings({ lang: 'de', theme: 'dark' }).then(() => window.__demo.refresh())`);
  await sleep(300);
  await go({ name: 'home' });
  await shot('home-dark-de.png');
  await go({ name: 'mod', gameId: 'repo', modId: 'repomimesis' });
  await shot('mod-dark-de.png');

  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
