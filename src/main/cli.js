// Command line entry to the same engine the app uses. Handy for testing a
// catalog or a launch without the window.
//
//   node src/main/cli.js list
//   node src/main/cli.js check   <game> <mod> [<mod> ...]
//   node src/main/cli.js launch  <game> <mod> [<mod> ...]
//   node src/main/cli.js import  <game> [<mod>]
//   node src/main/cli.js recover
//
// Options: --catalog <url or folder>   --data <folder>
'use strict';

const path = require('path');
const os = require('os');
const { Engine } = require('./engine');
const { Sources } = require('./sources');
const { Settings } = require('./settings');
const steamLib = require('./steam');
const proc = require('./proc');
const { runSession, resumeSession, buildPlan, requirementProblems } = require('./session');
const { checkRequirements } = require('./requirements');
const pkg = require('../../package.json');
const brand = require('../brand');

function defaultDataDir() {
  const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appdata, brand.productName, 'data');
}

function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--catalog' || argv[i] === '--data' || argv[i] === '--overlay-selftest' || argv[i] === '--lang') out[argv[i].slice(2).replace('overlay-selftest', 'selftest')] = argv[++i];
    else out._.push(argv[i]);
  }
  return out;
}

const stamp = () => new Date().toTimeString().slice(0, 8);
const say = (line) => console.log(`[${stamp()}] ${line}`);

async function main() {
  const args = parse(process.argv.slice(2));
  const [cmd, gameId, ...modIds] = args._;
  const dataDir = path.resolve(args.data || defaultDataDir());
  const settings = new Settings(dataDir);
  const engine = new Engine({ dataDir, isRunning: proc.isRunning, launcherVersion: pkg.version, log: say });
  const sources = new Sources({ dataDir, officialUrl: args.catalog || settings.get('catalogSource') || undefined, list: settings.get('sources') });
  const steam = steamLib.findSteam();
  const ctx = {
    engine, sources, steam, isRunning: proc.isRunning, minecraftPath: settings.get('minecraftPath'),
    overlay: { enabled: settings.get('overlay') !== false, hotkey: settings.get('overlayHotkey'), lang: args.lang || settings.get('lang') || 'en', selfTest: args.selftest ? { screenshot: require('path').resolve(args.selftest), delaySeconds: 20 } : null },
  };

  if (cmd === 'recover') {
    const pending = engine.pendingJournals();
    if (!pending.length) return say('nothing to recover');
    for (const j of pending) {
      const r = await engine.recover(j.gameId);
      if (r.status === 'running') {
        say(`${j.gameName} is still running, waiting for it to end`);
        const res = await resumeSession(ctx, j, (e) => say('stage: ' + e.stage));
        say(res.ok ? 'cleaned up' : 'failed: ' + res.error);
      } else say(`${j.gameName}: ${r.status}`);
    }
    return;
  }

  sources.loadCached();
  const data = await sources.refresh();
  for (const s of data.sources) {
    if (s.error) say(`source ${s.name}: ${s.error.message}${s.fetchedAt ? ', using the copy from ' + s.fetchedAt : ''}`);
  }
  if (!data.games.length) { console.error('no catalog available'); process.exit(1); }

  if (cmd === 'list') {
    say('data folder: ' + dataDir);
    say('steam: ' + (steam ? steam.path : 'not found'));
    for (const game of data.games) {
      const app = steam && game.steam ? steamLib.findApp(steam.path, game.steam.appId) : null;
      console.log(`\n${game.name} [${game.id}] ${game.status}${app && app.installed ? '  installed: ' + app.dir : game.status === 'available' ? '  not installed' : ''}`);
      for (const mod of data.mods.filter((m) => m.game === game.id)) {
        const info = engine.storeInfo(game.id, mod.id);
        console.log(`  ${mod.id} ${mod.version} (${mod.status}${mod.source.official ? '' : ', UNOFFICIAL source ' + mod.source.name})  package: ${sources.downloadState(mod).state}${info.exists ? '  kept data: ' + info.bytes + ' bytes' : ''}`);
        for (const r of checkRequirements(mod, { steamPath: steam ? steam.path : null, minecraftPath: ctx.minecraftPath })) {
          console.log(`    ${r.ok ? 'ok     ' : 'MISSING'} ${r.level} ${r.type} ${r.name || ''} ${r.detail || ''}`);
        }
      }
    }
    return;
  }

  if (!gameId) { console.error('usage: cli.js <list|check|launch|import|recover> [game] [mods...]'); process.exit(1); }

  if (cmd === 'check') {
    const plan = buildPlan(data, gameId, modIds, steam);
    const problems = await engine.preflight(plan);
    problems.push(...requirementProblems(plan.mods, { steamPath: steam ? steam.path : null, minecraftPath: ctx.minecraftPath }));
    say('game folder: ' + (plan.gameDir || 'not found'));
    if (!problems.length) say('ready to launch');
    for (const p of problems) say(`problem [${p.code}] ${p.message}`);
    process.exitCode = problems.length ? 2 : 0;
    return;
  }

  if (cmd === 'import') {
    const plan = buildPlan(data, gameId, [], steam);
    const mods = data.mods.filter((m) => m.game === gameId && (!modIds.length || modIds.includes(m.id)));
    const found = engine.findImportable(plan.game, plan.gameDir, mods);
    if (!found.length) return say('nothing to import');
    for (const f of found) {
      const n = engine.importPersist(plan.game, plan.gameDir, mods.find((m) => m.id === f.modId));
      say(`imported ${f.modId}: ${n} item(s) (${f.paths.join(', ')})`);
    }
    return;
  }

  if (cmd === 'launch') {
    const result = await runSession(ctx, { catalogData: data, gameId, modIds }, (e) => {
      if (e.stage === 'downloading' && e.what) return;
      say('stage: ' + e.stage + (e.method ? ' via ' + e.method : '') + (e.detail ? ' (' + e.detail + ')' : ''));
    });
    for (const a of result.attempts || []) say(`start attempt ${a.method}: ${a.ok ? 'process appeared after ' + a.waitedMs + ' ms' : 'failed, ' + a.error}`);
    for (const p of result.problems || []) say(`problem [${p.code}] ${p.message}`);
    for (const s of result.saved || []) say(`kept data of ${s.id}: ${s.items} item(s)`);
    if ((result.leftovers || []).length) say('new entries left in the game folder: ' + result.leftovers.join(', '));
    say(result.ok ? 'session finished, game folder restored' : `session ended at stage ${result.stage}: ${result.error || 'see problems above'}`);
    process.exitCode = result.ok ? 0 : 2;
    return;
  }

  console.error('unknown command ' + cmd);
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
