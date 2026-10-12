'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Sources, sourceIdFor } = require('../src/main/sources');
const { parseSource, normalizeSourceUrl, resolvePackageUrl } = require('../src/main/catalog');
const { Packs, resolvePack, exportPack, importPack } = require('../src/main/packs');
const { validateCatalog } = require('../src/main/schema');
const { BUILTIN_LOADERS } = require('../src/main/loaders');
const { writeZip } = require('../src/main/zip');
const { sha256 } = require('../src/main/util');
const h = require('./helpers');

const GAME = { id: 'repo', name: 'R.E.P.O.', status: 'available', platform: 'steam', steam: { appId: 1 }, executable: 'REPO.exe', processName: 'REPO.exe', engine: 'unity-mono', antiCheat: false };

function modEntry(id, game, dll, version = '1.0.0', url) {
  const data = Buffer.from(dll);
  const p = `BepInEx/plugins/${id}/${id}.dll`;
  const zip = writeZip([{ name: p, data }]);
  return {
    zip,
    entry: {
      id, game, name: id, version, author: 'someone', status: 'experimental', summary: 's', description: 'd', loader: 'bepinex5-x64',
      package: { url: url || `mods/${id}-${version}.zip`, size: zip.length, sha256: sha256(zip) },
      files: [{ path: p, size: data.length, sha256: sha256(data) }], persist: [`BepInEx/config/${id}.cfg`],
    },
  };
}

// Writes a catalog folder: { games, mods: [modEntry()], loaders }
function writeCatalog(dir, { games = [], mods = [], loaders }) {
  fs.mkdirSync(path.join(dir, 'mods'), { recursive: true });
  for (const m of mods) if (!/^https:/.test(m.entry.package.url)) fs.writeFileSync(path.join(dir, m.entry.package.url), m.zip);
  const cat = { schemaVersion: 1, updated: new Date().toISOString(), games, mods: mods.map((m) => m.entry) };
  if (loaders) cat.loaders = loaders;
  fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify(cat));
}

function setup() {
  const root = h.tmpDir('sources');
  const official = path.join(root, 'official');
  const third = path.join(root, 'third');
  writeCatalog(official, { games: [GAME], mods: [modEntry('mimic', 'repo', 'official mimic'), modEntry('portal', 'repo', 'official portal')] });
  return { root, official, third, dataDir: path.join(root, 'data') };
}

test('address forms people paste are turned into a catalog URL', () => {
  assert.equal(normalizeSourceUrl('https://github.com/Someone/Cool-Mods'), 'https://raw.githubusercontent.com/Someone/Cool-Mods/HEAD/catalog.json');
  assert.equal(normalizeSourceUrl('https://github.com/Someone/Cool-Mods.git'), 'https://raw.githubusercontent.com/Someone/Cool-Mods/HEAD/catalog.json');
  assert.equal(normalizeSourceUrl('https://github.com/a/b/blob/main/sub/catalog.json'), 'https://raw.githubusercontent.com/a/b/main/sub/catalog.json');
  assert.equal(normalizeSourceUrl('https://example.org/x/catalog.json'), 'https://example.org/x/catalog.json');
  assert.throws(() => parseSource('http://example.org/catalog.json'), (e) => e.code === 'source-invalid');
  assert.throws(() => parseSource('ftp://example.org/catalog.json'), (e) => e.code === 'source-invalid');
  assert.throws(() => parseSource('https://user:pw@example.org/catalog.json'), (e) => e.code === 'source-invalid');
  assert.throws(() => parseSource('https://example.org/catalog.json?x=1'), (e) => e.code === 'source-invalid');
});

