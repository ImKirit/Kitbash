// Builds the in-game overlay (overlay/) with the .NET SDK and copies the DLL
// to src/assets/, from where the launcher installs it with every session.
//
//   node scripts/build-overlay.js [--refs <folder>]
//
// <folder> must hold BepInEx.dll and the UnityEngine module DLLs
// (UnityEngine, CoreModule, IMGUIModule, TextRenderingModule,
// JSONSerializeModule, ImageConversionModule) of a Unity 2022 or newer Mono
// game, for example its <Game>_Data\Managed folder plus BepInEx\core.
// Default: overlay/refs (not in git).
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const i = process.argv.indexOf('--refs');
const refs = path.resolve(i > 0 ? process.argv[i + 1] : path.join(root, 'overlay', 'refs'));
const dotnet = fs.existsSync('C:\Program Files\dotnet\dotnet.exe') ? 'C:\Program Files\dotnet\dotnet.exe' : 'dotnet';
execFileSync(dotnet, ['build', path.join(root, 'overlay', 'KitbashOverlay.csproj'), '-c', 'Release', '-nologo', '-v', 'q', `-p:RefsPath=${refs}`], { stdio: 'inherit' });
const out = path.join(root, 'overlay', 'bin', 'Release', 'KitbashOverlay.dll');
fs.mkdirSync(path.join(root, 'src', 'assets'), { recursive: true });
fs.copyFileSync(out, path.join(root, 'src', 'assets', 'KitbashOverlay.dll'));
console.log('src/assets/KitbashOverlay.dll', fs.statSync(out).size, 'bytes');
