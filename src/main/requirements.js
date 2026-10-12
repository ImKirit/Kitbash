// Checks the structured requirements of a mod on this PC. Read only.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { compareVersions, parseVersion } = require('./util');
const steam = require('./steam');

// Looks for Minecraft Java client jars in the usual launcher folders.
// Returns the versions found, newest first.
function findMinecraftVersions(extraPath, env = process.env) {
  const appdata = env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const roots = [
    path.join(appdata, '.minecraft'),
    path.join(appdata, 'ModrinthApp', 'meta'),
    path.join(appdata, 'com.modrinth.theseus', 'meta'),
    path.join(appdata, 'PrismLauncher'),
    path.join(appdata, 'norisk'),
    path.join(appdata, 'gdlauncher_next', 'datastore'),
    path.join(env.USERPROFILE || os.homedir(), 'curseforge', 'minecraft', 'Install'),
  ];
  if (extraPath) roots.unshift(extraPath);

  const found = new Map();
  const add = (version, file) => { if (parseVersion(version) && !found.has(version)) found.set(version, file); };

  // <root>/**/versions/<v>/<v>.jar, at most four folders deep.
  function scan(dir, depth) {
    let names;
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of names) {
      if (!d.isDirectory()) continue;
      const full = path.join(dir, d.name);
      if (d.name === 'versions') {
        let vs = [];
        try { vs = fs.readdirSync(full, { withFileTypes: true }); } catch { /* unreadable */ }
        for (const v of vs) {
          if (!v.isDirectory()) continue;
          const jar = path.join(full, v.name, v.name + '.jar');
          if (/^\d+\.\d+(\.\d+)?$/.test(v.name) && fs.existsSync(jar)) add(v.name, jar);
        }
      } else if (depth < 4 && !/^(assets|libraries|natives|logs|saves|mods|resourcepacks|cache)$/i.test(d.name)) {
        scan(full, depth + 1);
      }
    }
  }
  for (const root of roots) {
    scan(root, 0);
    // Prism and MultiMC keep the client jar as a library.
    const lib = path.join(root, 'libraries', 'com', 'mojang', 'minecraft');
    let vs = [];
    try { vs = fs.readdirSync(lib); } catch { /* not there */ }
    for (const v of vs) {
      const jar = path.join(lib, v, `minecraft-${v}-client.jar`);
      if (/^\d+\.\d+(\.\d+)?$/.test(v) && fs.existsSync(jar)) add(v, jar);
    }
  }
  return [...found.entries()]
    .map(([version, file]) => ({ version, file }))
    .sort((a, b) => compareVersions(b.version, a.version));
}

// ctx: { steamPath, minecraftPath }
// Returns one result per requirement: { type, level, ok, detail, ... }.
function checkRequirements(mod, ctx) {
  const results = [];
  for (const req of mod.requirements || []) {
    const r = { type: req.type, level: req.level, text: req.text || null, ok: false, detail: '' };
    if (req.type === 'steam-game') {
      r.name = req.name;
      r.appId = req.appId;
      const app = ctx.steamPath ? steam.findApp(ctx.steamPath, req.appId) : null;
      r.ok = !!(app && app.installed);
      r.detail = r.ok ? app.dir : '';
    } else if (req.type === 'minecraft-java') {
      r.minVersion = req.minVersion || null;
      const versions = findMinecraftVersions(ctx.minecraftPath);
      const fit = versions.find((v) => !req.minVersion || compareVersions(v.version, req.minVersion) >= 0);
      r.ok = !!fit;
      r.detail = fit ? fit.version : (versions[0] ? versions[0].version : '');
      r.foundOlder = !fit && versions.length > 0;
    }
    results.push(r);
  }
  return results;
}

module.exports = { checkRequirements, findMinecraftVersions };
