// Publishes one mod into a local working copy of the catalog repository.
//
//   node scripts/publish-mod.js <modDir> --files <folder with the built files>
//                               [--repo <catalog repo>] [--no-commit] [--dry-run]
//
// <modDir> holds mod.json (see the README of the catalog repo). The script
// zips the files, works out sizes and SHA256 sums, writes the entry into
// catalog.json, validates the whole catalog and makes one local commit.
// It never pushes.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { writeZip } = require('../src/main/zip');
const { validateCatalog } = require('../src/main/schema');
const { sha256, cleanRel } = require('../src/main/util');

const SKIP = [/\.pdb$/i, /\.mdb$/i, /^mod\.json$/i, /^thumbs\.db$/i, /^\.ds_store$/i, /\.deps\.json$/i];

function fail(msg) {
  console.error('publish-mod: ' + msg);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-commit') out.noCommit = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--files' || a === '--repo') out[a.slice(2)] = argv[++i];
    else if (a.startsWith('--')) fail('unknown option ' + a);
    else out._.push(a);
  }
  return out;
}

function listFiles(dir) {
  const out = [];
  (function walk(d, rel) {
    for (const name of fs.readdirSync(d).sort()) {
      const full = path.join(d, name);
      const r = rel ? rel + '/' + name : name;
      const st = fs.lstatSync(full);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(full, r);
      else if (!SKIP.some((re) => re.test(name))) out.push({ rel: r, full });
    }
  })(dir, '');
  return out;
}

