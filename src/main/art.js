// Pictures of a game, found at runtime and cached in the data folder.
// Nothing here is shipped with the launcher.
//
// Icon:   1. the installed game's exe (largest icon resource)
//         2. Steam's local library cache for the app id (icon file)
// Banner: 1. Steam's local library cache (hero, then header)
//         2. Steam's public CDN by app id (hero, then header)
// The small icon falls back to the cached logo or header when nothing else exists.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps/';
const CDN_FILES = { hero: 'library_hero.jpg', header: 'header.jpg', logo: 'logo.png', capsule: 'library_600x900.jpg' };

// Files of one app in Steam's library cache. Steam keeps them either flat
// (<appid>_header.jpg) or in hashed subfolders (<appid>/<hash>/library_header.jpg),
// the small icon as <appid>/<hash>.jpg.
function libraryCache(steamPath, appId) {
  const out = {};
  if (!steamPath || !appId) return out;
  const base = path.join(steamPath, 'appcache', 'librarycache');
  const put = (kind, file) => { if (!out[kind] && fs.existsSync(file)) out[kind] = file; };
  const dir = path.join(base, String(appId));
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { /* not cached */ }
  for (const d of names) {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) {
      let inner = [];
      try { inner = fs.readdirSync(full); } catch { /* unreadable */ }
      for (const n of inner) {
        if (n === 'library_hero.jpg') put('hero', path.join(full, n));
        else if (n === 'library_header.jpg' || n === 'header.jpg') put('header', path.join(full, n));
        else if (n === 'logo.png') put('logo', path.join(full, n));
        else if (n === 'library_600x900.jpg') put('capsule', path.join(full, n));
      }
    } else if (/^[0-9a-f]{40}\.(jpg|png|ico)$/i.test(d.name)) put('icon', full);
    else if (d.name === 'icon.jpg') put('icon', full);
  }
  for (const [kind, suffix] of [['hero', 'library_hero.jpg'], ['header', 'header.jpg'], ['logo', 'logo.png'], ['capsule', 'library_600x900.jpg'], ['icon', 'icon.jpg']]) {
    put(kind, path.join(base, `${appId}_${suffix}`));
  }
  return out;
}

// opts: { cacheDir, steamPath, exeIcon(game) -> png path or null, fetch, online }
// Returns { icon, banner, logo, source: { icon, banner } } with local file paths.
async function gameArt(game, opts) {
  const appId = game.steam && game.steam.appId;
  const result = { icon: null, banner: null, logo: null, source: { icon: null, banner: null } };
  const exe = opts.exeIcon ? opts.exeIcon(game) : null;
  if (exe) { result.icon = exe; result.source.icon = 'exe'; }
  if (!appId) return result;

  const lib = libraryCache(opts.steamPath, appId);
  if (!result.icon && lib.icon) { result.icon = lib.icon; result.source.icon = 'steam-cache'; }
  const libBanner = lib.hero || lib.header;
  if (libBanner) { result.banner = libBanner; result.source.banner = 'steam-cache'; }
  if (lib.logo) result.logo = lib.logo;

  // Steam's public CDN, cached per app id.
  const dir = path.join(opts.cacheDir, String(Number(appId)));
  const cdn = async (kind) => {
    const file = path.join(dir, CDN_FILES[kind]);
    if (fs.existsSync(file)) return file;
    if (!opts.fetch || opts.online === false) return null;
    try {
      const buf = await opts.fetch(CDN + Number(appId) + '/' + CDN_FILES[kind], { maxBytes: 4 * 1024 * 1024, redirectHosts: [] });
      if (!buf || buf.length < 64) return null;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file + '.part', buf);
      fs.renameSync(file + '.part', file);
      return file;
    } catch { return null; }
  };
  if (!result.banner) {
    const f = (await cdn('hero')) || (await cdn('header'));
    if (f) { result.banner = f; result.source.banner = 'steam-cdn'; }
  }
  if (!result.logo) result.logo = await cdn('logo');
  if (!result.icon) {
    const f = lib.logo || result.logo || lib.header || result.banner;
    if (f) { result.icon = f; result.source.icon = f === lib.logo || f === lib.header ? 'steam-cache' : 'steam-cdn'; }
  }
  return result;
}

// A stable cache key for files copied next to the overlay.
function shortHash(s) { return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 10); }

// The Minecraft title logo, read from the user's own client jar (Minecraft is
// not on Steam). Cached as PNG. Returns a file path or null.
function minecraftArt(cacheDir, jars) {
  const file = path.join(cacheDir, 'minecraft', 'title.png');
  if (fs.existsSync(file)) return file;
  const { readZip } = require('./zip');
  for (const jar of jars || []) {
    try {
      if (fs.statSync(jar).size > 120 * 1024 * 1024) continue;
      const z = readZip(fs.readFileSync(jar), { maxEntries: 200000 });
      const e = z.entries.find((x) => x.name === 'assets/minecraft/textures/gui/title/minecraft.png');
      if (!e) continue;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, z.read(e));
      return file;
    } catch { /* next jar */ }
  }
  return null;
}

module.exports = { gameArt, libraryCache, minecraftArt, CDN, shortHash };
