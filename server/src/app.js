// Account and sync service for the launcher. Plain Node, no dependencies.
//
// Sign-in, the desktop app never sees the Discord client secret:
//   1. app        opens  GET /auth/login?port=<loopback port>&challenge=<S256 of a verifier>
//   2. server     redirects to Discord, Discord redirects back to /auth/callback
//   3. server     exchanges the code with Discord (secret from the env file),
//                 makes a one-time code bound to the challenge and sends the
//                 browser to http://127.0.0.1:<port>/callback?code=<one-time code>
//   4. app        POST /auth/token { code, verifier } and gets a session token
// Sync: GET and PUT /api/sync with "Authorization: Bearer <token>".
'use strict';

const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

const MAX_BODY = 256 * 1024;
const PENDING_MS = 10 * 60 * 1000;
const ONE_TIME_MS = 2 * 60 * 1000;
const SESSION_DAYS = 90;

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest();
const random = (n = 32) => b64url(crypto.randomBytes(n));

function page(title, text) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${esc(title)}</title><body style="background:#000;color:#f4f5f7;font:15px 'Segoe UI',system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0">
<div style="max-width:420px;border:1px solid #2e3034;border-radius:12px;padding:24px 28px;background:#0b0b0c"><h1 style="font-weight:500;font-size:20px;margin:0 0 8px">${esc(title)}</h1><p style="color:#a7abb2;margin:0">${esc(text)}</p></div></body>`;
}

// Simple fixed window limit per key.
function limiter(perMinute) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const w = hits.get(key);
    if (!w || now - w.start > 60000) { hits.set(key, { start: now, n: 1 }); return true; }
    w.n++;
    if (hits.size > 10000) hits.clear();
    return w.n <= perMinute;
  };
}

// Only plain JSON objects with the expected lists go into storage.
function validDoc(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return false;
  for (const k of ['packs', 'favorites', 'history']) if (doc[k] !== undefined && !Array.isArray(doc[k])) return false;
  if (doc.settings !== undefined && (typeof doc.settings !== 'object' || Array.isArray(doc.settings))) return false;
  return (doc.packs || []).length <= 300 && (doc.history || []).length <= 200 && (doc.favorites || []).length <= 1000;
}

// config: { clientId, clientSecret, publicUrl, sessionSecret }
// discord: { exchange(code, redirectUri) -> { access_token }, user(accessToken) -> { id, username, global_name, avatar } }
// store:   see store.js
function createApp({ config, discord, store }) {
  const pending = new Map();   // state -> { challenge, port, at }
  const oneTime = new Map();   // code  -> { challenge, user, at }
  const authLimit = limiter(30);
  const apiLimit = limiter(120);
  const redirectUri = config.publicUrl.replace(/\/+$/, '') + '/auth/callback';
  const sessionId = (token) => b64url(crypto.createHmac('sha256', config.sessionSecret).update(token).digest());

  function sweep() {
    const now = Date.now();
    for (const [k, v] of pending) if (now - v.at > PENDING_MS) pending.delete(k);
    for (const [k, v] of oneTime) if (now - v.at > ONE_TIME_MS) oneTime.delete(k);
  }

  function send(res, status, body, headers = {}) {
    const isJson = typeof body !== 'string';
    res.writeHead(status, {
      'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      ...headers,
    });
    res.end(isJson ? JSON.stringify(body) : body);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
        catch { reject(Object.assign(new Error('bad json'), { status: 400 })); }
      });
      req.on('error', reject);
    });
  }

  function authed(req) {
    const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.headers.authorization || '');
    if (!m) return null;
    const s = store.getSession(sessionId(m[1]));
    if (!s || Date.now() - Date.parse(s.createdAt) > SESSION_DAYS * 86400000) return null;
    return s;
  }

  function publicUser(u) {
    return {
      id: u.id,
      name: u.global_name || u.username || 'Discord',
      avatar: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : null,
    };
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const ip = String(req.headers['x-real-ip'] || req.socket.remoteAddress || '');
    const p = url.pathname.replace(/\/+$/, '') || '/';
    sweep();

    if (p === '/health') return send(res, 200, { ok: true });

    if (p.startsWith('/auth/')) {
      if (!authLimit(ip)) return send(res, 429, { error: 'too many requests' });

      if (p === '/auth/login' && req.method === 'GET') {
        const port = Number(url.searchParams.get('port'));
        const challenge = url.searchParams.get('challenge') || '';
        if (!Number.isInteger(port) || port < 1024 || port > 65535 || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
          return send(res, 400, page('Sign-in failed', 'The launcher sent an incomplete request. Start the sign-in again from the launcher.'));
        }
        const state = random(24);
        pending.set(state, { challenge, port, at: Date.now() });
        const q = new URLSearchParams({ client_id: config.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'identify', state, prompt: 'consent' });
        return send(res, 302, '', { Location: 'https://discord.com/oauth2/authorize?' + q });
      }

      if (p === '/auth/callback' && req.method === 'GET') {
        const state = url.searchParams.get('state') || '';
        const p0 = pending.get(state);
        pending.delete(state);
        if (!p0) return send(res, 400, page('Sign-in expired', 'This sign-in link is no longer valid. Start the sign-in again from the launcher.'));
        if (url.searchParams.get('error')) return send(res, 200, page('Sign-in cancelled', 'Nothing was linked. You can close this tab.'));
        const code = url.searchParams.get('code') || '';
        let user;
        try {
          const tok = await discord.exchange(code, redirectUri);
          user = await discord.user(tok.access_token);
          if (!user || !/^\d{5,25}$/.test(String(user.id))) throw new Error('no user');
        } catch {
          return send(res, 502, page('Sign-in failed', 'Discord did not confirm the sign-in. Try again in a moment.'));
        }
        store.putUser(publicUser(user));
        const otc = random(32);
        oneTime.set(otc, { challenge: p0.challenge, userId: String(user.id), at: Date.now() });
        return send(res, 302, '', { Location: `http://127.0.0.1:${p0.port}/callback?code=${encodeURIComponent(otc)}` });
      }

      if (p === '/auth/token' && req.method === 'POST') {
        let body;
        try { body = await readBody(req); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
        const entry = oneTime.get(String(body.code || ''));
        oneTime.delete(String(body.code || ''));
        if (!entry || typeof body.verifier !== 'string' || body.verifier.length < 43 || body.verifier.length > 128) return send(res, 400, { error: 'invalid code' });
        if (b64url(sha256(body.verifier)) !== entry.challenge) return send(res, 400, { error: 'invalid verifier' });
        const token = random(32);
        store.putSession(sessionId(token), { userId: entry.userId, createdAt: new Date().toISOString() });
        return send(res, 200, { token, user: store.getUser(entry.userId) });
      }

      if (p === '/auth/logout' && req.method === 'POST') {
        const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
        if (m) store.deleteSession(sessionId(m[1]));
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: 'not found' });
    }

    if (p.startsWith('/api/')) {
      if (!apiLimit(ip)) return send(res, 429, { error: 'too many requests' });
      const s = authed(req);
      if (!s) return send(res, 401, { error: 'not signed in' });
      if (p === '/api/me' && req.method === 'GET') return send(res, 200, { user: store.getUser(s.userId) });
      if (p === '/api/sync' && req.method === 'GET') return send(res, 200, { doc: store.getDoc(s.userId) });
      if (p === '/api/sync' && req.method === 'PUT') {
        let body;
        try { body = await readBody(req); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
        if (!validDoc(body.doc)) return send(res, 400, { error: 'invalid document' });
        const doc = { ...body.doc, updatedAt: new Date().toISOString() };
        store.putDoc(s.userId, doc);
        return send(res, 200, { doc });
      }
      return send(res, 404, { error: 'not found' });
    }
    return send(res, 404, { error: 'not found' });
  }

  return http.createServer((req, res) => {
    handle(req, res).catch(() => { try { send(res, 500, { error: 'server error' }); } catch { /* closed */ } });
  });
}

module.exports = { createApp, validDoc };