function findRepo(start) {
  let dir = path.resolve(start);
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'catalog.json'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

// Does the work. Returns { entry, zipRel, catalogFile, changed }.
function publish(opts) {
  const modDir = path.resolve(opts.modDir);
  const spec = JSON.parse(fs.readFileSync(path.join(modDir, 'mod.json'), 'utf8').replace(/^﻿/, ''));
  const repo = opts.repo ? path.resolve(opts.repo) : findRepo(modDir);
  if (!repo || !fs.existsSync(path.join(repo, 'catalog.json'))) throw new Error('no catalog.json found. Pass --repo <catalog repo>.');
  const filesDir = opts.files ? path.resolve(opts.files) : path.join(modDir, 'files');
  if (!fs.existsSync(filesDir)) throw new Error('folder with the mod files not found: ' + filesDir);

  for (const key of ['id', 'game', 'version', 'installTo']) {
    if (!spec[key]) throw new Error(`mod.json: "${key}" is missing`);
  }
  const installTo = cleanRel(spec.installTo);

  // Collect what goes into the package.
  const entries = listFiles(filesDir).map((f) => ({ name: installTo + '/' + f.rel, data: fs.readFileSync(f.full) }));
  for (const inc of spec.include || []) {
    const from = path.resolve(modDir, inc.from);
    if (!from.startsWith(modDir + path.sep)) throw new Error('include must stay inside the mod folder: ' + inc.from);
    entries.push({ name: installTo + '/' + cleanRel(inc.to || path.basename(inc.from)), data: fs.readFileSync(from) });
  }
  if (!entries.length) throw new Error('no files to package in ' + filesDir);
  entries.sort((a, b) => (a.name < b.name ? -1 : 1));

  const zip = writeZip(entries);
  const zipRel = `mods/${spec.game}/${spec.id}/${spec.id}-${spec.version}.zip`;

  // Images are copied next to the catalog.
  const images = [];
  for (const img of spec.images || []) {
    const from = path.resolve(modDir, img);
    if (!fs.existsSync(from)) throw new Error('image not found: ' + img);
    images.push({ from, rel: `images/mods/${spec.id}/${path.basename(img)}` });
  }

  const entry = {
    id: spec.id,
    game: spec.game,
    name: spec.name,
    version: spec.version,
    author: spec.author,
    status: spec.status,
    released: spec.released || new Date().toISOString().slice(0, 10),
    summary: spec.summary,
    description: spec.description,
    images: images.map((i) => i.rel),
    loader: spec.loader,
    minLauncherVersion: spec.minLauncherVersion,
    requirements: spec.requirements || [],
    notes: spec.notes || [],
    controls: spec.controls || [],
    conflicts: spec.conflicts || [],
    thirdParty: spec.thirdParty || [],
    persist: spec.persist || [],
    package: { url: zipRel, size: zip.length, sha256: sha256(zip) },
    files: entries.map((e) => ({ path: e.name, size: e.data.length, sha256: sha256(e.data) })),
  };
  for (const k of Object.keys(entry)) if (entry[k] === undefined) delete entry[k];

  const catalogFile = path.join(repo, 'catalog.json');
  const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8').replace(/^﻿/, ''));
  const at = catalog.mods.findIndex((m) => m.id === spec.id);
  const previous = at >= 0 ? catalog.mods[at] : null;
  const same = previous && previous.package && previous.package.sha256 === entry.package.sha256;
  if (same && previous.released) entry.released = previous.released;
  if (at >= 0) catalog.mods[at] = entry; else catalog.mods.push(entry);
  const changed = JSON.stringify(previous) !== JSON.stringify(entry);
  if (changed) catalog.updated = new Date().toISOString();

  const errors = validateCatalog(catalog);
  if (errors.length) throw new Error('the catalog would be invalid:\n  ' + errors.join('\n  '));

  if (!opts.dryRun) {
    const zipFile = path.join(repo, zipRel);
    fs.mkdirSync(path.dirname(zipFile), { recursive: true });
    // one package per mod: older versions go, git history keeps them
    for (const name of fs.readdirSync(path.dirname(zipFile))) {
      if (name.endsWith('.zip') && name !== path.basename(zipFile)) fs.rmSync(path.join(path.dirname(zipFile), name));
    }
    fs.writeFileSync(zipFile, zip);
    for (const img of images) {
      const to = path.join(repo, img.rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(img.from, to);
    }
    fs.writeFileSync(catalogFile, JSON.stringify(catalog, null, 2) + '\n');
  }
  return { entry, zipRel, catalogFile, repo, changed, previous };
}

function commit(result) {
  const git = (...args) => execFileSync('git', args, { cwd: result.repo, encoding: 'utf8' });
  try { git('rev-parse', '--is-inside-work-tree'); } catch { console.log('  (not a git repository, nothing committed)'); return; }
  git('add', '-A', '--', 'catalog.json', `mods/${result.entry.game}/${result.entry.id}`, 'images');
  if (!git('status', '--porcelain').trim()) { console.log('  nothing changed, no commit'); return; }
  const verb = result.previous ? 'Update' : 'Add';
  git('commit', '-q', '-m', `${verb} ${result.entry.id} ${result.entry.version}`);
  console.log('  committed locally: ' + git('log', '-1', '--format=%h %s').trim());
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (args._.length !== 1) fail('usage: node scripts/publish-mod.js <modDir> --files <folder> [--repo <catalog repo>] [--no-commit] [--dry-run]');
  let result;
  try { result = publish({ modDir: args._[0], files: args.files, repo: args.repo, dryRun: args.dryRun }); }
  catch (e) { fail(e.message); }
  const e = result.entry;
  console.log(`${e.id} ${e.version} for ${e.game}`);
  console.log(`  package  ${result.zipRel}  ${e.package.size} bytes`);
  console.log(`  sha256   ${e.package.sha256}`);
  for (const f of e.files) console.log(`  file     ${f.path}  ${f.size} bytes`);
  for (const p of e.persist) console.log(`  keeps    ${p}`);
  if (args.dryRun) console.log('  dry run, nothing written');
  else if (!args.noCommit) commit(result);
  console.log('  not pushed. Push the catalog repository yourself when you want this mod to go out.');
}

module.exports = { publish };
