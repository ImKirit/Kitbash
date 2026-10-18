/* views.js: Home, Modpacks, History, News, Account and the account button.
   Loaded after app.js and uses its helpers. Functions that app.js calls by
   name are replaced through window so the newer version wins. */
'use strict';

Object.assign(ICONS, {
  gear: '<path d="M10.3 3.2h3.4l.5 2.3 1.6.9 2.2-.8 1.7 2.9-1.7 1.6v1.8l1.7 1.6-1.7 2.9-2.2-.8-1.6.9-.5 2.3h-3.4l-.5-2.3-1.6-.9-2.2.8-1.7-2.9 1.7-1.6v-1.8L4.3 8.5 6 5.6l2.2.8 1.6-.9z"/><circle cx="12" cy="12" r="2.8"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  news: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M7 9h10M7 12.5h10M7 16h6"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.2-3.8 4.2-5.5 7.5-5.5s6.3 1.7 7.5 5.5"/>',
  star: '<path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.8 6.9 19.4l1-5.6-4.1-4 5.7-.8z"/>',
  starOn: '<path fill="currentColor" d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.8 6.9 19.4l1-5.6-4.1-4 5.7-.8z"/>',
  logout: '<path d="M14 4h5v16h-5"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
  sync: '<path d="M19 9a7 7 0 0 0-12.5-2.5L5 8"/><path d="M5 4v4h4"/><path d="M5 15a7 7 0 0 0 12.5 2.5L19 16"/><path d="M19 20v-4h-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  discord: '<path fill="currentColor" d="M19.3 5.4A16 16 0 0 0 15.4 4l-.5 1a14.6 14.6 0 0 0-5.8 0l-.5-1a16 16 0 0 0-3.9 1.4C2.2 9.1 1.6 12.7 1.9 16.2a16 16 0 0 0 4.8 2.4l1-1.6a10 10 0 0 1-1.6-.8l.4-.3a11.4 11.4 0 0 0 11 0l.4.3c-.5.3-1 .6-1.6.8l1 1.6a16 16 0 0 0 4.8-2.4c.4-4.1-.7-7.6-2.8-10.8zM8.7 14.1c-1 0-1.7-.9-1.7-2s.8-2 1.7-2 1.8.9 1.7 2c0 1.1-.8 2-1.7 2zm6.6 0c-1 0-1.7-.9-1.7-2s.8-2 1.7-2 1.8.9 1.7 2c0 1.1-.7 2-1.7 2z"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
});

addDE({
  'History': 'Verlauf', 'News': 'Neuigkeiten', 'Account': 'Konto', 'Library': 'Bibliothek', 'Play': 'Spielen',
  'Featured': 'Empfohlen', 'Continue': 'Weiterspielen', 'New and updated': 'Neu und aktualisiert', 'Your games': 'Deine Spiele',
  'Details': 'Details', 'Play again': 'Nochmal spielen', 'Sign in': 'Anmelden', 'Sign in with Discord': 'Mit Discord anmelden',
  'Sign out': 'Abmelden', 'Sync now': 'Jetzt synchronisieren', 'Synced {when}': 'Synchronisiert {when}', 'Not synced yet': 'Noch nicht synchronisiert',
  'Waiting for the browser': 'Warte auf den Browser', 'Finish the sign-in in your browser. This window picks it up by itself.': 'Schließ die Anmeldung im Browser ab. Dieses Fenster merkt es von selbst.',
  'Cancel sign-in': 'Anmeldung abbrechen', 'Copy link': 'Link kopieren',
  'Optional. Signed in, your modpacks, favourites, a few settings and your session history follow you to every PC. Without an account everything stays on this PC and works the same.':
    'Freiwillig. Angemeldet folgen dir deine Modpacks, Favoriten, ein paar Einstellungen und dein Sitzungsverlauf auf jeden PC. Ohne Konto bleibt alles auf diesem PC und funktioniert genauso.',
  'What is synced': 'Was synchronisiert wird', 'Modpacks': 'Modpacks', 'Favourites': 'Favoriten', 'Language, theme and overlay settings': 'Sprache, Design und Overlay-Einstellungen',
  'Session history': 'Sitzungsverlauf', 'Never synced: mod data, downloads, game folders, sources.': 'Nie synchronisiert: Mod-Daten, Downloads, Spielordner, Quellen.',
  'Kitbash only learns your Discord name and picture. It cannot read your messages or servers.': 'Kitbash erfährt nur deinen Discord-Namen und dein Bild. Nachrichten und Server kann es nicht lesen.',
  'Sign-in failed: {why}': 'Anmeldung fehlgeschlagen: {why}', 'You were signed out. Sign in again to keep syncing.': 'Du wurdest abgemeldet. Melde dich erneut an, um weiter zu synchronisieren.',
  'Past sessions': 'Vergangene Sitzungen', 'No sessions yet. Launch a mod and it shows up here.': 'Noch keine Sitzungen. Starte eine Mod, dann erscheint sie hier.',
  'Clear history': 'Verlauf leeren', 'finished': 'beendet', 'did not start': 'nicht gestartet', 'stopped at: {stage}': 'abgebrochen bei: {stage}',
  '{n} min': '{n} Min.', 'under a minute': 'unter einer Minute', 'Mods and updates': 'Mods und Updates', 'Launcher changes': 'Änderungen am Launcher',
  'new': 'neu', 'updated': 'aktualisiert', 'Released {date}': 'Veröffentlicht {date}',
  'Search modpacks': 'Modpacks suchen', 'Last played': 'Zuletzt gespielt', 'Name': 'Name', 'All games': 'Alle Spiele',
  'Pick a game': 'Spiel wählen', 'Search games': 'Spiele suchen', 'Recent and installed': 'Zuletzt und installiert', 'More games': 'Weitere Spiele',
  'You have no modpacks yet. Create one, or save the mods you ticked on a game page as a pack.': 'Du hast noch keine Modpacks. Leg eins an oder speichere die angehakten Mods einer Spielseite als Pack.',
  'No pack matches.': 'Kein Pack passt.', 'never played': 'nie gespielt', 'played {when}': 'gespielt {when}',
  'Add to favourites': 'Zu Favoriten', 'Remove from favourites': 'Aus Favoriten entfernen', 'Overlay opacity': 'Deckkraft des Overlays',
  'How solid the panel in the game looks.': 'Wie deckend das Fenster im Spiel aussieht.', 'Quick launch': 'Schnellstart',
});

