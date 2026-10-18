const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel) => (cb) => { ipcRenderer.on(channel, (_e, payload) => cb(payload)); };

contextBridge.exposeInMainWorld('launcher', {
  getState: invoke('state:get'),
  refreshCatalog: invoke('catalog:refresh'),

  checkMods: invoke('mod:check'),
  downloadMod: invoke('mod:download'),
  deletePackage: invoke('mod:delete'),
  markSeen: invoke('mod:seen'),
  modImage: invoke('mod:image'),

  launch: invoke('launch:start'),
  dismissSession: invoke('session:dismiss'),

  savePack: invoke('pack:save'),
  removePack: invoke('pack:remove'),
  exportPack: invoke('pack:export'),
  importPack: invoke('pack:import'),

  previewSource: invoke('source:preview'),
  addSource: invoke('source:add'),
  removeSource: invoke('source:remove'),

  saveSettings: invoke('settings:save'),
  importData: invoke('import:run'),
  dismissImport: invoke('import:dismiss'),

  openData: invoke('open:data'),
  openGame: invoke('open:game'),
  openLog: invoke('open:log'),
  openExternal: invoke('open:external'),
  pickFolder: invoke('dialog:pickFolder'),
  copyText: invoke('clipboard:write'),
  readClipboard: invoke('clipboard:read'),
  installUpdate: invoke('update:install'),

  winMinimize: invoke('win:minimize'),
  winMaximize: invoke('win:maximize'),
  winClose: invoke('win:close'),
  onWindow: on('window'),
  toggleFavorite: invoke('fav:toggle'),
  clearHistory: invoke('history:clear'),
  accountStatus: invoke('account:status'),
  accountLogin: invoke('account:login'),
  accountCancel: invoke('account:cancel'),
  accountLogout: invoke('account:logout'),
  accountSync: invoke('account:sync'),
  onChanged: on('changed'),
  onSession: on('session'),
  onDownload: on('download'),
  onUpdate: on('update'),
});