test('package addresses: same host, or GitHub inside the same repository, nothing else', () => {
  const gh = parseSource('https://raw.githubusercontent.com/someone/cool-mods/main/catalog.json');
  const ok = (src, url) => resolvePackageUrl(src, url);
  const no = (src, url) => assert.throws(() => resolvePackageUrl(src, url), (e) => e.code === 'url-not-allowed' || /unsafe|illegal|absolute/.test(e.message), 'accepted ' + url);

  assert.equal(ok(gh, 'mods/a.zip').url, 'https://raw.githubusercontent.com/someone/cool-mods/main/mods/a.zip');
  assert.deepEqual(ok(gh, 'mods/a.zip').redirectHosts, []);
  assert.ok(ok(gh, 'https://raw.githubusercontent.com/someone/cool-mods/v2/a.zip').url);
  const rel = ok(gh, 'https://github.com/Someone/Cool-Mods/releases/download/v1/a.zip');
  assert.deepEqual(rel.redirectHosts, ['objects.githubusercontent.com', 'release-assets.githubusercontent.com']);

  no(gh, 'https://raw.githubusercontent.com/other/repo/main/a.zip');       // other repository, same host
  no(gh, 'https://github.com/other/repo/releases/download/v1/a.zip');
  no(gh, 'https://github.com/someone/cool-mods-evil/releases/download/v1/a.zip');
  no(gh, 'https://evil.example/a.zip');
  no(gh, 'http://raw.githubusercontent.com/someone/cool-mods/main/a.zip'); // not https
  no(gh, 'https://x:y@github.com/someone/cool-mods/a.zip');
  no(gh, '../other/a.zip');
  no(gh, 'file:///C:/Windows/a.zip');

  const own = parseSource('https://mods.example.org/repo/catalog.json');
  assert.equal(ok(own, 'https://mods.example.org/files/a.zip').url, 'https://mods.example.org/files/a.zip');
  no(own, 'https://cdn.example.org/files/a.zip');
  no(own, 'https://github.com/someone/cool-mods/releases/download/v1/a.zip');
  no(own, 'https://mods.example.org.evil.com/a.zip');
});

test('an unofficial source is namespaced and can never shadow official mods or games', async () => {
  const s = setup();
  writeCatalog(s.third, {
    games: [
      { ...GAME, name: 'R.E.P.O. (hijacked)', executable: 'evil.exe', processName: 'evil.exe', antiCheat: false },
      { id: 'lethal', name: 'Another Game', status: 'available', platform: 'steam', steam: { appId: 2 }, executable: 'A.exe', processName: 'A.exe', engine: 'unity-mono', antiCheat: false },
    ],
    mods: [modEntry('mimic', 'repo', 'third party pretending to be mimic'), modEntry('flashlight', 'repo', 'third flashlight'), modEntry('thing', 'lethal', 'for their own game')],
    // a third-party catalog trying to redirect the loader download
    loaders: { 'bepinex5-x64': { type: 'bepinex5', name: 'BepInEx', version: '5.4.23.5', url: 'https://github.com/BepInEx/BepInEx/releases/download/v9/evil.zip', size: 5, sha256: 'a'.repeat(64) } },
  });
  const src = new Sources({ dataDir: s.dataDir, officialUrl: s.official });
  const entry = src.add(s.third, true);
  const m = await src.refresh();
  const tid = entry.id;

  assert.deepEqual(m.mods.map((x) => x.id).sort(), ['mimic', 'portal', `flashlight@${tid}`, `mimic@${tid}`, `thing@${tid}`].sort());
  const official = m.mods.find((x) => x.id === 'mimic');
  assert.equal(official.source.official, true);
  assert.equal(official.package.sha256, modEntry('mimic', 'repo', 'official mimic').entry.package.sha256);
  const theirs = m.mods.find((x) => x.id === `mimic@${tid}`);
  assert.equal(theirs.source.official, false);
  assert.equal(theirs.localId, 'mimic');
  assert.equal(theirs.game, 'repo', 'attaches to the official game');

  const repo = m.games.filter((g) => g.id === 'repo');
  assert.equal(repo.length, 1);
  assert.equal(repo[0].executable, 'REPO.exe', 'the official game definition stays');
  assert.equal(repo[0].source.official, true);
  const own = m.games.find((g) => g.id === `lethal@${tid}`);
  assert.ok(own && own.source.official === false);
  assert.equal(m.mods.find((x) => x.id === `thing@${tid}`).game, `lethal@${tid}`);

  // the loader is the built-in one, whatever the third-party catalog says
  assert.equal(m.loaders['bepinex5-x64'].url, BUILTIN_LOADERS['bepinex5-x64'].url);
  assert.equal(m.loaders['bepinex5-x64'].sha256, BUILTIN_LOADERS['bepinex5-x64'].sha256);
  await assert.rejects(src.loaderFile({ id: 'bepinex5-x64', url: 'https://github.com/BepInEx/BepInEx/releases/download/v9/evil.zip', sha256: 'a'.repeat(64) }), (e) => e.code === 'loader-unknown');
  h.cleanupDir(s.root);
});