// ---- small pieces ---------------------------------------------------------------
function avatar(user, px) {
  if (user && user.avatar) return `<img class="avatar" src="${esc(user.avatar)}" width="${px}" height="${px}" alt="">`;
  const l = user && user.name ? user.name.slice(0, 1).toUpperCase() : '?';
  return `<span class="avatar letter" style="width:${px}px;height:${px}px;font-size:${Math.round(px * 0.45)}px">${esc(l)}</span>`;
}
const isFav = (id) => (S.favorites || []).includes(id);
function banner(g) {
  return g && g.banner ? `<img class="banner-img" src="${esc(g.banner)}" alt="">` : `<div class="banner-img none">${gicon(g, 40)}</div>`;
}
function duration(a, b) {
  const min = Math.round((Date.parse(b) - Date.parse(a)) / 60000);
  return min < 1 ? T('under a minute') : T('{n} min', { n: min });
}

// ---- navigation and the account button -------------------------------------------
window.renderNav = function renderNav() {
  const item = (v, icon, label, count, extra = '') => {
    const on = view.name === v.name || (v.name === 'browse' && ['game', 'mod'].includes(view.name));
    return `<div class="nav-item${on ? ' active' : ''}" data-act="go" data-view='${esc(JSON.stringify(v))}'>${ico(icon)}<span>${esc(label)}</span>${extra}${count ? `<span class="count">${count}</span>` : ''}</div>`;
  };
  let html = item({ name: 'home' }, 'home', T('Home'));
  html += item({ name: 'browse' }, 'grid', T('Browse'), S.games.filter((g) => g.status === 'available').length);
  html += item({ name: 'packs' }, 'layers', T('Modpacks'), S.packs.length);
  for (const s of Object.values(S.sessions).filter((x) => !x.result)) {
    const g = gameOf(s.gameId);
    if (g) html += `<div class="nav-item live" data-act="go" data-view='${esc(JSON.stringify({ name: 'game', gameId: g.id }))}'>${gicon(g, 16)}<span>${esc(T('{game} is running', { game: g.name }))}</span><span class="dot live"></span></div>`;
  }
  html += `<div class="side-head">${esc(T('Library'))}</div>`;
  html += item({ name: 'library' }, 'down', T('Downloads'), S.library.length);
  html += item({ name: 'history' }, 'clock', T('History'), (S.history || []).length);
  const fresh = S.mods.filter((m) => m.isNew || m.isUpdated).length;
  html += item({ name: 'news' }, 'news', T('News'), fresh);
  html += `<div class="side-head">${esc(T('More'))}</div>`;
  html += item({ name: 'sources' }, 'link', T('Sources'), S.sources.length);
  html += item({ name: 'settings' }, 'gear', T('Settings'));
  html += item({ name: 'account' }, 'user', T('Account'));
  $('nav').innerHTML = html;
  $('tbName').textContent = S.brand.name;
  const titles = { home: T('Home'), browse: T('Browse'), packs: T('Modpacks'), library: T('Downloads'), sources: T('Sources'), settings: T('Settings'), history: T('History'), news: T('News'), account: T('Account') };
  const g0 = view.gameId ? gameOf(view.gameId) : null;
  $('tbTitle').textContent = view.name === 'mod' && modOf(view.modId) ? tx(modOf(view.modId).name) : g0 ? g0.name : titles[view.name] || '';
  const u = S.update;
  let line = `<span class="ver">v${esc(S.version)}</span> `;
  if (u.status === 'downloading') line += esc(T('Update {v} is downloading', { v: u.version })) + ` ${u.percent} %`;
  else if (u.status === 'ready') line += esc(T('Update {v} is ready', { v: u.version }));
  else if (u.status === 'current') line += esc(T('up to date'));
  else if (u.status === 'dev') line += esc(T('development build'));
  $('sideBottom').innerHTML = line + (u.status === 'ready' ? `<button class="btn small primary" data-act="install-update">${esc(T('Restart and update'))}</button>` : '');
};

