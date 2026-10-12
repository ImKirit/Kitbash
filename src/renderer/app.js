/* app.js: the whole window. One state object from the main process, a few
   views rendered from it as plain HTML, clicks handled by data-act. */
'use strict';

const api = window.launcher;
const T = window.T;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tx = (v) => (typeof v === 'string' ? v : v ? (v[S.lang] || v.en || '') : '');

let S = null;                       // state from the main process
let view = { name: 'home' };        // home | game | mod | library | sources | settings
const picked = {};                  // gameId -> Set of mod ids
const checks = {};                  // key -> result of checkMods
const images = {};                  // "mod|rel" -> url
let modal = null;

const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
  box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  link: '<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1"/><path d="M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  down: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2 6"/><path d="M20 4v7h-7"/>',
  back: '<path d="M14 6l-6 6 6 6"/>',
  warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
  game: '<rect x="3" y="7" width="18" height="11" rx="3"/><path d="M8 11v3M6.5 12.5h3M16 12h.5M18 13.5h.5"/>',
};
const ico = (n, size = 16) => `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ''}</svg>`;

// ---- lookups -------------------------------------------------------------------
const gameOf = (id) => S.games.find((g) => g.id === id);
const modOf = (id) => S.mods.find((m) => m.id === id);
const modsOf = (gameId) => S.mods.filter((m) => m.game === gameId);
const packsOf = (gameId) => S.packs.filter((p) => p.gameId === gameId);
const sessionOf = (gameId) => S.sessions[gameId] || null;
const isActive = (gameId) => { const s = sessionOf(gameId); return !!(s && !s.result); };
const sel = (gameId) => (picked[gameId] = picked[gameId] || new Set((S.settings.selection[gameId] || []).filter((id) => modOf(id))));

function size(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' kB';
  return (bytes / 1024 / 1024).toFixed(1).replace('.', S.lang === 'de' ? ',' : '.') + ' MB';
}
function ago(iso) {
  if (!iso) return T('never');
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return T('just now');
  if (min < 60) return T('{n} min ago', { n: min });
  if (min < 60 * 24) return T('{n} h ago', { n: Math.round(min / 60) });
  return new Date(iso).toLocaleDateString(S.lang);
}

function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 2600);
}

// ---- chips ---------------------------------------------------------------------
function sourceChip(src) {
  return src.official ? '' : `<span class="chip bad" title="${esc(T('From an unofficial source: {name}. Not checked by anyone.', { name: src.name }))}">${ico('warn', 11)} ${esc(T('Unofficial'))}</span>`;
}
function modChips(m) {
  let out = `<span class="chip">${esc(m.version)}</span>`;
  if (m.status !== 'stable') out += `<span class="chip warn">${esc(T(m.status === 'beta' ? 'Beta' : 'Experimental'))}</span>`;
  out += sourceChip(m.source);
  if (m.isNew) out += `<span class="chip dark">${esc(T('New'))}</span>`;
  else if (m.isUpdated) out += `<span class="chip dark">${esc(T('Updated'))}</span>`;
  return out;
}
function downloadChip(m) {
  const d = S.downloads[m.id];
  if (d) return `<span class="chip">${Math.round((d.got / Math.max(1, d.total)) * 100)} %</span>`;
  if (m.download.state === 'ready') return `<span class="chip ok">${esc(T('Downloaded'))}</span>`;
  if (m.download.state === 'update') return `<span class="chip dark">${esc(T('Update available'))}</span>`;
  return `<span class="chip">${esc(size(m.package.size))}</span>`;
}

// ---- frame ---------------------------------------------------------------------
function renderNav() {
  $('logoText').textContent = S.brand.name;
  document.title = S.brand.name;
  const item = (v, icon, label, count, extra = '') => {
    const on = view.name === v.name && (v.gameId || '') === (view.gameId || '') || (v.name === 'game' && view.name === 'mod' && view.gameId === v.gameId);
    return `<div class="nav-item${on ? ' active' : ''}" data-act="go" data-view='${esc(JSON.stringify(v))}'>${ico(icon)}<span>${esc(label)}</span>${extra}${count != null ? `<span class="count">${count}</span>` : ''}</div>`;
  };
  let html = item({ name: 'home' }, 'home', T('Home'));
  html += `<div class="side-head">${esc(T('Games'))}</div>`;
  for (const g of S.games) {
    const live = isActive(g.id) ? '<span class="dot live"></span>' : '';
    html += item({ name: 'game', gameId: g.id }, 'game', g.name, g.status === 'available' ? modsOf(g.id).length : null, live);
  }
  html += `<div class="side-head">${esc(T('More'))}</div>`;
  html += item({ name: 'library' }, 'down', T('Downloads'), S.library.length || null);
  html += item({ name: 'sources' }, 'link', T('Sources'), S.sources.length);
  html += item({ name: 'settings' }, 'gear', T('Settings'));
  $('nav').innerHTML = html;

  const u = S.update;
  let line = `<span class="ver">v${esc(S.version)}</span> `;
  if (u.status === 'downloading') line += esc(T('Update {v} is downloading', { v: u.version })) + ` ${u.percent} %`;
  else if (u.status === 'ready') line += esc(T('Update {v} is ready', { v: u.version }));
  else if (u.status === 'current') line += esc(T('up to date'));
  else if (u.status === 'checking') line += esc(T('checking for updates'));
  else if (u.status === 'dev') line += esc(T('development build'));
  let btn = '';
  if (u.status === 'ready') btn = `<button class="btn small primary" data-act="install-update">${esc(T('Restart and update'))}</button>`;
  $('sideBottom').innerHTML = line + btn;
}

function renderTopbar() {
  const parts = [`<a data-act="go" data-view='{"name":"home"}'>${esc(T('Home'))}</a>`];
  const g = view.gameId ? gameOf(view.gameId) : null;
  if (g) parts.push(view.name === 'game' ? `<span>${esc(g.name)}</span>` : `<a data-act="go" data-view='${esc(JSON.stringify({ name: 'game', gameId: g.id }))}'>${esc(g.name)}</a>`);
  if (view.name === 'mod' && modOf(view.modId)) parts.push(`<span>${esc(tx(modOf(view.modId).name))}</span>`);
  if (view.name === 'library') parts.push(`<span>${esc(T('Downloads'))}</span>`);
  if (view.name === 'sources') parts.push(`<span>${esc(T('Sources'))}</span>`);
  if (view.name === 'settings') parts.push(`<span>${esc(T('Settings'))}</span>`);
  const off = S.sources.filter((s) => s.offline);
  const main = S.sources[0] || {};
  const status = off.length
    ? `<span class="dot warn"></span>${esc(main.fetchedAt ? T('Offline, showing the list from {when}', { when: ago(main.fetchedAt) }) : T('Catalog not reachable'))}`
    : `<span class="dot ok"></span>${esc(T('Catalog up to date'))}`;
  $('topbar').innerHTML = `<div class="crumbs">${parts.join('<span class="sep">/</span>')}</div><div class="grow"></div>
    <div class="cat-status">${status}</div>
    <button class="btn small" data-act="refresh" title="${esc(T('Check for new mods'))}">${ico('refresh', 14)} ${esc(T('Refresh'))}</button>`;
}

