// Builds fake game folders, loader archives and mod packages in a temp
// directory, so the engine can be exercised without a real game.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeZip } = require('../src/main/zip');
const { sha256 } = require('../src/main/util');
const { Engine } = require('../src/main/engine');

function tmpDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kitbash-' + label + '-'));
}

function write(base, rel, content) {
  const file = path.join(base, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// Every file below dir with its hash, plus empty folders. Two snapshots are
// equal exactly when the folders are byte for byte the same.
function snapshot(dir) {
  const out = {};
  (function walk(d, rel) {
    const names = fs.readdirSync(d).sort();
    if (rel && names.length === 0) out[rel + '/'] = 'dir';
    for (const n of names) {
      const full = path.join(d, n);
      const r = rel ? rel + '/' + n : n;
      if (fs.lstatSync(full).isDirectory()) walk(full, r);
      else out[r] = sha256(fs.readFileSync(full));
    }
  })(dir, '');
  return out;
}

const GAME = {
  id: 'fakegame', name: 'Fake Game', status: 'available', platform: 'steam',
  steam: { appId: 4242 }, executable: 'Fake.exe', processName: 'Fake.exe',
  engine: 'unity-mono', antiCheat: false,
};

function makeGameDir(root) {
  const dir = path.join(root, 'game');
  write(dir, 'Fake.exe', 'MZ fake exe');
  write(dir, 'UnityPlayer.dll', 'unity player');
  write(dir, 'Fake_Data/Managed/Assembly-CSharp.dll', 'game code');
  write(dir, 'Fake_Data/level0', Buffer.alloc(2048, 7));
  write(dir, 'MonoBleedingEdge/etc/config', 'mono');
  return dir;
}

// A manual BepInEx install with someone else's plugins and settings.
function addForeignLoader(dir) {
  write(dir, 'winhttp.dll', 'foreign proxy dll, older build');
  write(dir, 'doorstop_config.ini', '[General]\nenabled=true\n# hand edited\n');
  write(dir, '.doorstop_version', '4.3.0');
  write(dir, 'changelog.txt', 'foreign changelog');
  write(dir, 'BepInEx/core/BepInEx.dll', 'foreign core 5.4.21');
  write(dir, 'BepInEx/config/BepInEx.cfg', '[Logging.Console]\nEnabled = true\n');
  write(dir, 'BepInEx/config/someone.else.cfg', 'volume = 11\n');
  write(dir, 'BepInEx/plugins/OtherMod/OtherMod.dll', Buffer.alloc(4096, 3));
  write(dir, 'BepInEx/plugins/OtherMod/data/save.bin', Buffer.from([1, 2, 3, 4, 5]));
  write(dir, 'BepInEx/LogOutput.log', 'old log\n');
  fs.mkdirSync(path.join(dir, 'BepInEx', 'patchers'), { recursive: true });
  write(dir, 'MelonLoader/net6/MelonLoader.dll', 'another loader');
  write(dir, 'version.dll', 'melon proxy');
}

function makeLoader(root, extraEntries = []) {
  const buf = writeZip([
    { name: 'BepInEx/core/BepInEx.dll', data: 'launcher core 5.4.23.5' },
    { name: 'BepInEx/core/0Harmony.dll', data: 'harmony' },
    { name: 'winhttp.dll', data: 'doorstop proxy' },
    { name: 'doorstop_config.ini', data: '[General]\nenabled=true\n' },
    { name: '.doorstop_version', data: '4.5.0' },
    { name: 'changelog.txt', data: 'changes' },
    ...extraEntries,
  ], { raw: true });
  const file = path.join(root, 'loader.zip');
  fs.writeFileSync(file, buf);
  return {
    file,
    loader: {
      id: 'bepinex5-x64', type: 'bepinex5', name: 'BepInEx', version: '5.4.23.5',
      url: 'https://github.com/BepInEx/BepInEx/releases/download/v5.4.23.5/BepInEx_win_x64_5.4.23.5.zip',
      size: buf.length, sha256: sha256(buf),
    },
  };
}

// files: { 'BepInEx/plugins/X/X.dll': content }
function makeMod(root, id, files, persist = [], extra = {}) {
  const entries = Object.entries(files).map(([name, data]) => ({ name, data: Buffer.from(data) }));
  const buf = writeZip(entries, { raw: true });
  const file = path.join(root, id + '.zip');
  fs.writeFileSync(file, buf);
  const mod = {
    id, game: GAME.id, name: id, version: '1.0.0', author: 'test', status: 'experimental',
    summary: 'test mod', description: 'test mod', loader: 'bepinex5-x64',
    package: { url: `mods/${id}.zip`, size: buf.length, sha256: sha256(buf) },
    files: entries.map((e) => ({ path: e.name, size: e.data.length, sha256: sha256(e.data) })),
    persist,
    ...extra,
  };
  return { file, mod };
}

// A ready scene: game folder, loader, two mods, engine.
function scene(opts = {}) {
  const root = tmpDir('scene');
  const gameDir = makeGameDir(root);
  if (opts.foreign) addForeignLoader(gameDir);
  const { file: loaderZip, loader } = makeLoader(root);
  const a = makeMod(root, 'alpha', {
    'BepInEx/plugins/Alpha/Alpha.dll': 'alpha code',
    'BepInEx/plugins/Alpha/extra.dat': 'alpha extra',
  }, ['BepInEx/config/dev.test.alpha.cfg', 'BepInEx/config/Alpha']);
  const b = makeMod(root, 'beta', { 'BepInEx/plugins/Beta/Beta.dll': 'beta code' }, ['BepInEx/config/dev.test.beta.cfg']);
  const dataDir = path.join(root, 'data');
  const state = { running: false };
  const steps = [];
  const engine = new Engine({
    dataDir,
    isRunning: async () => state.running,
    launcherVersion: '0.1.0',
    hook: (s) => { steps.push(s); if (opts.hook) opts.hook(s); },
  });
  return {
    root, gameDir, dataDir, engine, state, steps, loader,
    plan: { game: GAME, gameDir, loader, mods: [a.mod, b.mod] },
    files: { loaderZip, modZips: { alpha: a.file, beta: b.file } },
    mods: { alpha: a, beta: b },
    newEngine: (extra = {}) => new Engine({ dataDir, isRunning: async () => state.running, launcherVersion: '0.1.0', ...extra }),
  };
}

function cleanupDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { tmpDir, write, snapshot, GAME, makeGameDir, addForeignLoader, makeLoader, makeMod, scene, cleanupDir };