const origTopbar = window.renderTopbar;
window.renderTopbar = function renderTopbar() {
  origTopbar();
  const a = S.account || {};
  const pill = a.signedIn && a.user
    ? `<button class="account-pill" data-act="account-menu">${avatar(a.user, 26)}<span>${esc(a.user.name)}</span></button>`
    : a.linking ? `<button class="account-pill" data-act="go" data-view='{"name":"account"}'><span class="spin"></span><span>${esc(T('Waiting for the browser'))}</span></button>`
      : `<button class="account-pill signin" data-act="account-login">${ico('discord', 15)}<span>${esc(T('Sign in'))}</span></button>`;
  $('topbar').insertAdjacentHTML('beforeend', pill);
};

function accountMenu() {
  const a = S.account;
  return [
    { label: a.user.name + '  ·  ' + (a.lastSync ? T('Synced {when}', { when: ago(a.lastSync) }) : T('Not synced yet')) },
    { icon: 'sync', text: T('Sync now'), act: () => api.accountSync().then(reload) },
    { icon: 'user', text: T('Account'), act: () => go({ name: 'account' }) },
    { icon: 'gear', text: T('Settings'), act: () => go({ name: 'settings' }) },
    { icon: 'link', text: T('Sources'), act: () => go({ name: 'sources' }) },
    '-',
    { icon: 'logout', text: T('Sign out'), act: () => api.accountLogout().then(reload), danger: true },
  ];
}

// ---- home -----------------------------------------------------------------------
function featured() {
  const withImg = S.mods.filter((m) => (m.images || []).length);
  const fav = withImg.find((m) => isFav(m.id));
  if (fav) return fav;
  return [...withImg].sort((a, b) => String(b.released || '').localeCompare(String(a.released || '')) || (b.images.length - a.images.length))[0] || null;
}