// ---- home ----------------------------------------------------------------------
function gameStatus(g) {
  if (g.status !== 'available') return `<span class="chip">${esc(T('Coming later'))}</span>`;
  if (isActive(g.id)) return `<span class="chip dark">${esc(T('Running'))}</span>`;
  return g.installed ? `<span class="chip ok">${esc(T('Installed'))}</span>` : `<span class="chip warn">${esc(T('Not installed'))}</span>`;
}

function sessionBanners() {
  let html = '';
  for (const s of Object.values(S.sessions)) {
    const g = gameOf(s.gameId) || { name: s.gameId };
    if (!s.result) {
      html += `<div class="banner"><span class="dot live" style="margin-top:6px"></span><div class="grow"><b>${esc(T('{game} is being handled by the launcher', { game: g.name }))}</b>
        <div class="muted">${esc(T('You can close this window. The launcher stays in the tray and puts the game folder back as soon as the game ends.'))}</div></div>
        <button class="btn small" data-act="go" data-view='${esc(JSON.stringify({ name: 'game', gameId: s.gameId }))}'>${esc(T('Show'))}</button></div>`;
    } else if (s.result.recovered) {
      html += `<div class="banner ${s.result.ok ? '' : 'bad'}"><div class="grow"><b>${esc(s.result.ok ? T('{game}: cleaned up after an interrupted session', { game: g.name }) : T('{game}: clean-up is still pending', { game: g.name }))}</b>
        <div class="muted">${esc(s.result.ok ? T('The game folder is back to how it was before.') : (s.result.error || ''))}</div></div>
        <button class="btn small" data-act="dismiss-session" data-game="${esc(s.gameId)}">${esc(T('OK'))}</button></div>`;
    }
  }
  return html;
}

function importBanner() {
  if (!S.imports.length) return '';
  const rows = S.imports.map((f) => {
    const m = modOf(f.modId); const g = gameOf(f.gameId);
    return `<div class="row" style="margin-top:8px"><div class="grow"><b>${esc(tx(m.name))}</b> <span class="muted">${esc(g.name)}: ${esc(f.paths.join(', '))}</span></div>
      <button class="btn small primary" data-act="import" data-game="${esc(f.gameId)}" data-mod="${esc(f.modId)}">${esc(T('Take over'))}</button>
      <button class="btn small" data-act="import-no" data-game="${esc(f.gameId)}" data-mod="${esc(f.modId)}">${esc(T('No'))}</button></div>`;
  }).join('');
  return `<div class="banner"><div class="grow"><b>${esc(T('Found mod data from a manual install'))}</b>
    <div class="muted">${esc(T('Settings and saved data of these mods are already in your game folder. The launcher can copy them so they are there when you launch through it. Nothing in the game folder is changed.'))}</div>${rows}</div></div>`;
}

function viewHome() {
  const [a, b, c] = T('Mods with one |click|.').split('|');
  let html = `<div class="wrap">${sessionBanners()}${importBanner()}
    <div class="hero"><div class="label">${esc(T('Mod launcher'))}</div>
    <h1>${esc(a)}<span class="box">${esc(b)}</span>${esc(c)}</h1>
    <p class="lead">${esc(T('Pick a game, pick mods, press Launch. When you close the game, the mods are gone from the game folder again. Their settings and saved data stay here.'))}</p></div>`;
  if (!S.games.length) {
    html += `<div class="banner warn"><div class="grow"><b>${esc(T('No catalog yet'))}</b><div class="muted">${esc(T('The mod list could not be loaded and there is no saved copy. Check your connection and press Refresh.'))}</div></div></div>`;
  }
  html += '<div class="grid">';
  for (const g of S.games) {
    const n = modsOf(g.id).length;
    const off = g.status !== 'available';
    html += `<div class="card game-card ${off ? 'off' : 'click'}" ${off ? '' : `data-act="go" data-view='${esc(JSON.stringify({ name: 'game', gameId: g.id }))}'`}>
      <div class="gname">${esc(g.name)}</div><div class="gtag">${esc(tx(g.tagline))}</div>
      <div class="gfoot">${off ? '' : `<span>${esc(T(n === 1 ? '{n} mod' : '{n} mods', { n }))}</span>`}${sourceChip(g.source)}<span class="grow"></span>${gameStatus(g)}</div></div>`;
  }
  html += '</div>';
  const fresh = S.mods.filter((m) => m.isNew || m.isUpdated);
  if (fresh.length) {
    html += `<div class="section"><div class="list"><div class="lhead">${esc(T('New in the catalog'))}</div>${fresh.map((m) => modRow(m, false)).join('')}</div></div>`;
  }
  if (S.packs.length) {
    html += `<div class="section"><div class="list"><div class="lhead">${esc(T('Your modpacks'))}</div>${S.packs.map(packRow).join('')}</div></div>`;
  }
  return html + '</div>';
}

// ---- game ----------------------------------------------------------------------
function modRow(m, selectable) {
  const g = gameOf(m.game);
  const on = selectable && sel(m.game).has(m.id);
  const box = selectable ? `<div class="check${on ? ' on' : ''}" data-act="toggle" data-mod="${esc(m.id)}">${ico('check', 14)}</div>` : '';
  return `<div class="lrow click" data-act="go" data-view='${esc(JSON.stringify({ name: 'mod', gameId: m.game, modId: m.id }))}'>${box}
    <div class="main"><div class="title">${esc(tx(m.name))} ${modChips(m)}</div><div class="sub">${selectable ? '' : esc(g ? g.name + ' · ' : '')}${esc(tx(m.summary))}</div></div>
    ${downloadChip(m)}</div>`;
}

