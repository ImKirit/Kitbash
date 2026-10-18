'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { merge, empty } = require('../src/main/sync');
const { gameArt, CDN } = require('../src/main/art');
const h = require('./helpers');

test('sync merge: union of packs, newer edit wins, deletions win only when newer', () => {
  const local = {
    packs: [
      { id: 'a', name: 'Local A', updatedAt: '2026-10-18T10:00:00Z' },
      { id: 'b', name: 'Local B old', updatedAt: '2026-10-01T10:00:00Z' },
      { id: 'c', name: 'Local C', updatedAt: '2026-10-18T12:00:00Z' },
    ],
    favorites: ['m1'],
    settings: { values: { theme: 'light', lang: 'de', minecraftPath: 'C:\\secret' }, updatedAt: '2026-10-18T09:00:00Z' },
    history: [{ id: 'h1', startedAt: '2026-10-17T10:00:00Z' }],
  };
  const remote = {
    packs: [
      { id: 'b', name: 'Remote B new', updatedAt: '2026-10-15T10:00:00Z' },
      { id: 'd', name: 'Remote D', updatedAt: '2026-10-10T10:00:00Z' },
    ],
    favorites: ['m2', 'm1'],
    settings: { values: { theme: 'dark' }, updatedAt: '2026-10-18T11:00:00Z' },
    history: [{ id: 'h2', startedAt: '2026-10-18T10:00:00Z' }, { id: 'h1', startedAt: '2026-10-17T10:00:00Z' }],
    deleted: { packs: [{ id: 'a', at: '2026-10-18T11:00:00Z' }, { id: 'c', at: '2026-10-18T11:00:00Z' }] },
  };
  const m = merge(local, remote);
  assert.deepEqual(m.packs.map((p) => p.name).sort(), ['Local C', 'Remote B new', 'Remote D']);
  assert.deepEqual(m.favorites.sort(), ['m1', 'm2']);
  assert.deepEqual(m.settings.values, { theme: 'dark' }, 'remote settings were changed later, local paths never sync');
  assert.deepEqual(m.history.map((x) => x.id), ['h2', 'h1']);
  // merging is stable: doing it again changes nothing
  const again = merge(m, remote);
  assert.deepEqual(again.packs.map((p) => p.id).sort(), m.packs.map((p) => p.id).sort());
});

test('sync merge: first login with an empty account keeps everything local', () => {
  const local = { packs: [{ id: 'x', name: 'X', updatedAt: '2026-10-18T10:00:00Z' }], favorites: ['f'], settings: { values: { lang: 'de', theme: 'dark' }, updatedAt: '2026-10-18T10:00:00Z' }, history: [] };
  const m = merge(local, null);
  assert.deepEqual(m.packs, local.packs);
  assert.deepEqual(m.favorites, ['f']);
  assert.deepEqual(m.settings.values, { lang: 'de', theme: 'dark' });
  assert.deepEqual(merge(empty(), empty()).packs, []);
});

function fakeSteam(root, appId, files) {
  const dir = path.join(root, 'steam', 'appcache', 'librarycache', String(appId));
  for (const [rel, data] of Object.entries(files)) h.write(dir, rel, data);
  return path.join(root, 'steam');
}

test('game art: exe icon first, then the local Steam cache, then the CDN, cached', async () => {
  const root = h.tmpDir('art');
  const game = { id: 'repo', steam: { appId: 3241660 } };
  const asked = [];
  const fetch = async (url) => { asked.push(url); return Buffer.alloc(200, 1); };
  const cacheDir = path.join(root, 'cache');

  // 1. installed exe wins for the icon, Steam cache provides the banner
  const steamPath = fakeSteam(root, 3241660, { 'aa/library_hero.jpg': 'hero', 'bb/logo.png': 'logo', [ 'c'.repeat(40) + '.jpg']: 'icon' });
  let art = await gameArt(game, { cacheDir, steamPath, exeIcon: () => 'C:/exe-icon.png', fetch });
  assert.equal(art.icon, 'C:/exe-icon.png');
  assert.equal(art.source.icon, 'exe');
  assert.equal(art.source.banner, 'steam-cache');
  assert.ok(art.banner.endsWith('library_hero.jpg'));
  assert.deepEqual(asked, [], 'nothing downloaded while Steam has the pictures');

  // 2. game not installed: Steam's cached icon
  art = await gameArt(game, { cacheDir, steamPath, exeIcon: () => null, fetch });
  assert.equal(art.source.icon, 'steam-cache');
  assert.ok(art.icon.endsWith('c'.repeat(40) + '.jpg'));

  // 3. nothing local at all: Steam CDN by app id, then cached
  const other = { id: 'peak', steam: { appId: 3527290 } };
  art = await gameArt(other, { cacheDir, steamPath, exeIcon: () => null, fetch });
  assert.equal(art.source.banner, 'steam-cdn');
  assert.equal(asked[0], CDN + '3527290/library_hero.jpg');
  assert.ok(fs.existsSync(art.banner));
  assert.ok(art.icon, 'falls back to a picture for the small icon');
  const n = asked.length;
  await gameArt(other, { cacheDir, steamPath, exeIcon: () => null, fetch });
  assert.equal(asked.length, n, 'second time from the cache');

  // 4. offline and nothing cached: no pictures, the UI shows a letter
  art = await gameArt({ id: 'x', steam: { appId: 1 } }, { cacheDir, steamPath, exeIcon: () => null, fetch, online: false });
  assert.equal(art.icon, null);
  assert.equal(art.banner, null);
  h.cleanupDir(root);
});

test('catalog: the upcoming list is optional, checked when present, ignored by the mod rules', () => {
  const { validateCatalog } = require('../src/main/schema');
  const base = { schemaVersion: 1, games: [], mods: [] };
  assert.deepEqual(validateCatalog(base), []);
  assert.deepEqual(validateCatalog({ ...base, upcoming: [{ id: 'eldenring-minecraft', name: 'Elden Ring', steamAppId: 1245620, featured: true, title: { en: 'Elden Ring x Minecraft' }, details: ['In development'] }] }), []);
  assert.ok(validateCatalog({ ...base, upcoming: [{ id: 'Bad Id', name: 'x' }] }).some((e) => /upcoming\[0\]\.id/.test(e)));
  assert.ok(validateCatalog({ ...base, upcoming: [{ id: 'ok-id', name: 'x', steamAppId: -1 }] }).some((e) => /steamAppId/.test(e)));
  assert.ok(validateCatalog({ ...base, upcoming: 'nope' }).length);
});
