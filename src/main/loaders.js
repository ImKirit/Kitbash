// Loader types the launcher knows how to install. A catalog can only refer
// to one of these by name. What a loader may touch in a game folder is
// defined here in code, never by the catalog.
'use strict';

const TYPES = {
  // BepInEx 5 for Unity games running on Mono.
  bepinex5: {
    label: 'BepInEx 5',
    engines: ['unity-mono'],
    // Top level names the loader archive may create in the game folder.
    topLevel: ['BepInEx', 'winhttp.dll', 'doorstop_config.ini', '.doorstop_version', 'changelog.txt'],
    // Footprints of other loaders. Moved aside for the session, never created.
    alsoAside: ['MelonLoader', 'version.dll'],
    // Present after a correct install.
    mustExist: ['BepInEx/core/BepInEx.dll', 'winhttp.dll', 'doorstop_config.ini'],
    // Mods may only place files below these folders.
    installRoots: ['BepInEx/plugins/', 'BepInEx/patchers/'],
    // Mod data that is kept between sessions may only live below these.
    persistRoots: ['BepInEx/config/', 'BepInEx/plugins/'],
    // Copied into the launcher's log folder before clean-up.
    logs: ['BepInEx/LogOutput.log'],
    // The loader itself may only be downloaded from here.
    downloadPrefixes: ['https://github.com/BepInEx/BepInEx/releases/download/'],
    redirectHosts: ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'],
  },
};

// Loader builds the launcher installs. URL, size and hash are fixed here, a
// catalog only names one of these ids. A third-party catalog can never make
// the launcher download a loader from anywhere else.
const BUILTIN_LOADERS = {
  'bepinex5-x64': {
    type: 'bepinex5', name: 'BepInEx', version: '5.4.23.5', arch: 'x64',
    url: 'https://github.com/BepInEx/BepInEx/releases/download/v5.4.23.5/BepInEx_win_x64_5.4.23.5.zip',
    size: 639118,
    sha256: '82f9878551030f54657792c0740d9d51a09500eeae1fba21106b0c441e6732c4',
    license: 'LGPL-2.1', homepage: 'https://github.com/BepInEx/BepInEx',
  },
};

// Game engines a catalog may name, and whether a loader exists for them yet.
const ENGINES = ['unity-mono', 'unity-il2cpp', 'minecraft-java', 'other'];

function loaderType(name) {
  return Object.prototype.hasOwnProperty.call(TYPES, name) ? TYPES[name] : null;
}

function underAny(rel, roots) {
  const lower = rel.toLowerCase();
  return roots.some((r) => lower.startsWith(r.toLowerCase()) && lower.length > r.length);
}

module.exports = { TYPES, BUILTIN_LOADERS, ENGINES, loaderType, underAny };
