// The in-game overlay: a small BepInEx plugin shipped with the launcher
// (src/assets/KitbashOverlay.dll, source in overlay/). It is installed with
// every session like a mod, listed in the journal and removed afterwards.
// The launcher writes the texts it shows into kitbash-overlay.json.
'use strict';

const fs = require('fs');
const path = require('path');
const { text } = require('./schema');

const DIR = 'BepInEx/plugins/KitbashOverlay';
const DLL_SOURCE = path.join(__dirname, '..', 'assets', 'KitbashOverlay.dll');

const TEXTS = {
  en: {
    title: 'KITBASH  ·  MODS IN THIS SESSION', summary: '{0} of {1} loaded without problems', loaded: 'loaded',
    notLoaded: 'not loaded', errors: 'loaded, {0} error(s)', empty: 'No mod data for this session.',
    footer: '{0} closes  ·  click a mod for how to use it', keys: 'KEYS', steps: 'HOW TO USE IT', problems: 'PROBLEMS',
    notLoadedHelp: 'BepInEx did not load this mod. The loader log has the reason.',
  },
  de: {
    title: 'KITBASH  ·  MODS IN DIESER SITZUNG', summary: '{0} von {1} ohne Probleme geladen', loaded: 'geladen',
    notLoaded: 'nicht geladen', errors: 'geladen, {0} Fehler', empty: 'Keine Mod-Daten für diese Sitzung.',
    footer: '{0} schließt  ·  Mod anklicken für die Bedienung', keys: 'TASTEN', steps: 'SO BENUTZT DU SIE', problems: 'PROBLEME',
    notLoadedHelp: 'BepInEx hat diese Mod nicht geladen. Der Grund steht im Loader-Log.',
  },
};

function available() {
  return fs.existsSync(DLL_SOURCE);
}

// What the overlay shows about one mod, in one language.
function modInfo(mod, lang) {
  const usage = mod.usage || {};
  const keys = (usage.keys && usage.keys.length ? usage.keys : mod.controls || []).map((k) => ({ key: k.key, text: text(k.text, lang) }));
  return {
    id: mod.id,
    name: text(mod.name, lang),
    version: mod.version,
    summary: text(mod.summary, lang),
    dlls: (mod.files || []).map((f) => f.path).filter((p) => /\.dll$/i.test(p)),
    usage: { keys, steps: (usage.steps || []).map((s) => text(s, lang)) },
  };
}

// Files for the engine: [{ rel, data }]. opts: { lang, hotkey, selfTest: { screenshot, delaySeconds } }
function overlayFiles(mods, opts = {}) {
  const lang = opts.lang === 'de' ? 'de' : 'en';
  const json = {
    hotkey: opts.hotkey || 'F10',
    lang,
    text: TEXTS[lang],
    mods: mods.map((m) => modInfo(m, lang)),
  };
  if (opts.selfTest && opts.selfTest.screenshot) json.selfTest = { screenshot: opts.selfTest.screenshot, delaySeconds: opts.selfTest.delaySeconds || 15 };
  const dll = opts.dll || fs.readFileSync(DLL_SOURCE);
  return [
    { rel: `${DIR}/KitbashOverlay.dll`, data: dll },
    { rel: `${DIR}/kitbash-overlay.json`, data: Buffer.from(JSON.stringify(json, null, 1), 'utf8') },
  ];
}

module.exports = { overlayFiles, modInfo, available, OVERLAY_DIR: DIR, TEXTS };