window.viewHome = function viewHome() {
  let html = `<div class="wrap">${sessionBanners()}${importBanner()}`;
  const f = featured();
  if (f) {
    const g = gameOf(f.game);
    const img = imgUrl(f, f.images[0]);
    html += `<section class="hero-feature">${img ? `<img class="hf-img" src="${esc(img)}" alt="">` : ''}<div class="hf-shade"></div>
      <div class="hf-body"><div class="label">${ico('bolt', 12)} ${esc(T('Featured'))}</div>
        <h1>${esc(tx(f.name))}</h1><p class="lead">${esc(tx(f.summary))}</p>
        <div class="row hf-meta"><span class="of-game">${gicon(g, 18)}${esc(g ? g.name : '')}</span>${modChips(f)}</div>
        <div class="row hf-acts"><button class="btn primary big" data-act="launch-one" data-mod="${esc(f.id)}" data-game="${esc(f.game)}" ${!g || !g.installed ? 'disabled' : ''}>${ico('play', 14)} ${esc(T('Play'))}</button>
          <button class="btn big" data-act="go" data-view='${esc(JSON.stringify({ name: 'mod', gameId: f.game, modId: f.id }))}'>${esc(T('Details'))}</button>
          <button class="kebab" data-act="fav" data-mod="${esc(f.id)}" title="${esc(T(isFav(f.id) ? 'Remove from favourites' : 'Add to favourites'))}">${ico(isFav(f.id) ? 'starOn' : 'star', 17)}</button></div></div></section>`;
  }

  // continue: last distinct sessions that actually ran
  const seen = new Set();
  const recent = (S.history || []).filter((h) => { const k = h.gameId + '|' + h.modIds.join(','); if (seen.has(k) || !gameOf(h.gameId)) return false; seen.add(k); return true; }).slice(0, 4);
  if (recent.length) {
    html += `<div class="section"><div class="sec-head">${ico('clock', 14)}<span>${esc(T('Continue'))}</span><span class="grow"></span><a data-act="go" data-view='{"name":"history"}'>${esc(T('History'))}</a></div><div class="tiles">`;
    for (const h of recent) {
      const g = gameOf(h.gameId);
      html += `<div class="tile">${banner(g)}<div class="tile-body"><div class="of-game">${gicon(g, 18)}<b>${esc(g.name)}</b></div>
        <div class="sub">${esc(h.packName ? h.packName + ' · ' : '')}${esc(h.modNames.join(', '))}</div><div class="sub">${esc(ago(h.startedAt))}</div>
        <button class="btn small primary" data-act="relaunch" data-game="${esc(h.gameId)}" data-mods="${esc(h.modIds.join(','))}" ${!g.installed || isActive(g.id) ? 'disabled' : ''}>${ico('play', 11)} ${esc(T('Play again'))}</button></div></div>`;
    }
    html += '</div></div>';
  }

  const packs = [...S.packs].sort((a, b) => String(b.lastPlayed || b.updatedAt || '').localeCompare(String(a.lastPlayed || a.updatedAt || ''))).slice(0, 4);
  if (packs.length) {
    html += `<div class="section"><div class="sec-head">${ico('layers', 14)}<span>${esc(T('Quick launch'))}</span><span class="grow"></span><a data-act="go" data-view='{"name":"packs"}'>${esc(T('Modpacks'))}</a></div><div class="list">${packs.map(packRow).join('')}</div></div>`;
  }

  const fresh = [...S.mods].sort((a, b) => Number(b.isNew || b.isUpdated) - Number(a.isNew || a.isUpdated) || String(b.released || '').localeCompare(String(a.released || ''))).slice(0, 6);
  html += `<div class="section"><div class="sec-head">${ico('news', 14)}<span>${esc(T('New and updated'))}</span><span class="grow"></span><a data-act="go" data-view='{"name":"news"}'>${esc(T('News'))}</a></div><div class="cards3">`;
  for (const m of fresh) {
    const g = gameOf(m.game);
    const img = (m.images || [])[0] ? imgUrl(m, m.images[0]) : null;
    html += `<div class="card click modcard" data-act="go" data-view='${esc(JSON.stringify({ name: 'mod', gameId: m.game, modId: m.id }))}'>
      ${img ? `<img class="mc-img" src="${esc(img)}" alt="">` : `<div class="mc-img none">${banner(g)}</div>`}
      <div class="mc-body"><div class="title">${esc(tx(m.name))}</div><div class="sub of-game">${gicon(g, 14)}${esc(g ? g.name : '')}</div><div class="row">${modChips(m)}</div></div></div>`;
  }
  html += '</div></div>';

  html += `<div class="section"><div class="sec-head">${ico('game', 14)}<span>${esc(T('Your games'))}</span><span class="grow"></span><a data-act="go" data-view='{"name":"browse"}'>${esc(T('Browse'))}</a></div><div class="tiles">`;
  for (const g of S.games.filter((x) => x.status === 'available')) {
    html += `<div class="tile click" data-act="go" data-view='${esc(JSON.stringify({ name: 'game', gameId: g.id }))}'>${banner(g)}<div class="tile-body"><div class="of-game">${gicon(g, 18)}<b>${esc(g.name)}</b></div>
      <div class="row">${gameStatus(g)}<span class="sub">${esc(T(modsOf(g.id).length === 1 ? '{n} mod' : '{n} mods', { n: modsOf(g.id).length }))}</span></div></div></div>`;
  }
  return html + '</div></div>';
};

// Browse: banner art on the cards
window.viewBrowse = function viewBrowse() {
  const q = query.trim().toLowerCase();
  const games = S.games.filter((g) => !q || g.name.toLowerCase().includes(q));
  const hits = q ? S.mods.filter((m) => [tx(m.name), tx(m.summary), m.author, (gameOf(m.game) || {}).name].join(' ').toLowerCase().includes(q)) : [];
  let html = `<div class="wrap"><div class="page-head"><div class="grow"><div class="label">${esc(T('Browse'))}</div><h2>${esc(T('All games'))}</h2></div>
    <label class="search">${ico('search', 15)}<input id="browseQuery" placeholder="${esc(T('Search games and mods'))}" value="${esc(query)}"></label></div><div class="tiles big">`;
  for (const g of games) {
    const off = g.status !== 'available';
    const n = modsOf(g.id).length;
    html += `<div class="tile ${off ? 'off' : 'click'}" ${off ? '' : `data-act="go" data-view='${esc(JSON.stringify({ name: 'game', gameId: g.id }))}'`}>${banner(g)}
      <div class="tile-body"><div class="of-game">${gicon(g, 22)}<b>${esc(g.name)}</b>${sourceChip(g.source)}</div><div class="sub">${esc(tx(g.tagline))}</div>
      <div class="row">${gameStatus(g)}${off ? '' : `<span class="sub">${esc(T(n === 1 ? '{n} mod' : '{n} mods', { n }))}</span>`}</div></div></div>`;
  }
  html += '</div>';
  if (!games.length && !hits.length) html += `<div class="empty">${esc(T('Nothing found.'))}</div>`;
  if (hits.length) html += `<div class="section"><div class="list"><div class="lhead">${ico('search', 13)}<span>${esc(T('Mods matching "{q}"', { q: query.trim() }))}</span></div>${hits.map((m) => modRow(m, false)).join('')}</div></div>`;
  return html + '</div>';
};

