// Finds Steam, its library folders and installed games. Read only.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Valve's text KeyValues format: "key" "value" pairs and "key" { ... } blocks.
function parseVdf(text) {
  let i = 0;
  const n = text.length;
  function skip() {
    while (i < n) {
      const c = text[i];
      if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; }
      else if (c === ' ' || c === '\t' || c === '\r' || c === '\n') i++;
      else break;
    }
  }
  function token() {
    skip();
    if (i >= n) return null;
    if (text[i] === '{' || text[i] === '}') return text[i++];
    if (text[i] === '"') {
      i++;
      let out = '';
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < n) {
          const e = text[i + 1];
          out += e === 'n' ? '\n' : e === 't' ? '\t' : e;
          i += 2;
        } else out += text[i++];
      }
      i++;
      return { s: out };
    }
    let out = '';
    while (i < n && !/[\s{}"]/.test(text[i])) out += text[i++];
    return { s: out };
  }
  function block() {
    const obj = {};
    for (;;) {
      const k = token();
      if (k === null || k === '}') return obj;
      if (k === '{') continue;
      const v = token();
      if (v === '{') obj[k.s] = block();
      else if (v && v.s !== undefined) obj[k.s] = v.s;
      else return obj;
    }
  }
  return block();
}

function regValue(key, name) {
  try {
    const out = execFileSync('reg', ['query', key, '/v', name], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = new RegExp(name + '\\s+REG_\\w+\\s+(.+)', 'i').exec(out);
    return m ? m[1].trim() : null;
  } catch { return null; }
}

// Returns { path, exe } or null.
function findSteam() {
  const candidates = [];
  if (process.platform === 'win32') {
    candidates.push(regValue('HKCU\\Software\\Valve\\Steam', 'SteamPath'));
    candidates.push(regValue('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'));
    candidates.push(regValue('HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'));
    candidates.push('C:\\Program Files (x86)\\Steam');
  }
  for (const c of candidates) {
    if (!c) continue;
    const dir = path.normalize(c);
    const exe = path.join(dir, 'steam.exe');
    if (fs.existsSync(exe)) return { path: dir, exe };
  }
  return null;
}

// All library folders, the Steam folder itself first.
function libraryFolders(steamPath) {
  const libs = [steamPath];
  for (const rel of ['steamapps/libraryfolders.vdf', 'config/libraryfolders.vdf']) {
    let data;
    try { data = parseVdf(fs.readFileSync(path.join(steamPath, rel), 'utf8')); } catch { continue; }
    const root = data.libraryfolders || data.LibraryFolders || {};
    for (const v of Object.values(root)) {
      const p = typeof v === 'string' ? v : v && v.path;
      if (p && path.isAbsolute(p)) libs.push(path.normalize(p));
    }
  }
  const seen = new Set();
  return libs.filter((l) => {
    const k = l.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return fs.existsSync(path.join(l, 'steamapps'));
  });
}

// Returns { appId, name, dir, installed, library } or null when the game has
// no manifest in any library. `installed` is false while Steam is still
// downloading or the folder is missing.
function findApp(steamPath, appId) {
  for (const lib of libraryFolders(steamPath)) {
    const manifest = path.join(lib, 'steamapps', `appmanifest_${Number(appId)}.acf`);
    let data;
    try { data = parseVdf(fs.readFileSync(manifest, 'utf8')); } catch { continue; }
    const st = data.AppState || {};
    const installdir = st.installdir;
    if (!installdir || /[\\/:]|^\.\.?$/.test(installdir)) continue;
    const dir = path.join(lib, 'steamapps', 'common', installdir);
    const flags = Number(st.StateFlags || 0);
    const installed = fs.existsSync(dir) && (flags & 4) === 4;
    return { appId: Number(appId), name: st.name || '', dir, installed, library: lib };
  }
  return null;
}

module.exports = { parseVdf, findSteam, libraryFolders, findApp };