test('adding a source needs the accepted warning, the official one cannot be added twice or removed', async () => {
  const s = setup();
  writeCatalog(s.third, { mods: [modEntry('flashlight', 'repo', 'x')] });
  const src = new Sources({ dataDir: s.dataDir, officialUrl: 'https://raw.githubusercontent.com/ImKirit/Kitbash-Mods/main/catalog.json', fetch: async () => { throw new Error('offline'); } });
  assert.throws(() => src.add(s.third), (e) => e.code === 'warning-not-accepted');
  assert.throws(() => src.add(s.third, 'yes'), (e) => e.code === 'warning-not-accepted');
  assert.throws(() => src.add('https://github.com/ImKirit/Kitbash-Mods/blob/main/catalog.json', true), (e) => e.code === 'source-duplicate');
  src.add(s.third, true);
  assert.throws(() => src.add(s.third, true), (e) => e.code === 'source-duplicate');
  assert.throws(() => src.remove('official'), (e) => e.code === 'source-official');
  assert.notEqual(sourceIdFor('https://raw.githubusercontent.com/a/b/main/catalog.json'), sourceIdFor('https://raw.githubusercontent.com/a/c/main/catalog.json'));
  h.cleanupDir(s.root);
});

test('lazy downloads: nothing is fetched until asked, updates are noticed, packages can be deleted', async () => {
  const s = setup();
  const src = new Sources({ dataDir: s.dataDir, officialUrl: s.official });
  let m = await src.refresh();
  let mimic = m.mods.find((x) => x.id === 'mimic');
  assert.equal(src.downloadState(mimic).state, 'none');
  assert.deepEqual(src.library(), []);
  assert.ok(!fs.existsSync(path.join(s.dataDir, 'cache', 'mods')), 'listing must not download anything');

  let seen = 0;
  const file = await src.ensurePackage(mimic, () => { seen++; });
  assert.equal(sha256(fs.readFileSync(file)), mimic.package.sha256);
  assert.equal(src.downloadState(mimic).state, 'ready');
  assert.equal(src.downloadState(m.mods.find((x) => x.id === 'portal')).state, 'none');
  assert.deepEqual(src.library().map((x) => [x.id, x.version]), [['mimic', '1.0.0']]);

  // works without the source once the package is on disk
  fs.renameSync(s.official, s.official + '-gone');
  const offline = new Sources({ dataDir: s.dataDir, officialUrl: s.official });
  offline.loadCached();
  const om = await offline.refresh();
  assert.equal(om.sources[0].offline, true);
  assert.ok(om.sources[0].error);
  const cachedMimic = om.mods.find((x) => x.id === 'mimic');
  assert.equal(await offline.ensurePackage(cachedMimic), file);
  await assert.rejects(offline.ensurePackage(om.mods.find((x) => x.id === 'portal')));
  fs.renameSync(s.official + '-gone', s.official);

  // a new version in the catalog: the old package is flagged, then replaced
  writeCatalog(s.official, { games: [GAME], mods: [modEntry('mimic', 'repo', 'official mimic two', '1.1.0'), modEntry('portal', 'repo', 'official portal')] });
  m = await src.refresh();
  mimic = m.mods.find((x) => x.id === 'mimic');
  assert.deepEqual(src.downloadState(mimic), { state: 'update', version: '1.0.0', size: fs.statSync(file).size });
  const file2 = await src.ensurePackage(mimic);
  assert.equal(src.downloadState(mimic).state, 'ready');
  assert.ok(!fs.existsSync(file), 'the old build is removed');

  assert.equal(src.deletePackage('mimic'), true);
  assert.ok(!fs.existsSync(file2));
  assert.equal(src.downloadState(mimic).state, 'none');
  assert.deepEqual(src.library(), []);
  h.cleanupDir(s.root);
});