// ---- modpacks: only the user's packs, never a wall of games -----------------------
let packQuery = '';
let packSort = 'played';
let packGame = '';
window.viewPacks = function viewPacks() {
  const gamesWithPacks = [...new Set(S.packs.map((p) => p.gameId))].map(gameOf).filter(Boolean);
  const q = packQuery.trim().toLowerCase();
  let list = S.packs.filter((p) => (!packGame || p.gameId === packGame) && (!q || [p.name, (gameOf(p.gameId) || {}).name, ...p.mods.map((r) => (modOf(r.id) ? tx(modOf(r.id).name) : r.id))].join(' ').toLowerCase().includes(q)));
  list = list.sort((a, b) => (packSort === 'name' ? a.name.localeCompare(b.name) : String(b.lastPlayed || '').localeCompare(String(a.lastPlayed || '')) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))));
  let html = `<div class="wrap"><div class="page-head"><div class="grow"><div class="label">${esc(T('Modpacks'))}</div><h2>${esc(T('Your modpacks'))}</h2></div>
    <button class="btn" data-act="pack-import">${ico('copy', 14)} ${esc(T('Import code'))}</button>
    <button class="btn primary" data-act="pack-new">${ico('plus', 14)} ${esc(T('New pack'))}</button></div>`;
  if (!S.packs.length) return html + `<div class="empty-card">${ico('layers', 28)}<p>${esc(T('You have no modpacks yet. Create one, or save the mods you ticked on a game page as a pack.'))}</p></div></div>`;
  html += `<div class="toolbar"><label class="search">${ico('search', 15)}<input id="packQuery" placeholder="${esc(T('Search modpacks'))}" value="${esc(packQuery)}"></label>
    <div class="chips"><button class="fchip${packGame ? '' : ' on'}" data-act="pack-filter" data-game="">${esc(T('All games'))}</button>
    ${gamesWithPacks.map((g) => `<button class="fchip${packGame === g.id ? ' on' : ''}" data-act="pack-filter" data-game="${esc(g.id)}">${gicon(g, 14)}${esc(g.name)}</button>`).join('')}</div>
    <select class="input" style="width:170px" data-change-local="packSort"><option value="played"${packSort === 'played' ? ' selected' : ''}>${esc(T('Last played'))}</option><option value="name"${packSort === 'name' ? ' selected' : ''}>${esc(T('Name'))}</option></select></div>`;
  html += `<div class="list">${list.length ? list.map((p) => packRow(p).replace('<div class="sub">', `<div class="sub">${esc(p.lastPlayed ? T('played {when}', { when: ago(p.lastPlayed) }) : T('never played'))} · `)).join('') : `<div class="empty">${esc(T('No pack matches.'))}</div>`}</div>`;
  return html + '</div>';
};

// game picker for a new pack: recent and installed games first, searchable
let pickQuery = '';
function gamePicker() {
  const recent = new Set((S.history || []).map((h) => h.gameId));
  const games = S.games.filter((g) => g.status === 'available' && (!pickQuery || g.name.toLowerCase().includes(pickQuery.toLowerCase())));
  const top = games.filter((g) => recent.has(g.id) || g.installed);
  const rest = games.filter((g) => !top.includes(g));
  const row = (g) => `<div class="lrow click" data-act="pick-game" data-game="${esc(g.id)}">${gicon(g, 26)}<div class="main"><div class="title">${esc(g.name)}</div><div class="sub">${esc(T(modsOf(g.id).length === 1 ? '{n} mod' : '{n} mods', { n: modsOf(g.id).length }))}</div></div>${gameStatus(g)}</div>`;
  return `<div class="mhead">${esc(T('Pick a game'))}</div><div class="mbody"><label class="search" style="max-width:none">${ico('search', 15)}<input id="pickQuery" placeholder="${esc(T('Search games'))}" value="${esc(pickQuery)}"></label>
    <div class="picklist">${top.length ? `<div class="mlabel">${esc(T('Recent and installed'))}</div>${top.slice(0, 30).map(row).join('')}` : ''}${rest.length ? `<div class="mlabel">${esc(T('More games'))}</div>${rest.slice(0, 50).map(row).join('')}` : ''}
    ${!games.length ? `<div class="empty">${esc(T('Nothing found.'))}</div>` : ''}</div></div><div class="mfoot"><button class="btn" data-act="modal-close">${esc(T('Cancel'))}</button></div>`;
}

