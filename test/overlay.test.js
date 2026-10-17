'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { overlayFiles, modInfo, available, OVERLAY_DIR } = require('../src/main/overlay');
const { validateCatalog } = require('../src/main/schema');
const h = require('./helpers');

const exists = (p) => fs.existsSync(p);

test('the overlay DLL ships with the launcher', () => {
  assert.ok(available(), 'src/assets/KitbashOverlay.dll is missing, run node scripts/build-overlay.js');
});

test('the overlay is installed with the session, listed in the journal and removed afterwards', async () => {
  const s = h.scene({ foreign: true });
  const before = h.snapshot(s.gameDir);
  s.plan.mods[0].usage = { keys: [{ key: 'F7', text: { en: 'Menu', de: 'Menü' } }], steps: [{ en: 'Open the menu.', de: 'Menü öffnen.' }] };
  const extra = overlayFiles(s.plan.mods, { lang: 'de', hotkey: 'F9', dll: Buffer.from('fake overlay dll') });
  const journal = await s.engine.prepare(s.plan, { ...s.files, extra });

  const dll = path.join(s.gameDir, OVERLAY_DIR, 'KitbashOverlay.dll');
  const json = JSON.parse(fs.readFileSync(path.join(s.gameDir, OVERLAY_DIR, 'kitbash-overlay.json'), 'utf8'));
  assert.equal(fs.readFileSync(dll, 'utf8'), 'fake overlay dll');
  assert.equal(json.hotkey, 'F9');
  assert.equal(json.lang, 'de');
  assert.equal(json.text.loaded, 'geladen');
  assert.deepEqual(json.mods.map((m) => m.id), ['alpha', 'beta']);
  assert.deepEqual(json.mods[0].dlls, ['BepInEx/plugins/Alpha/Alpha.dll']);
  assert.deepEqual(json.mods[0].usage, { keys: [{ key: 'F7', text: 'Menü' }], steps: ['Menü öffnen.'] });
  assert.ok(!json.selfTest);

  s.engine.mark(journal, 'launched');
  s.engine.mark(journal, 'exited');
  s.engine.finish(journal);
  assert.deepEqual(h.snapshot(s.gameDir), before, 'game folder must be exactly as before');
  assert.ok(!exists(dll));
  h.cleanupDir(s.root);
});

test('the overlay is cleaned up after a crash too', async () => {
  const s = h.scene();
  const before = h.snapshot(s.gameDir);
  const extra = overlayFiles(s.plan.mods, { dll: Buffer.from('x') });
  await s.engine.prepare(s.plan, { ...s.files, extra });
  const r = await s.newEngine().recover('fakegame');
  assert.equal(r.status, 'cleaned');
  assert.deepEqual(h.snapshot(s.gameDir), before);
  h.cleanupDir(s.root);
});

test('launcher files follow the same rules as mod files', async () => {
  let s = h.scene();
  await assert.rejects(s.engine.prepare(s.plan, { ...s.files, extra: [{ rel: 'Fake_Data/Managed/x.dll', data: 'x' }] }), (e) => e.code === 'package-layout');
  await assert.rejects(s.engine.prepare(s.plan, { ...s.files, extra: [{ rel: 'BepInEx/plugins/Alpha/Alpha.dll', data: 'x' }] }), (e) => e.code === 'file-collision');
  await assert.rejects(s.engine.prepare(s.plan, { ...s.files, extra: [{ rel: '../escape.dll', data: 'x' }] }));
  assert.equal(s.engine.pendingJournals().length, 0);
  h.cleanupDir(s.root);
});

test('self-test hook and key fallback', () => {
  const mod = { id: 'm', name: { en: 'Mod' }, version: '1', summary: 'S', files: [{ path: 'BepInEx/plugins/M/M.dll' }, { path: 'BepInEx/plugins/M/data.tpk' }], controls: [{ key: 'G', text: { en: 'Gun', de: 'Kanone' } }] };
  assert.deepEqual(modInfo(mod, 'de').usage, { keys: [{ key: 'G', text: 'Kanone' }], steps: [] });
  assert.deepEqual(modInfo(mod, 'en').dlls, ['BepInEx/plugins/M/M.dll']);
  const json = JSON.parse(overlayFiles([mod], { selfTest: { screenshot: 'C:\out\shot.png' }, dll: Buffer.from('x') })[1].data);
  assert.deepEqual(json.selfTest, { screenshot: 'C:\out\shot.png', delaySeconds: 15 });
  assert.equal(json.hotkey, 'F10');
});

test('schema checks the usage field', () => {
  const game = { id: 'repo', name: 'R', status: 'available', platform: 'steam', steam: { appId: 1 }, executable: 'R.exe', processName: 'R.exe', engine: 'unity-mono', antiCheat: false };
  const mod = h.makeMod(h.tmpDir('u'), 'umod', { 'BepInEx/plugins/U/U.dll': 'u' }).mod;
  const cat = (usage) => ({ schemaVersion: 1, games: [game], mods: [{ ...mod, game: 'repo', usage }] });
  assert.deepEqual(validateCatalog(cat({ keys: [{ key: 'F7', text: { en: 'Menu', de: 'Menü' } }], steps: ['Do this.'] })), []);
  assert.ok(validateCatalog(cat({ keys: [{ text: 'no key' }] })).some((e) => /usage\.keys\[0\]\.key/.test(e)));
  assert.ok(validateCatalog(cat({ steps: 'not a list' })).some((e) => /usage\.steps/.test(e)));
  assert.ok(validateCatalog(cat({ other: 1 })).some((e) => /unknown field/.test(e)));
});

test('demo mode only when the flag is set', async () => {
  const mod = { id: 'm', name: 'Mod', version: '1', summary: 'S', files: [{ path: 'BepInEx/plugins/M/M.dll' }] };
  const read = (opts) => JSON.parse(overlayFiles([mod], { dll: Buffer.from('x'), ...opts })[1].data);
  assert.equal(read({}).demo, undefined);
  assert.equal(read({ demo: 'yes' }).demo, undefined);
  assert.equal(read({ demo: 1 }).demo, undefined);
  assert.equal(read({ demo: true, gameName: 'R.E.P.O.', packName: 'Freitagabend' }).demo, true);
  // a real launch never passes the flag
  const s = h.scene();
  const ctxOverlay = { enabled: true, hotkey: 'F10', lang: 'en' };
  const extra = overlayFiles(s.plan.mods, { ...ctxOverlay, dll: Buffer.from('x') });
  await s.engine.prepare(s.plan, { ...s.files, extra });
  const json = JSON.parse(fs.readFileSync(path.join(s.gameDir, OVERLAY_DIR, 'kitbash-overlay.json'), 'utf8'));
  assert.equal(json.demo, undefined);
  h.cleanupDir(s.root);
});