test('a package that does not match the catalog is not kept', async () => {
  const s = setup();
  const src = new Sources({ dataDir: s.dataDir, officialUrl: s.official });
  const m = await src.refresh();
  const mimic = m.mods.find((x) => x.id === 'mimic');
  fs.appendFileSync(path.join(s.official, mimic.package.url), 'tampered');
  await assert.rejects(src.ensurePackage(mimic), (e) => e.code === 'hash-mismatch');
  assert.equal(src.downloadState(mimic).state, 'none');
  h.cleanupDir(s.root);
});

test('unofficial sources: first download needs a confirmation, removing a source removes its packages', async () => {
  const s = setup();
  writeCatalog(s.third, { mods: [modEntry('flashlight', 'repo', 'third flashlight')] });
  const src = new Sources({ dataDir: s.dataDir, officialUrl: s.official });
  const entry = src.add(s.third, true);
  const m = await src.refresh();
  const mod = m.mods.find((x) => x.id === `flashlight@${entry.id}`);
  assert.equal(m.sources.find((x) => x.id === entry.id).official, false);
  assert.equal(src.needsConfirmation(mod), true);
  assert.equal(src.needsConfirmation(m.mods.find((x) => x.id === 'mimic')), false);
  await assert.rejects(src.ensurePackage(mod), (e) => e.code === 'confirmation-needed' && e.source === entry.id);
  assert.equal(src.downloadState(mod).state, 'none');

  src.confirmSource(entry.id);
  const file = await src.ensurePackage(mod);
  await src.ensurePackage(m.mods.find((x) => x.id === 'mimic'));
  assert.ok(file.includes(path.join('cache', 'mods', entry.id)));
  assert.equal(src.library().length, 2);

  assert.equal(src.remove(entry.id), true);
  assert.ok(!fs.existsSync(file));
  assert.deepEqual(src.library().map((x) => x.id), ['mimic']);
  assert.deepEqual(src.merged().mods.map((x) => x.id).sort(), ['mimic', 'portal']);
  h.cleanupDir(s.root);
});

test('a catalog with a package on a foreign host is refused as a whole', async () => {
  const s = setup();
  const files = {
    'https://mods.example.org/catalog.json': Buffer.from(JSON.stringify({
      schemaVersion: 1, games: [], mods: [modEntry('xmod', 'repo', 'x', '1.0.0', 'https://evil.example/x.zip').entry],
    })),
  };
  const asked = [];
  const src = new Sources({
    dataDir: s.dataDir, officialUrl: s.official,
    fetch: async (url, opts) => { asked.push([url, opts.redirectHosts]); if (!files[url]) throw new Error('404'); return files[url]; },
  });
  const e = src.add('https://mods.example.org/catalog.json', true);
  const m = await src.refresh();
  const info = m.sources.find((x) => x.id === e.id);
  assert.equal(info.error.code, 'catalog-invalid');
  assert.match(info.error.message, /evil\.example/);
  assert.equal(m.mods.filter((x) => !x.source.official).length, 0);
  assert.deepEqual(asked, [['https://mods.example.org/catalog.json', []]], 'only the catalog itself was requested, without redirects');
  h.cleanupDir(s.root);
});

test('schema: a third-party catalog may use official games, but not unknown ones', () => {
  const mod = modEntry('xmod', 'repo', 'x').entry;
  assert.ok(validateCatalog({ schemaVersion: 1, games: [], mods: [mod] }).some((e) => /unknown game/.test(e)));
  assert.deepEqual(validateCatalog({ schemaVersion: 1, games: [], mods: [mod] }, { games: [['repo', GAME]] }), []);
  assert.ok(validateCatalog({ schemaVersion: 1, games: [{ ...GAME, antiCheat: true }], mods: [] }).some((e) => /anti-cheat/.test(e)));
  assert.ok(validateCatalog({ schemaVersion: 1, games: [GAME], mods: [{ ...mod, files: [{ ...mod.files[0], path: 'REPO_Data/Managed/x.dll' }] }] }).some((e) => /outside the folders/.test(e)));
  assert.ok(validateCatalog({ schemaVersion: 1, games: [GAME], mods: [{ ...mod, persist: ['BepInEx/plugins/xmod'] }] }).some((e) => /overlaps/.test(e)));
  assert.ok(validateCatalog({ schemaVersion: 2, games: [], mods: [] })[0].includes('version'));
});