function packRow(p) {
  const g = gameOf(p.gameId);
  const names = p.mods.map((r) => { const m = modOf(r.id); return m ? tx(m.name) : r.id; });
  const missing = p.mods.filter((r) => !modOf(r.id)).length;
  return `<div class="lrow"><div class="main"><div class="title">${esc(p.name)} <span class="chip">${esc(T(p.mods.length === 1 ? '{n} mod' : '{n} mods', { n: p.mods.length }))}</span>
      ${missing ? `<span class="chip bad">${esc(T('{n} not available', { n: missing }))}</span>` : ''}</div>
      <div class="sub">${esc(g ? g.name : p.gameId)} · ${esc(names.join(', ') || T('empty'))}</div></div>
    <button class="btn small" data-act="pack-share" data-pack="${esc(p.id)}">${esc(T('Share'))}</button>
    <button class="btn small" data-act="pack-edit" data-pack="${esc(p.id)}">${esc(T('Edit'))}</button>
    <button class="btn small primary" data-act="pack-launch" data-pack="${esc(p.id)}" ${!g || !g.installed || isActive(p.gameId) || !p.mods.length ? 'disabled' : ''}>${ico('play', 12)} ${esc(T('Launch'))}</button></div>`;
}

const STEPS = ['checking', 'downloading', 'preparing', 'launching', 'running', 'saving', 'done'];
const STEP_LABEL = {
  checking: 'Check the game and the requirements', downloading: 'Download what is missing', preparing: 'Set up loader, mods and your saved data',
  launching: 'Start the game through Steam', running: 'Game is running', saving: 'Keep mod data and put the game folder back', done: 'Done',
};
const METHOD = { 'steam-applaunch': 'steam.exe -applaunch', 'steam-url': 'steam://rungameid', 'direct-exe': 'game exe' };

function problemText(p) {
  const m = p.mod ? modOf(p.mod) : null;
  const name = m ? tx(m.name) : p.mod;
  const map = {
    'game-missing': T('The game is not installed (or Steam was not found).'),
    'game-running': T('The game is already running. Close it first.'),
    'anti-cheat': T('This game uses anti-cheat. The launcher does not touch such games.'),
    'pending-session': T('An earlier session of this game has not been cleaned up yet. Restart the launcher.'),
    'no-mods': T('No mod selected.'),
    'launch-failed': T('The game did not start.'),
    'engine-mismatch': T('The installed game does not fit the mod loader any more.'),
  };
  if (p.code === 'requirement-missing') {
    const r = p.requirement;
    return T('{mod} needs {what} on this PC.', { mod: name, what: r.type === 'steam-game' ? r.name : 'Minecraft Java' + (r.minVersion ? ' ' + r.minVersion + '+' : '') });
  }
  if (p.code === 'mod-conflict') return T('{a} and {b} cannot be combined.', { a: name, b: modOf(p.other) ? tx(modOf(p.other).name) : p.other });
  if (p.code === 'launcher-too-old') return T('{mod} needs a newer launcher ({v}).', { mod: name, v: p.needs });
  if (p.code === 'confirmation-needed') return T('Downloads from this unofficial source have not been confirmed.');
  return map[p.code] || p.message || p.error || p.code;
}

function sessionPanel(gameId) {
  const s = sessionOf(gameId);
  if (!s) return '';
  const g = gameOf(gameId);
  const r = s.result;
  const at = r ? (r.ok ? STEPS.length : STEPS.indexOf(r.stage)) : STEPS.indexOf(s.stage);
  let steps = '';
  STEPS.forEach((id, i) => {
    let cls = i < at ? 'done' : i === at ? (r ? 'fail' : 'now') : '';
    if (r && r.ok) cls = 'done';
    let extra = '';
    if (id === 'downloading' && s.progress && i === at) extra = `<span class="extra">${esc(s.progress.what)}</span><div class="bar"><i style="width:${Math.round((s.progress.got / Math.max(1, s.progress.total)) * 100)}%"></i></div>`;
    if (id === 'launching' && s.method && i <= at) extra = `<span class="extra">${esc(METHOD[s.method] || s.method)}</span>`;
    steps += `<div class="step ${cls}"><span class="num">${cls === 'done' ? ico('check', 13) : i + 1}</span><span>${esc(T(STEP_LABEL[id]))}</span>${extra}</div>`;
  });
  let head;
  if (!r) {
    head = `<div class="banner"><span class="dot live" style="margin-top:6px"></span><div class="grow"><b>${esc(s.stage === 'running' ? T('{game} is running with mods', { game: g.name }) : T('Getting {game} ready', { game: g.name }))}</b>
      <div class="muted">${esc(T('You can close this window. The launcher stays in the tray and puts the game folder back as soon as the game ends.'))}</div></div></div>`;
  } else if (r.ok) {
    const kept = (r.saved || []).filter((x) => x.items > 0).map((x) => (modOf(x.id) ? tx(modOf(x.id).name) : x.id));
    head = `<div class="banner"><span class="dot ok" style="margin-top:6px"></span><div class="grow"><b>${esc(T('Session finished. The game folder is back to how it was.'))}</b>
      <div class="muted">${esc(kept.length ? T('Kept data of: {mods}', { mods: kept.join(', ') }) : T('The mods wrote no data this time.'))}${(r.leftovers || []).length ? ' ' + esc(T('New files the game left behind: {files}', { files: r.leftovers.join(', ') })) : ''}</div>
      <div class="acts"><button class="btn small" data-act="open-log" data-game="${esc(gameId)}">${esc(T('Show loader log'))}</button><button class="btn small" data-act="dismiss-session" data-game="${esc(gameId)}">${esc(T('Close'))}</button></div></div></div>`;
  } else {
    const list = (r.problems && r.problems.length ? r.problems : [r]).map((p) => `<div>${esc(problemText(p))}</div>`).join('');
    const tries = (r.attempts || []).map((a) => `<div class="muted">${esc(METHOD[a.method] || a.method)}: ${esc(a.ok ? T('started') : a.error)}</div>`).join('');
    head = `<div class="banner bad"><span class="dot bad" style="margin-top:6px"></span><div class="grow"><b>${esc(T('That did not work'))}</b>${list}${tries}
      <div class="muted">${esc(r.cleanupPending ? T('The game folder will be put back the next time the launcher starts.') : T('The game folder is unchanged.'))}</div>
      <div class="acts"><button class="btn small" data-act="dismiss-session" data-game="${esc(gameId)}">${esc(T('Close'))}</button></div></div></div>`;
  }
  const log = s.log && s.log.length ? `<div class="log" style="margin-top:14px">${esc(s.log.join('\n'))}</div>` : '';
  return `${head}<div class="list"><div class="lhead">${esc(T('What the launcher does'))}</div><div class="steps">${steps}</div></div>${log}`;
}

