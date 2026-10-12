// Launcher settings and small bits of state, one JSON file in the data folder.
'use strict';

const path = require('path');
const { readJson, writeJsonAtomic } = require('./util');

const DEFAULTS = {
  lang: null,            // null = follow the system
  theme: 'dark',         // dark | light
  catalogSource: '',     // empty = the built-in official catalog. A folder or URL here replaces it (for testing)
  sources: [],           // unofficial sources the user added: { id, url, name, confirmedDownload, addedAt }
  minecraftPath: '',     // extra folder to look for Minecraft Java in
  seen: {},              // modId -> version the user has already looked at
  importDismissed: {},   // "game/mod" -> true, import offer answered
  selection: {},         // gameId -> [modId] last selection
};

class Settings {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'settings.json');
    this.data = { ...DEFAULTS, ...readJson(this.file, {}) };
    if (!Array.isArray(this.data.sources)) this.data.sources = [];
    for (const k of ['seen', 'importDismissed', 'selection']) {
      if (!this.data[k] || typeof this.data[k] !== 'object') this.data[k] = {};
    }
  }
  get(key) { return this.data[key]; }
  all() { return JSON.parse(JSON.stringify(this.data)); }
  patch(obj) {
    for (const [k, v] of Object.entries(obj || {})) {
      if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) this.data[k] = v;
    }
    writeJsonAtomic(this.file, this.data);
    return this.all();
  }
}

module.exports = { Settings, DEFAULTS };