const origRenderModal = window.renderModal;
window.renderModal = function renderModal() {
  if (modal && modal.type === 'game-pick') {
    $('modalBackdrop').hidden = false;
    $('modal').innerHTML = gamePicker();
    $('modal').classList.remove('lightbox');
    const i = $('pickQuery');
    if (i && modal.focus) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    return;
  }
  origRenderModal();
};

// ---- history ----------------------------------------------------------------------
window.viewHistory = function viewHistory() {
  const list = S.history || [];
  let html = `<div class="wrap"><div class="page-head"><div class="grow"><div class="label">${esc(T('History'))}</div><h2>${esc(T('Past sessions'))}</h2></div>
    ${list.length ? `<button class="btn" data-act="history-clear">${esc(T('Clear history'))}</button>` : ''}</div>`;
  if (!list.length) return html + `<div class="empty-card">${ico('clock', 28)}<p>${esc(T('No sessions yet. Launch a mod and it shows up here.'))}</p></div></div>`;
  html += '<div class="list">';
  for (const h of list) {
    const g = gameOf(h.gameId);
    const result = h.ok ? `<span class="chip ok">${esc(T('finished'))}</span>` : h.played ? `<span class="chip bad">${esc(T('stopped at: {stage}', { stage: h.stage || '?' }))}</span>` : `<span class="chip warn">${esc(T('did not start'))}</span>`;
    html += `<div class="lrow">${gicon(g || { name: h.gameName }, 30)}<div class="main"><div class="title">${esc(h.gameName)}${h.packName ? ` <span class="chip">${esc(h.packName)}</span>` : ''} ${result}</div>
      <div class="sub">${esc(h.modNames.join(', '))}</div><div class="sub">${esc(new Date(h.startedAt).toLocaleString(S.lang))} · ${esc(duration(h.startedAt, h.endedAt))}${h.error ? ' · ' + esc(h.error) : ''}</div></div>
      ${g ? `<button class="btn small" data-act="relaunch" data-game="${esc(h.gameId)}" data-mods="${esc(h.modIds.join(','))}" ${!g.installed || isActive(g.id) ? 'disabled' : ''}>${ico('play', 11)} ${esc(T('Play again'))}</button>` : ''}</div>`;
  }
  return html + '</div></div>';
};

// ---- news -------------------------------------------------------------------------
window.viewNews = function viewNews() {
  const mods = [...S.mods].sort((a, b) => Number(b.isNew || b.isUpdated) - Number(a.isNew || a.isUpdated) || String(b.released || '').localeCompare(String(a.released || '')));
  let html = `<div class="wrap"><div class="page-head"><div class="grow"><div class="label">${esc(T('News'))}</div><h2>${esc(T('Mods and updates'))}</h2></div></div><div class="list">`;
  for (const m of mods) {
    const g = gameOf(m.game);
    const tag = m.isNew ? `<span class="chip dark">${esc(T('new'))}</span>` : m.isUpdated ? `<span class="chip dark">${esc(T('updated'))}</span>` : '';
    html += modRow(m, false).replace('<div class="title">', `<div class="title">${tag}`).replace('<div class="sub">', `<div class="sub">${m.released ? esc(T('Released {date}', { date: m.released })) + ' · ' : ''}`);
    void g;
  }
  html += `</div><div class="section"><div class="sec-head">${ico('box', 14)}<span>${esc(T('Launcher changes'))}</span></div><div class="list">`;
  for (const c of window.CHANGELOG || []) {
    html += `<div class="lrow top"><span class="chip${c.version === S.version ? ' dark' : ''}">${esc(c.version)}</span><div class="main"><div class="sub">${esc(c.date)}</div>${(c[S.lang] || c.en).map((l) => `<div>${esc(l)}</div>`).join('')}</div></div>`;
  }
  return html + '</div></div></div>';
};