function viewGame() {
  const g = gameOf(view.gameId);
  if (!g) return viewHome();
  const mods = modsOf(g.id);
  const tab = view.tab || 'mods';
  let html = `<div class="wrap"><div class="page-head"><div class="grow"><div class="label">${esc(T('Game'))}</div><h2>${esc(g.name)}</h2>
    <div class="meta">${gameStatus(g)}${sourceChip(g.source)}<span class="muted">${esc(g.installed ? g.dir : T('Install the game through Steam first.'))}</span></div></div>
    ${g.installed ? `<button class="btn small" data-act="open-game" data-game="${esc(g.id)}">${ico('folder', 14)} ${esc(T('Game folder'))}</button>` : ''}</div>`;
  if (sessionOf(g.id)) return html + sessionPanel(g.id) + '</div>';
  if (!S.steamFound) html += `<div class="banner warn"><div class="grow"><b>${esc(T('Steam was not found on this PC.'))}</b></div></div>`;
  html += `<div class="tabs"><div class="tab${tab === 'mods' ? ' active' : ''}" data-act="tab" data-tab="mods">${esc(T('Mods'))} · ${mods.length}</div>
    <div class="tab${tab === 'packs' ? ' active' : ''}" data-act="tab" data-tab="packs">${esc(T('Modpacks'))} · ${packsOf(g.id).length}</div></div>`;
  if (tab === 'mods') {
    html += `<div class="list"><div class="lhead"><span>${esc(T('Mods for {game}', { game: g.name }))}</span><span class="grow"></span><span>${esc(T('Tick the ones you want'))}</span></div>
      ${mods.length ? mods.map((m) => modRow(m, true)).join('') : `<div class="empty">${esc(T('No mods for this game yet.'))}</div>`}</div>`;
  } else {
    const list = packsOf(g.id);
    html += `<div class="list"><div class="lhead"><span>${esc(T('Modpacks for {game}', { game: g.name }))}</span><span class="grow"></span>
      <button class="hbtn" data-act="pack-import">${esc(T('Import code'))}</button><button class="hbtn" data-act="pack-new">${esc(T('New pack'))}</button></div>
      ${list.length ? list.map(packRow).join('') : `<div class="empty">${esc(T('A modpack is a named set of mods you launch with one click and can share with friends as a code.'))}</div>`}</div>`;
  }
  return html + '</div>';
}

function renderLaunchBar() {
  const bar = $('launchBar');
  const g = view.name === 'game' ? gameOf(view.gameId) : null;
  if (!g || g.status !== 'available' || sessionOf(g.id) || (view.tab || 'mods') !== 'mods') { bar.hidden = true; return; }
  const ids = [...sel(g.id)];
  const names = ids.map((id) => tx(modOf(id).name));
  const key = g.id + '|' + ids.join(',');
  const chk = checks[key];
  let msg = ids.length ? names.join(' + ') : T('Nothing selected');
  let problems = '';
  if (ids.length && chk && chk.problems && chk.problems.length) problems = `<div class="err">${esc(problemText(chk.problems[0]))}</div>`;
  if (ids.length && !chk) runCheck(g.id, ids);
  const need = ids.map(modOf).filter((m) => m.download.state !== 'ready').reduce((n, m) => n + m.package.size, 0);
  bar.hidden = false;
  bar.innerHTML = `<div class="grow"><div class="names">${esc(msg)}</div>${problems || `<div class="muted">${esc(ids.length ? (need ? T('{size} still to download', { size: size(need) }) : T('Everything is downloaded')) : T('Tick one or more mods to launch them together.'))}</div>`}</div>
    <button class="btn" data-act="pack-from-selection" ${ids.length ? '' : 'disabled'}>${esc(T('Save as modpack'))}</button>
    <button class="btn primary big" data-act="launch" ${ids.length && !(chk && chk.problems && chk.problems.length) ? '' : 'disabled'}>${ico('play', 14)} ${esc(T('Launch'))}</button>`;
}

async function runCheck(gameId, ids) {
  const key = gameId + '|' + ids.join(',');
  checks[key] = { pending: true };
  const r = await api.checkMods(gameId, ids);
  checks[key] = r.error ? { problems: [r] } : r;
  render();
}