test('modpacks: save, resolve against the catalogs, export and import as a code', async () => {
  const s = setup();
  writeCatalog(s.third, { mods: [modEntry('flashlight', 'repo', 'third flashlight', '2.0.0')] });
  const src = new Sources({ dataDir: s.dataDir, officialUrl: s.official });
  const entry = src.add(s.third, true);
  const m = await src.refresh();
  // pretend the unofficial source is a real https one for the export
  m.sources.find((x) => x.id === entry.id).url = 'https://raw.githubusercontent.com/someone/cool-mods/HEAD/catalog.json';

  const packs = new Packs(s.dataDir);
  const pack = packs.save({ name: '  Friday night  ', gameId: 'repo', mods: [{ id: 'mimic', version: '1.0.0' }, { id: 'portal', version: '0.9.0' }, { id: `flashlight@${entry.id}`, version: '2.0.0' }, { id: 'mimic', version: '1.0.0' }, { id: '../evil' }] });
  assert.equal(pack.name, 'Friday night');
  assert.equal(pack.mods.length, 3, 'duplicates and bad ids are dropped');
  assert.equal(new Packs(s.dataDir).get(pack.id).name, 'Friday night', 'stored on disk');
  assert.throws(() => packs.save({ name: '', gameId: 'repo', mods: [] }), (e) => e.code === 'pack-name');

  const r = resolvePack(pack, m);
  assert.equal(r.game.id, 'repo');
  assert.deepEqual(r.mods.map((x) => x.id), ['mimic', 'portal', `flashlight@${entry.id}`]);
  assert.deepEqual(r.changed, [{ id: 'portal', packed: '0.9.0', current: '1.0.0' }]);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(resolvePack({ ...pack, mods: [...pack.mods, { id: 'gone', version: '1' }] }, m).missing, ['gone']);

  const code = exportPack(pack, m);
  assert.match(code, /^KB1-[A-Za-z0-9_-]+$/);
  const back = importPack('  ' + code.slice(0, 20) + '\n' + code.slice(20) + '  ');
  assert.deepEqual(back.pack, { name: 'Friday night', gameId: 'repo', mods: pack.mods });
  assert.deepEqual(back.sources, [{ id: entry.id, url: 'https://raw.githubusercontent.com/someone/cool-mods/HEAD/catalog.json' }]);

  // on a PC without that source the pack resolves partly, nothing is added silently
  const plain = new Sources({ dataDir: path.join(s.root, 'other'), officialUrl: s.official });
  const pm = await plain.refresh();
  const pr = resolvePack(back.pack, pm);
  assert.deepEqual(pr.missing, [`flashlight@${entry.id}`]);
  assert.equal(plain.list.length, 0);

  assert.throws(() => importPack('hello'), (e) => e.code === 'pack-code');
  assert.throws(() => importPack('KB1-!!!!'), (e) => e.code === 'pack-code');
  const evil = 'KB1-' + Buffer.from(JSON.stringify({ v: 1, name: 'x', game: 'repo', sources: [{ id: 'a-b', url: 'http://evil/catalog.json' }, { id: '../x', url: 'https://ok/c.json' }], mods: [{ id: '../../x', source: 'official' }, { id: 'ok-mod', source: '../s' }, { id: 'fine', source: 'official', version: '1' }] })).toString('base64url');
  const parsed = importPack(evil);
  assert.deepEqual(parsed.sources, []);
  assert.deepEqual(parsed.pack.mods, [{ id: 'fine', version: '1' }]);

  assert.equal(packs.remove(pack.id), true);
  assert.equal(packs.all().length, 0);
  h.cleanupDir(s.root);
});