// ---- account ----------------------------------------------------------------------
window.viewAccount = function viewAccount() {
  const a = S.account || {};
  let html = `<div class="wrap"><div class="page-head"><div class="grow"><div class="label">${esc(T('Account'))}</div><h2>${esc(T('Account'))}</h2>
    <p class="lead">${esc(T('Optional. Signed in, your modpacks, favourites, a few settings and your session history follow you to every PC. Without an account everything stays on this PC and works the same.'))}</p></div></div>`;
  if (a.error === 'signed-out') html += `<div class="banner warn"><div class="grow">${esc(T('You were signed out. Sign in again to keep syncing.'))}</div></div>`;
  if (a.signedIn && a.user) {
    html += `<div class="list"><div class="acct-me">${avatar(a.user, 52)}<div class="grow"><div class="title" style="font-size:17px">${esc(a.user.name)}</div>
      <div class="sub">${esc(a.lastSync ? T('Synced {when}', { when: ago(a.lastSync) }) : T('Not synced yet'))}${a.error && a.error !== 'signed-out' ? ' · ' + esc(a.error) : ''}</div></div>
      <button class="btn" data-act="account-sync">${ico('sync', 14)} ${esc(T('Sync now'))}</button><button class="btn danger" data-act="account-logout">${ico('logout', 14)} ${esc(T('Sign out'))}</button></div></div>`;
  } else if (a.linking) {
    html += `<div class="list"><div class="acct-me"><span class="spin big"></span><div class="grow"><div class="title">${esc(T('Waiting for the browser'))}</div><div class="sub">${esc(T('Finish the sign-in in your browser. This window picks it up by itself.'))}</div></div>
      ${a.linkUrl ? `<button class="btn" data-act="copy-link">${ico('copy', 14)} ${esc(T('Copy link'))}</button>` : ''}<button class="btn" data-act="account-cancel">${esc(T('Cancel sign-in'))}</button></div></div>`;
  } else {
    html += `<div class="signin-card"><button class="btn discord big" data-act="account-login">${ico('discord', 18)} ${esc(T('Sign in with Discord'))}</button>
      <p class="sub">${esc(T('Kitbash only learns your Discord name and picture. It cannot read your messages or servers.'))}</p></div>`;
  }
  html += `<div class="section"><div class="list"><div class="lhead">${ico('sync', 13)}<span>${esc(T('What is synced'))}</span></div>
    ${[['layers', 'Modpacks'], ['star', 'Favourites'], ['gear', 'Language, theme and overlay settings'], ['clock', 'Session history']].map(([i, t]) => `<div class="lrow">${ico(i, 15)}<div class="main">${esc(T(t))}</div></div>`).join('')}
    <div class="lrow"><div class="main sub">${esc(T('Never synced: mod data, downloads, game folders, sources.'))}</div></div></div></div>`;
  return html + '</div>';
};