// ---- mod -----------------------------------------------------------------------
function viewMod() {
  const m = modOf(view.modId);
  if (!m) return viewGame();
  const g = gameOf(m.game);
  const key = m.game + '|' + m.id;
  const chk = checks[key];
  if (!chk) runCheck(m.game, [m.id]);
  const reqs = (chk && chk.requirements && chk.requirements[m.id]) || [];
  const problems = (chk && chk.problems) || [];
  const loader = S.loaders[m.loader];

  let req = `<div class="lrow top"><span class="dot ${g.installed ? 'ok' : 'bad'}"></span><div class="main"><div class="title">${esc(T('{game} installed through Steam', { game: g.name }))}</div>
    <div class="sub">${esc(g.installed ? T('Found') : T('Not found on this PC'))}</div></div></div>`;
  for (const r of reqs) {
    const label = r.type === 'steam-game' ? T('{game} installed through Steam', { game: r.name }) : T('Minecraft Java installed') + (r.minVersion ? ` (${r.minVersion}+)` : '');
    const state = r.ok ? 'ok' : r.level === 'required' ? 'bad' : 'warn';
    const found = r.ok ? T('Found') + (r.type === 'minecraft-java' ? ' (' + r.detail + ')' : '') : (r.level === 'required' ? T('Missing, the mod cannot be launched') : T('Not found, the mod still works'));
    req += `<div class="lrow top"><span class="dot ${state}"></span><div class="main"><div class="title">${esc(label)} ${r.level === 'recommended' ? `<span class="chip">${esc(T('Optional'))}</span>` : ''}</div>
      <div class="sub">${esc(tx(r.text))}</div><div class="sub"><b>${esc(found)}</b></div></div></div>`;
  }
  const KIND = { multiplayer: 'Multiplayer', privacy: 'Privacy', testing: 'State of testing', info: 'Good to know' };
  const notes = (m.notes || []).map((n) => `<div class="lrow top"><div class="main"><div class="note-kind">${esc(T(KIND[n.kind]))}</div><div>${esc(tx(n.text))}</div></div></div>`).join('');
  const controls = (m.controls || []).map((c) => `<div class="lrow"><kbd>${esc(c.key)}</kbd><div class="main sub">${esc(tx(c.text))}</div></div>`).join('');
  const third = (m.thirdParty || []).map((t) => `<div class="kv"><span class="k">${esc(t.license)}</span><span class="v">${esc(t.name)}</span></div>`).join('');
  const dl = S.downloads[m.id];
  let dlBtn;
  if (dl) dlBtn = `<button class="btn" disabled>${Math.round((dl.got / Math.max(1, dl.total)) * 100)} %</button>`;
  else if (m.download.state === 'ready') dlBtn = `<button class="btn danger" data-act="delete-package" data-mod="${esc(m.id)}">${esc(T('Remove download'))}</button>`;
  else dlBtn = `<button class="btn" data-act="download" data-mod="${esc(m.id)}">${ico('down', 14)} ${esc(m.download.state === 'update' ? T('Update') : T('Download'))} · ${esc(size(m.package.size))}</button>`;
  const imgs = (m.images || []).map((rel) => {
    const k = m.id + '|' + rel;
    if (!(k in images)) { images[k] = null; api.modImage(m.id, rel).then((u) => { if (u && !u.error) { images[k] = u; render(); } }); }
    return images[k] ? `<div class="shot"><img src="${esc(images[k])}" alt=""></div>` : '';
  }).join('');
  const blocked = problems.length || isActive(m.game);
  const unofficial = m.source.official ? '' : `<div class="banner bad">${ico('warn', 18)}<div class="grow"><b>${esc(T('Unofficial source: {name}', { name: m.source.name }))}</b>
    <div class="muted">${esc(T('This mod does not come from the official catalog. Nobody has checked it. A mod is program code that runs inside the game with your rights. Only use it if you trust the people behind this source.'))}</div></div></div>`;

  return `<div class="wrap">${unofficial}<div class="page-head"><div class="grow"><div class="label">${esc(g.name)} · ${esc(T('by {author}', { author: m.author }))}</div><h2>${esc(tx(m.name))}</h2>
      <div class="meta">${modChips(m)}${downloadChip(m)}</div></div>
      ${dlBtn}<button class="btn" data-act="pack-add" data-mod="${esc(m.id)}">${esc(T('Add to modpack'))}</button>
      <button class="btn primary big" data-act="launch-one" data-mod="${esc(m.id)}" ${blocked ? 'disabled' : ''}>${ico('play', 14)} ${esc(T('Launch'))}</button></div>
    ${problems.length ? `<div class="banner bad"><div class="grow">${problems.map((p) => `<div><b>${esc(problemText(p))}</b></div>`).join('')}</div></div>` : ''}
    <div class="cols"><div><p class="lead" style="margin:0 0 18px">${esc(tx(m.summary))}</p>${imgs}
      <div class="prose">${tx(m.description).split(/\n\n+/).map((p) => `<p>${esc(p)}</p>`).join('')}</div>
      ${controls ? `<div class="list"><div class="lhead">${esc(T('Keys'))}</div>${controls}</div>` : ''}</div>
    <div class="side">
      <div class="list"><div class="lhead">${esc(T('You need'))}</div>${req}</div>
      ${notes ? `<div class="list"><div class="lhead">${esc(T('You should know'))}</div>${notes}</div>` : ''}
      <div class="list"><div class="lhead">${esc(T('Details'))}</div>
        <div class="kv"><span class="k">${esc(T('Version'))}</span><span class="v">${esc(m.version)}${m.released ? ' · ' + esc(m.released) : ''}</span></div>
        <div class="kv"><span class="k">${esc(T('Source'))}</span><span class="v">${esc(m.source.official ? T('Official catalog') : m.source.name + ' (' + T('unofficial') + ')')}</span></div>
        <div class="kv"><span class="k">${esc(T('Mod loader'))}</span><span class="v">${esc(loader ? loader.name + ' ' + loader.version : m.loader)}</span></div>
        <div class="kv"><span class="k">${esc(T('Package'))}</span><span class="v">${esc(size(m.package.size))} · ${esc(T(m.files.length === 1 ? '{n} file' : '{n} files', { n: m.files.length }))}</span></div>
        <div class="kv"><span class="k">${esc(T('Kept data'))}</span><span class="v">${esc(m.kept.exists ? size(m.kept.bytes) + ' · ' + ago(m.kept.savedAt) : T('nothing yet'))}</span></div>
        ${third}</div>
    </div></div></div>`;
}

// ---- library, sources, settings ------------------------------------------------
function viewLibrary() {
  const rows = S.library.map((d) => {
    const m = modOf(d.id);
    const g = m ? gameOf(m.game) : null;
    return `<div class="lrow"><div class="main"><div class="title">${esc(m ? tx(m.name) : d.id)} <span class="chip">${esc(d.version)}</span>${m ? sourceChip(m.source) : ''}
      ${m && m.download.state === 'update' ? `<span class="chip dark">${esc(T('Update available'))}</span>` : ''}</div>
      <div class="sub">${esc(g ? g.name + ' · ' : '')}${esc(size(d.size))} · ${esc(ago(d.at))}</div></div>
      ${m && m.download.state === 'update' ? `<button class="btn small" data-act="download" data-mod="${esc(d.id)}">${esc(T('Update'))}</button>` : ''}
      <button class="btn small danger" data-act="delete-package" data-mod="${esc(d.id)}">${esc(T('Remove'))}</button></div>`;
  }).join('');
  return `<div class="wrap"><div class="page-head"><div class="grow"><div class="label">${esc(T('Downloads'))}</div><h2>${esc(T('What is on this PC'))}</h2>
    <p class="lead">${esc(T('Mods are listed from the catalogs. A package is only downloaded when you press Download, add the mod to a modpack or launch it. Removing a download never removes the data a mod has saved.'))}</p></div></div>
    <div class="list"><div class="lhead"><span>${esc(T('Downloaded packages'))}</span><span class="grow"></span><span>${esc(size(S.cacheBytes))}</span></div>
    ${rows || `<div class="empty">${esc(T('Nothing downloaded yet.'))}</div>`}</div></div>`;
}

function viewSources() {
  const rows = S.sources.map((s) => `<div class="lrow top"><span class="dot ${s.error ? 'warn' : 'ok'}"></span><div class="main">
      <div class="title">${esc(s.name)} ${s.official ? `<span class="chip dark">${esc(T('Official'))}</span>` : sourceChip(s)} <span class="chip">${esc(T(s.mods === 1 ? '{n} mod' : '{n} mods', { n: s.mods }))}</span></div>
      <div class="sub" style="user-select:text">${esc(s.url)}</div>
      <div class="sub">${esc(s.error ? T('Not reachable: {why}', { why: s.error.message }) + (s.fetchedAt ? ' ' + T('Showing the list from {when}.', { when: ago(s.fetchedAt) }) : '') : T('Last checked {when}', { when: ago(s.fetchedAt) }))}</div>
      ${(s.skipped || []).length ? `<div class="sub">${esc(T('{n} mods skipped because this launcher cannot use them.', { n: s.skipped.length }))}</div>` : ''}</div>
      ${s.official ? '' : `<button class="btn small danger" data-act="source-remove" data-source="${esc(s.id)}">${esc(T('Remove'))}</button>`}</div>`).join('');
  return `<div class="wrap"><div class="page-head"><div class="grow"><div class="label">${esc(T('Sources'))}</div><h2>${esc(T('Where mods come from'))}</h2>
    <p class="lead">${esc(T('The official catalog is built in. Other people can run their own catalog in the same format. Mods from such sources are marked as unofficial everywhere.'))}</p></div>
    <button class="btn primary" data-act="source-add">${esc(T('Add a source'))}</button></div>
    <div class="list"><div class="lhead">${esc(T('Catalog sources'))}</div>${rows}</div></div>`;
}

