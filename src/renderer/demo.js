/* demo.js: stand-in for the preload API when the page runs without Electron's
   preload (screenshots). In the real app window.launcher exists and this file
   does nothing. Sample data only, nothing here touches a game. */
'use strict';

if (!window.launcher) {
  const L = (en, de) => ({ en, de });
  const official = { id: 'official', name: 'ImKirit', official: true };
  const other = { id: 'someone-cool-mods-1a2b3c', name: 'someone/cool-mods', official: false };
  const game = (id, name, tagline, extra) => ({ id, name, status: 'available', tagline, source: official, installed: true, dir: 'D:\\Games\\SteamLibrary\\steamapps\\common\\' + id.toUpperCase(), ...extra });
  const mod = (id, gameId, name, version, summary, bytes, extra) => ({
    id, localId: id, game: gameId, name, version, author: 'ImKirit', status: 'experimental', released: '2026-10-11', summary, description: summary,
    loader: 'bepinex5-x64', package: { size: bytes }, files: [{ path: 'x' }], persist: [], requirements: [], notes: [], controls: [], images: [], source: official,
    download: { state: 'none', size: bytes }, kept: { exists: false, bytes: 0, savedAt: null }, isNew: false, isUpdated: false, ...extra,
  });

  const state = {
    brand: { name: 'Launcher', homepage: '' }, version: '0.1.0', dev: false, lang: 'en',
    settings: { lang: null, theme: 'dark', minecraftPath: '', selection: {}, overlay: true, overlayHotkey: 'F10' },
    steamFound: true,
    games: [
      game('repo', 'R.E.P.O.', L('Co-op horror with physics.', 'Koop-Horror mit Physik.')),
      game('peak', 'PEAK', L('Co-op climbing.', 'Koop-Klettern.')),
      { id: 'minecraft', name: 'Minecraft', status: 'coming-later', tagline: L('Not supported yet.', 'Wird noch nicht unterstützt.'), source: official, installed: false },
    ],
    mods: [
      mod('repomimesis', 'repo', L('Mimics', 'Mimiks'), '0.2.0', L('Creatures that look and talk like your friends.', 'Wesen, die wie deine Mitspieler aussehen und sprechen.'), 74423),
      mod('repoportalgun', 'repo', L('Portal Gun', 'Portalkanone'), '0.1.0', L('Two linked portals.', 'Zwei verbundene Portale.'), 29025),
    ],
    loaders: { 'bepinex5-x64': { id: 'bepinex5-x64', name: 'BepInEx', version: '5.4.23.5' } },
    sources: [{ ...official, url: '', fetchedAt: new Date().toISOString(), error: null, offline: false, mods: 2, skipped: [] }],
    packs: [], library: [], cacheBytes: 0, sessions: {}, downloads: {}, update: { status: 'current' }, imports: [],
    account: { signedIn: false, user: null, lastSync: null, error: null, linking: false }, history: [], favorites: [],
  };

  const checks = {};
  const listeners = { changed: [], session: [], download: [], update: [] };
  const fire = (name, payload) => listeners[name].forEach((cb) => cb(payload));
  const ok = async (v) => v;

  window.launcher = {
    demo: true,
    getState: () => ok(JSON.parse(JSON.stringify(state))),
    refreshCatalog: () => ok(JSON.parse(JSON.stringify(state))),
    checkMods: (gameId, ids) => ok(checks[ids.join(',')] || { problems: [], requirements: Object.fromEntries(ids.map((id) => [id, (state.mods.find((m) => m.id === id) || {}).demoReqs || []])) }),
    downloadMod: (id) => { const m = state.mods.find((x) => x.id === id); m.download.state = 'ready'; fire('changed'); return ok({ ok: true }); },
    deletePackage: (id) => { const m = state.mods.find((x) => x.id === id); if (m) m.download.state = 'none'; fire('changed'); return ok({ ok: true }); },
    markSeen: () => ok(true),
    modImage: (id, rel) => ok((state.demoImages || {})[id + '|' + rel] || null),
    launch: () => ok({ started: true }),
    dismissSession: (g) => { delete state.sessions[g]; return ok(true); },
    savePack: (p) => { const pack = { id: p.id || 'p' + (state.packs.length + 1), ...p }; state.packs = state.packs.filter((x) => x.id !== pack.id).concat(pack); return ok({ pack }); },
    removePack: (id) => { state.packs = state.packs.filter((p) => p.id !== id); return ok({ ok: true }); },
    exportPack: () => ok({ code: state.demoCode || 'KB1-demo' }),
    importPack: () => ok({ error: 'demo' }),
    previewSource: () => ok({}), addSource: () => ok({ error: 'demo' }), removeSource: () => ok({ ok: true }),
    saveSettings: (patch) => { Object.assign(state.settings, patch); if ('lang' in patch) state.lang = patch.lang || 'en'; return ok(JSON.parse(JSON.stringify(state))); },
    importData: () => ok({ ok: true }), dismissImport: () => ok(true),
    openData: () => ok(), openGame: () => ok(), openLog: () => ok(), openExternal: () => ok(), pickFolder: () => ok(null),
    copyText: () => ok(true), readClipboard: () => ok(''), installUpdate: () => ok(false),
    toggleFavorite: (id) => { state.favorites = state.favorites.includes(id) ? state.favorites.filter((x) => x !== id) : [...state.favorites, id]; fire('changed'); return ok({ favorites: state.favorites }); },
    clearHistory: () => { state.history = []; fire('changed'); return ok(true); },
    accountStatus: () => ok(state.account), accountLogin: () => ok(state.account), accountCancel: () => ok(true),
    accountLogout: () => { state.account = { signedIn: false }; fire('changed'); return ok(state.account); }, accountSync: () => ok(state.account),
    winMinimize: () => ok(true), winMaximize: () => ok(true), winClose: () => ok(true), onWindow: () => { },
    onChanged: (cb) => listeners.changed.push(cb), onSession: (cb) => listeners.session.push(cb),
    onDownload: (cb) => listeners.download.push(cb), onUpdate: (cb) => listeners.update.push(cb),
  };

  // The screenshot script feeds the real catalog in here and stages scenes.
  window.__demo = {
    state, official, other, checks,
    refresh: () => fire('changed'),
    loadCatalog(catalog) {
      state.games = catalog.games.map((g) => ({ ...g, source: official, installed: g.status === 'available', dir: g.status === 'available' ? 'D:\\Games\\SteamLibrary\\steamapps\\common\\' + g.executable.replace('.exe', '') : null }));
      state.mods = catalog.mods.map((m) => mod(m.id, m.game, m.name, m.version, m.summary, m.package.size, { ...m, localId: m.id, source: official }));
      state.sources[0].mods = state.mods.length;
      state.upcoming = catalog.upcoming || [];
    },
  };
}