// ---- actions ------------------------------------------------------------------------
window.launch = async function launch(gameId, ids, packId) {
  const r = await withConfirm((c) => api.launch(gameId, ids, c, packId));
  if (r && r.started) go({ name: 'game', gameId });
};
const origModMenu = window.modMenu;
window.modMenu = function modMenu(m) {
  const items = origModMenu(m);
  items.splice(1, 0, { icon: isFav(m.id) ? 'starOn' : 'star', text: T(isFav(m.id) ? 'Remove from favourites' : 'Add to favourites'), act: () => api.toggleFavorite(m.id).then(reload) });
  return items;
};
Object.assign(ACTIONS, {
  'account-menu': (_d, el) => openMenu(el, accountMenu()),
  'account-login': async () => { go({ name: 'account' }); const r = await api.accountLogin(); if (r && r.error) toast(T('Sign-in failed: {why}', { why: r.error })); reload(); },
  'account-cancel': () => api.accountCancel().then(reload),
  'account-logout': () => api.accountLogout().then(reload),
  'account-sync': () => api.accountSync().then(reload),
  'copy-link': () => api.copyText(S.account.linkUrl).then(() => toast(T('Copied'))),
  fav: (d) => api.toggleFavorite(d.mod).then(reload),
  relaunch: (d) => launch(d.game, d.mods.split(',').filter((id) => modOf(id))),
  'history-clear': () => api.clearHistory().then(reload),
  'pack-filter': (d) => { packGame = d.game; render(); },
  'pack-new': (d) => { if (d && d.game) openModal({ type: 'pack', pack: { name: '', gameId: d.game, mods: [] } }); else { pickQuery = ''; openModal({ type: 'game-pick' }); } },
  'pick-game': (d) => openModal({ type: 'pack', pack: { name: '', gameId: d.game, mods: [] } }),
  'pack-launch': (d) => { const p = S.packs.find((x) => x.id === d.pack); launch(p.gameId, p.mods.map((r) => r.id).filter(modOf), p.id); },
  'launch-one': (d) => launch(d.game || view.gameId || (modOf(d.mod) || {}).game, [d.mod]),
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'packQuery') { packQuery = e.target.value; render(); const i = $('packQuery'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  if (e.target.id === 'pickQuery') { pickQuery = e.target.value; modal.focus = true; renderModal(); }
});
document.addEventListener('change', (e) => {
  if (e.target.dataset && e.target.dataset.changeLocal === 'packSort') { packSort = e.target.value; render(); }
});

// breadcrumbs for the newer views
const topbarWithAccount = window.renderTopbar;
window.renderTopbar = function renderTopbar() {
  topbarWithAccount();
  const t = { history: T('History'), news: T('News'), account: T('Account') }[view.name];
  const c = $('topbar').querySelector('.crumbs');
  if (t && c) c.insertAdjacentHTML('beforeend', `<span class="sep">/</span><span>${esc(t)}</span>`);
};

// ---- coming soon (catalog "upcoming") ------------------------------------------------
ICONS.gear = '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/><path d="M4 12h3M11 12h9"/><circle cx="9" cy="12" r="0"/>';
ICONS.bell = '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>';
addDE({
  'Coming soon': 'Bald verfügbar', 'Notify me': 'Benachrichtigen', 'Notifying': 'Wird gemeldet',
  'You will see it on Home as soon as it is in the catalog.': 'Du siehst es auf der Startseite, sobald es im Katalog ist.',
  'What it will bring': 'Was es bringen soll', 'Upcoming': 'Demnächst',
});
const notifyKey = (id) => 'upcoming:' + id;
function upcomingArt(u, cls) {
  if (u.banner) return `<img class="${cls}" src="${esc(u.banner)}" alt="">`;
  if (u.logo) return `<div class="${cls} logo-art"><img src="${esc(u.logo)}" alt=""></div>`;
  return `<div class="${cls} none"><span class="gicon fallback" style="width:44px;height:44px;font-size:22px">${esc(u.name.slice(0, 1))}</span></div>`;
}

const homeWithoutUpcoming = window.viewHome;
window.viewHome = function viewHome() {
  const list = S.upcoming || [];
  const feat = list.find((u) => u.featured);
  let html = homeWithoutUpcoming();
  if (feat) {
    const on = isFav(notifyKey(feat.id));
    const hero = `<section class="hero-feature">${upcomingArt(feat, 'hf-img')}
      <div class="hf-body"><div class="label">${ico('bolt', 12)} ${esc(T('Coming soon'))}</div>
        <h1>${esc(tx(feat.title) || feat.name)}</h1><p class="lead">${esc(tx(feat.teaser))}</p>
        <div class="row hf-meta"><span class="chip warn">${esc(tx(feat.status) || T('Coming soon'))}</span></div>
        <div class="row hf-acts"><button class="btn primary big" data-act="teaser" data-id="${esc(feat.id)}">${esc(T('Details'))}</button>
          <button class="btn big" data-act="notify" data-id="${esc(feat.id)}">${ico('bell', 14)} ${esc(T(on ? 'Notifying' : 'Notify me'))}</button></div></div></section>`;
    html = html.replace(/<section class="hero-feature">[\s\S]*?<\/section>/, hero);
    if (!html.includes('hero-feature')) html = html.replace('<div class="wrap">', '<div class="wrap">' + hero);
  }
  const rest = list.filter((u) => !u.featured);
  if (rest.length) {
    const row = `<div class="section"><div class="sec-head">${ico('clock', 14)}<span>${esc(T('Coming soon'))}</span></div><div class="tiles soon">${rest.map((u) => `
      <div class="tile click" data-act="teaser" data-id="${esc(u.id)}">${upcomingArt(u, 'banner-img')}<div class="tile-body"><b>${esc(u.name)}</b>
        <div class="row"><span class="chip">${esc(tx(u.status) || T('Coming soon'))}</span></div></div></div>`).join('')}</div></div>`;
    const at = html.indexOf('</section>');
    html = at > 0 ? html.slice(0, at + 10) + row + html.slice(at + 10) : html.replace('<div class="wrap">', '<div class="wrap">' + row);
  }
  return html;
};

const renderModalBeforeTeaser = window.renderModal;
window.renderModal = function renderModal() {
  if (modal && modal.type === 'teaser') {
    const u = (S.upcoming || []).find((x) => x.id === modal.id);
    if (!u) { closeModal(); return; }
    const on = isFav(notifyKey(u.id));
    $('modalBackdrop').hidden = false;
    $('modal').classList.remove('lightbox');
    $('modal').innerHTML = `<div class="teaser-art">${upcomingArt(u, 'teaser-img')}</div><div class="mhead">${esc(tx(u.status) || T('Coming soon'))}</div>
      <div class="mbody"><h2>${esc(tx(u.title) || u.name)}</h2><p>${esc(tx(u.teaser))}</p>
      ${(u.details || []).length ? `<div class="list steps-list"><div class="lhead">${ico('info', 13)}<span>${esc(T('What it will bring'))}</span></div>${u.details.map((d) => `<div class="lrow"><span class="num"></span><div class="main">${esc(tx(d))}</div></div>`).join('')}</div>` : ''}</div>
      <div class="mfoot"><button class="btn" data-act="notify" data-id="${esc(u.id)}">${ico('bell', 14)} ${esc(T(on ? 'Notifying' : 'Notify me'))}</button><button class="btn primary" data-act="modal-close">${esc(T('Close'))}</button></div>`;
    return;
  }
  renderModalBeforeTeaser();
};

Object.assign(ACTIONS, {
  teaser: (d) => openModal({ type: 'teaser', id: d.id }),
  notify: async (d) => {
    const was = isFav(notifyKey(d.id));
    await api.toggleFavorite(notifyKey(d.id));
    if (!was) toast(T('You will see it on Home as soon as it is in the catalog.'));
    await reload();
  },
});