function viewSettings() {
  const st = S.settings;
  const opt = (v, cur, label) => `<option value="${v}"${(cur || '') === v ? ' selected' : ''}>${esc(label)}</option>`;
  return `<div class="wrap"><div class="page-head"><div class="grow"><div class="label">${esc(T('Settings'))}</div><h2>${esc(T('Settings'))}</h2></div></div>
    <div class="list"><div class="lhead">${esc(T('Appearance'))}</div>
      <div class="lrow"><div class="main"><div class="title">${esc(T('Language'))}</div></div>
        <select class="input" style="width:220px" data-change="lang">${opt('', st.lang, T('Like the system'))}${opt('de', st.lang, 'Deutsch')}${opt('en', st.lang, 'English')}</select></div>
      <div class="lrow"><div class="main"><div class="title">${esc(T('Theme'))}</div></div>
        <select class="input" style="width:220px" data-change="theme">${opt('light', st.theme, T('Light'))}${opt('dark', st.theme, T('Dark'))}</select></div></div>
    <div class="section"><div class="list"><div class="lhead">${esc(T('Finding things'))}</div>
      <div class="lrow"><div class="main"><div class="title">${esc(T('Minecraft folder'))}</div><div class="sub">${esc(st.minecraftPath || T('Only needed if your Minecraft Java is not found by itself.'))}</div></div>
        ${st.minecraftPath ? `<button class="btn small" data-act="mc-clear">${esc(T('Reset'))}</button>` : ''}<button class="btn small" data-act="mc-pick">${esc(T('Choose folder'))}</button></div>
      <div class="lrow"><div class="main"><div class="title">${esc(T('Launcher data'))}</div><div class="sub">${esc(T('Saved mod data, downloads and logs.'))}</div></div>
        <button class="btn small" data-act="open-data">${ico('folder', 14)} ${esc(T('Open folder'))}</button></div></div></div>
    <div class="section"><div class="list"><div class="lhead">${esc(T('About'))}</div>
      <div class="kv"><span class="k">${esc(T('Version'))}</span><span class="v">${esc(S.brand.name)} ${esc(S.version)}</span></div>
      <div class="kv"><span class="k">${esc(T('Updates'))}</span><span class="v">${esc(T('The launcher looks for a new release on start and every few hours, downloads it in the background and installs it when you quit.'))}</span></div></div></div></div>`;
}

// ---- modals --------------------------------------------------------------------
function openModal(m) { modal = m; renderModal(); }
function closeModal() { modal = null; renderModal(); }

function warningText() {
  return `<p><b>${esc(T('Mods are program code.'))}</b> ${esc(T('A mod runs inside the game with the same rights you have on this PC. It can read, change and send your files.'))}</p>
    <p>${esc(T('{app} does not check mods from unofficial sources. Nobody does.', { app: S.brand.name }))}</p>
    <p>${esc(T('The checksum only proves that a file arrived unchanged. It does not prove that the file is safe.'))}</p>
    <p><b>${esc(T('Only add sources from people you know and trust. A source can deliver a virus.'))}</b></p>`;
}

function renderModal() {
  const back = $('modalBackdrop');
  if (!modal) { back.hidden = true; return; }
  back.hidden = false;
  let h = '';
  if (modal.type === 'source-add') {
    h = `<div class="mhead warn">${esc(T('Add an unofficial source'))}</div><div class="mbody">
      <label class="field"><span>${esc(T('GitHub repository or catalog address'))}</span><input class="input" id="srcUrl" placeholder="https://github.com/name/repository" value="${esc(modal.url || '')}"></label>
      ${warningText()}
      <label class="agree"><div class="check${modal.agree ? ' on' : ''}" data-act="agree">${ico('check', 14)}</div><span>${esc(T('I understand the risk and I trust this source.'))}</span></label>
      ${modal.error ? `<div class="err">${esc(modal.error)}</div>` : ''}</div>
      <div class="mfoot"><button class="btn" data-act="modal-close">${esc(T('Cancel'))}</button><button class="btn primary" data-act="source-add-go" ${modal.agree ? '' : 'disabled'}>${esc(T('Add source'))}</button></div>`;
  } else if (modal.type === 'confirm-download') {
    h = `<div class="mhead warn">${esc(T('Download from an unofficial source'))}</div><div class="mbody">
      <p>${esc(T('You are about to download from:'))} <b>${esc(modal.sources.map((s) => s.name).join(', '))}</b></p>${warningText()}</div>
      <div class="mfoot"><button class="btn" data-act="modal-close">${esc(T('Cancel'))}</button><button class="btn primary" data-act="confirm-go">${esc(T('Download anyway'))}</button></div>`;
  } else if (modal.type === 'source-remove') {
    h = `<div class="mhead">${esc(T('Remove source'))}</div><div class="mbody"><p>${esc(T('Remove {name}? Its mods disappear from the list and its downloaded packages are deleted. Data the mods saved stays.', { name: modal.name }))}</p></div>
      <div class="mfoot"><button class="btn" data-act="modal-close">${esc(T('Cancel'))}</button><button class="btn primary" data-act="source-remove-go">${esc(T('Remove'))}</button></div>`;
  } else if (modal.type === 'pack') {
    const p = modal.pack;
    const rows = modsOf(p.gameId).map((m) => {
      const on = p.mods.some((r) => r.id === m.id);
      return `<div class="lrow click" data-act="pack-toggle" data-mod="${esc(m.id)}"><div class="check${on ? ' on' : ''}">${ico('check', 14)}</div><div class="main"><div class="title">${esc(tx(m.name))} ${modChips(m)}</div></div>${downloadChip(m)}</div>`;
    }).join('');
    const gone = p.mods.filter((r) => !modOf(r.id)).map((r) => `<div class="lrow"><div class="main"><div class="title">${esc(r.id)} <span class="chip bad">${esc(T('not available'))}</span></div></div>
      <button class="btn small" data-act="pack-drop" data-mod="${esc(r.id)}">${esc(T('Remove'))}</button></div>`).join('');
    h = `<div class="mhead">${esc(p.id ? T('Edit modpack') : T('New modpack'))} · ${esc((gameOf(p.gameId) || { name: p.gameId }).name)}</div><div class="mbody">
      <label class="field"><span>${esc(T('Name'))}</span><input class="input" id="packName" maxlength="60" value="${esc(p.name)}" placeholder="${esc(T('Friday night'))}"></label>
      <div class="field"><span>${esc(T('Mods in this pack'))}</span><div class="picklist">${rows}${gone}</div></div>
      ${modal.problems && modal.problems.length ? modal.problems.map((x) => `<div class="err">${esc(problemText(x))}</div>`).join('') : ''}
      ${modal.error ? `<div class="err">${esc(modal.error)}</div>` : ''}
      <p>${esc(T('Mods you add are downloaded when you save. Settings and saved data belong to each mod, not to the pack.'))}</p></div>
      <div class="mfoot">${p.id ? `<button class="btn danger" data-act="pack-delete">${esc(T('Delete pack'))}</button><span style="flex:1"></span>` : ''}
      <button class="btn" data-act="modal-close">${esc(T('Cancel'))}</button><button class="btn primary" data-act="pack-save">${esc(T('Save'))}</button></div>`;
  } else if (modal.type === 'pack-share') {
    h = `<div class="mhead">${esc(T('Share modpack'))}</div><div class="mbody"><p>${esc(T('Send this code to your friends. In their launcher: Modpacks, Import code. It lists the mods, their versions and where they come from, nothing else.'))}</p>
      <textarea class="input" readonly rows="5">${esc(modal.code)}</textarea></div>
      <div class="mfoot"><button class="btn" data-act="modal-close">${esc(T('Close'))}</button><button class="btn primary" data-act="copy-code">${esc(T('Copy code'))}</button></div>`;
  } else if (modal.type === 'pack-import') {
    const r = modal.result;
    let info = '';
    if (r) {
      const names = r.pack.mods.map((x) => (modOf(x.id) ? tx(modOf(x.id).name) : x.id) + (x.version ? ' ' + x.version : ''));
      info = `<div class="list"><div class="lhead">${esc(r.pack.name)}</div><div class="lrow"><div class="main sub">${esc(names.join(', '))}</div></div></div>`;
      if (!r.gameKnown) info += `<div class="err">${esc(T('This pack is for a game your catalogs do not know.'))}</div>`;
      if (r.missingSources.length) info += `<div class="banner bad"><div class="grow"><b>${esc(T('This pack uses unofficial sources you have not added:'))}</b>${r.missingSources.map((s) => `<div style="user-select:text">${esc(s.url)}</div>`).join('')}
        <div class="muted">${esc(T('Add them under Sources if you trust them. Until then those mods are missing from the pack.'))}</div></div></div>`;
      else if (r.missing.length) info += `<div class="err">${esc(T('{n} mods of this pack are not in your catalogs.', { n: r.missing.length }))}</div>`;
      if (r.changed.length) info += `<p>${esc(T('{n} mods have a different version in the catalog now. You get the current one, and everyone in a lobby needs the same version.', { n: r.changed.length }))}</p>`;
    }
    h = `<div class="mhead">${esc(T('Import modpack'))}</div><div class="mbody">
      <label class="field"><span>${esc(T('Modpack code'))}</span><textarea class="input" id="packCode" rows="4" placeholder="KB1-...">${esc(modal.code || '')}</textarea></label>
      ${info}${modal.error ? `<div class="err">${esc(modal.error)}</div>` : ''}</div>
      <div class="mfoot"><button class="btn" data-act="modal-close">${esc(T('Cancel'))}</button>
      ${r && r.gameKnown ? `<button class="btn primary" data-act="pack-import-save">${esc(T('Save pack'))}</button>` : `<button class="btn primary" data-act="pack-import-read">${esc(T('Read code'))}</button>`}</div>`;
  } else if (modal.type === 'pack-pick') {
    const list = packsOf(modal.gameId).map((p) => `<div class="lrow click" data-act="pack-pick-go" data-pack="${esc(p.id)}"><div class="main"><div class="title">${esc(p.name)}</div></div></div>`).join('');
    h = `<div class="mhead">${esc(T('Add to modpack'))}</div><div class="mbody"><div class="picklist">${list}<div class="lrow click" data-act="pack-pick-go" data-pack=""><div class="main"><div class="title">${esc(T('New pack'))}</div></div></div></div></div>
      <div class="mfoot"><button class="btn" data-act="modal-close">${esc(T('Cancel'))}</button></div>`;
  }
  $('modal').innerHTML = h;
}

// ---- render --------------------------------------------------------------------
function render() {
  if (!S) return;
  document.body.dataset.theme = S.settings.theme === 'dark' ? 'dark' : 'light';
  document.documentElement.lang = S.lang;
  window.setLang(S.lang);
  renderNav();
  renderTopbar();
  const v = $('view');
  const top = v.scrollTop;
  const html = { home: viewHome, game: viewGame, mod: viewMod, library: viewLibrary, sources: viewSources, settings: viewSettings }[view.name]();
  v.innerHTML = html;
  v.scrollTop = render.last === JSON.stringify(view) ? top : 0;
  render.last = JSON.stringify(view);
  renderLaunchBar();
}

async function reload() {
  S = await api.getState();
  for (const k of Object.keys(checks)) delete checks[k];
  render();
  if (modal) renderModal();
}

function go(v) {
  view = v;
  if (v.name === 'mod') { const m = modOf(v.modId); if (m && (m.isNew || m.isUpdated)) api.markSeen(v.modId).then(reload); }
  render();
}

// ---- actions -------------------------------------------------------------------
// Runs something that may need the unofficial-source confirmation first.
async function withConfirm(call) {
  let r = await call(false);
  if (r && r.needsConfirm) {
    const ok = await new Promise((resolve) => openModal({ type: 'confirm-download', sources: r.needsConfirm, resolve }));
    closeModal();
    if (!ok) return null;
    r = await call(true);
  }
  if (r && r.error) toast(problemText(r));
  return r;
}

async function launch(gameId, ids) {
  const r = await withConfirm((c) => api.launch(gameId, ids, c));
  if (r && r.started) go({ name: 'game', gameId });
}

async function download(id) {
  await withConfirm((c) => api.downloadMod(id, c));
  await reload();
}

async function savePack() {
  const p = modal.pack;
  p.name = $('packName').value;
  const mods = p.mods.map((r) => ({ id: r.id, version: modOf(r.id) ? modOf(r.id).version : r.version }));
  const r = await api.savePack({ id: p.id, name: p.name, gameId: p.gameId, mods });
  if (r.error) { modal.error = r.code === 'pack-name' ? T('Give the pack a name.') : r.error; return renderModal(); }
  closeModal();
  await reload();
  view = { name: 'game', gameId: p.gameId, tab: 'packs' };
  render();
  // adding a mod to a pack downloads it
  for (const ref of mods) { const m = modOf(ref.id); if (m && m.download.state !== 'ready') await download(m.id); }
}

async function checkPack() {
  const ids = modal.pack.mods.map((r) => r.id).filter(modOf);
  modal.problems = [];
  if (ids.length) { const r = await api.checkMods(modal.pack.gameId, ids); modal.problems = (r.problems || []).filter((p) => p.code !== 'game-running'); }
  if (modal && modal.type === 'pack') { const n = $('packName'); if (n) modal.pack.name = n.value; renderModal(); }
}

const ACTIONS = {
  go: (d) => go(JSON.parse(d.view)),
  tab: (d) => { view = { ...view, tab: d.tab }; render(); },
  refresh: async () => { toast(T('Checking the catalogs')); S = await api.refreshCatalog(); render(); },
  toggle: (d) => { const s = sel(view.gameId); if (s.has(d.mod)) s.delete(d.mod); else s.add(d.mod); render(); },
  launch: () => launch(view.gameId, [...sel(view.gameId)]),
  'launch-one': (d) => launch(view.gameId, [d.mod]),
  download: (d) => download(d.mod),
  'delete-package': async (d) => { await api.deletePackage(d.mod); reload(); },
  'dismiss-session': async (d) => { await api.dismissSession(d.game); reload(); },
  'open-game': (d) => api.openGame(d.game),
  'open-log': async (d) => { if (await api.openLog(d.game) === 'missing') toast(T('No log was written.')); },
  'open-data': () => api.openData(),
  'install-update': () => api.installUpdate(),
  import: async (d) => { await api.importData(d.game, d.mod); toast(T('Copied into the launcher')); reload(); },
  'import-no': async (d) => { await api.dismissImport(d.game, d.mod); reload(); },
  'mc-pick': async () => { const p = await api.pickFolder(); if (p) { S = await api.saveSettings({ minecraftPath: p }); render(); } },
  'mc-clear': async () => { S = await api.saveSettings({ minecraftPath: '' }); render(); },

  'modal-close': () => { if (modal && modal.resolve) modal.resolve(false); closeModal(); },
  'confirm-go': () => modal.resolve(true),
  agree: () => { modal.url = $('srcUrl').value; modal.agree = !modal.agree; renderModal(); },
  'source-add': () => openModal({ type: 'source-add', agree: false }),
  'source-add-go': async () => {
    modal.url = $('srcUrl').value;
    const r = await api.addSource(modal.url, modal.agree === true);
    if (r.error) { modal.error = r.code === 'source-duplicate' ? T('This source is already in the list.') : T('That address does not work: {why}', { why: r.error }); return renderModal(); }
    closeModal();
    await reload();
    if (r.info && r.info.error) toast(T('Added, but the catalog could not be read yet.'));
  },
  'source-remove': (d) => openModal({ type: 'source-remove', id: d.source, name: S.sources.find((s) => s.id === d.source).name }),
  'source-remove-go': async () => { await api.removeSource(modal.id); closeModal(); reload(); },

  'pack-new': () => { openModal({ type: 'pack', pack: { name: '', gameId: view.gameId, mods: [] } }); },
  'pack-from-selection': () => { openModal({ type: 'pack', pack: { name: '', gameId: view.gameId, mods: [...sel(view.gameId)].map((id) => ({ id })) } }); checkPack(); },
  'pack-edit': (d) => { const p = S.packs.find((x) => x.id === d.pack); openModal({ type: 'pack', pack: JSON.parse(JSON.stringify(p)) }); checkPack(); },
  'pack-toggle': (d) => {
    const p = modal.pack; p.name = $('packName').value;
    const at = p.mods.findIndex((r) => r.id === d.mod);
    if (at >= 0) p.mods.splice(at, 1); else p.mods.push({ id: d.mod });
    renderModal(); checkPack();
  },
  'pack-drop': (d) => { modal.pack.name = $('packName').value; modal.pack.mods = modal.pack.mods.filter((r) => r.id !== d.mod); renderModal(); },
  'pack-save': savePack,
  'pack-delete': async () => { await api.removePack(modal.pack.id); closeModal(); reload(); },
  'pack-launch': (d) => { const p = S.packs.find((x) => x.id === d.pack); launch(p.gameId, p.mods.map((r) => r.id).filter(modOf)); },
  'pack-share': async (d) => { const r = await api.exportPack(d.pack); if (r.code) openModal({ type: 'pack-share', code: r.code }); },
  'copy-code': async () => { await api.copyText(modal.code); toast(T('Code copied')); },
  'pack-import': () => openModal({ type: 'pack-import' }),
  'pack-import-read': async () => {
    modal.code = $('packCode').value;
    const r = await api.importPack(modal.code);
    if (r.error) { modal.error = T('This is not a valid modpack code.'); modal.result = null; } else { modal.error = null; modal.result = r; }
    renderModal();
  },
  'pack-import-save': async () => {
    const p = modal.result.pack;
    closeModal();
    openModal({ type: 'pack', pack: { name: p.name, gameId: p.gameId, mods: p.mods } });
    checkPack();
  },
  'pack-add': (d) => openModal({ type: 'pack-pick', gameId: view.gameId, modId: d.mod }),
  'pack-pick-go': (d) => {
    const existing = S.packs.find((x) => x.id === d.pack);
    const pack = existing ? JSON.parse(JSON.stringify(existing)) : { name: '', gameId: modal.gameId, mods: [] };
    if (!pack.mods.some((r) => r.id === modal.modId)) pack.mods.push({ id: modal.modId });
    openModal({ type: 'pack', pack }); checkPack();
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  e.stopPropagation();
  const fn = ACTIONS[el.dataset.act];
  if (fn) fn(el.dataset);
});
document.addEventListener('change', async (e) => {
  const key = e.target.dataset && e.target.dataset.change;
  if (!key) return;
  S = await api.saveSettings({ [key]: e.target.value || null });
  render();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal) ACTIONS['modal-close'](); });

api.onChanged(reload);
api.onSession((s) => { if (S) { S.sessions = s; render(); } });
api.onDownload((d) => { if (S) { S.downloads = d; render(); } });
api.onUpdate((u) => { if (S) { S.update = u; renderNav(); } });

window.__go = (v) => { view = v; render(); };   // used by the screenshot script
window.__modal = openModal;
reload();
