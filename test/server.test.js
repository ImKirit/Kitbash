'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const { createApp } = require('../server/src/app');
const { createStore } = require('../server/src/store');
const h = require('./helpers');

function request(port, method, path, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) } }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch { /* html */ } resolve({ status: res.statusCode, headers: res.headers, json, text }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function start() {
  const dir = h.tmpDir('server');
  const calls = [];
  const discord = {
    exchange: async (code, redirectUri) => { calls.push({ code, redirectUri }); if (code !== 'good-code') throw new Error('bad'); return { access_token: 'discord-token' }; },
    user: async (t) => ({ id: '123456789012345678', username: 'kirit', global_name: 'Kirit', avatar: 'abc' }),
  };
  const server = createApp({ config: { clientId: '1561154745140518922', clientSecret: 'never-sent', sessionSecret: 'test-secret', publicUrl: 'https://imkirit.dev/kitbash' }, discord, store: createStore(dir) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, port: server.address().port, calls, dir };
}

async function signIn(port) {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const login = await request(port, 'GET', `/auth/login?port=45678&challenge=${challenge}`);
  const to = new URL(login.headers.location);
  const back = await request(port, 'GET', `/auth/callback?code=good-code&state=${to.searchParams.get('state')}`);
  const otc = new URL(back.headers.location).searchParams.get('code');
  return { login, to, back, otc, verifier };
}

test('sign-in: Discord redirect, callback, one-time code with PKCE, session token', async () => {
  const s = await start();
  const { login, to, back, otc, verifier } = await signIn(s.port);
  assert.equal(login.status, 302);
  assert.equal(to.origin + to.pathname, 'https://discord.com/oauth2/authorize');
  assert.equal(to.searchParams.get('client_id'), '1561154745140518922');
  assert.equal(to.searchParams.get('redirect_uri'), 'https://imkirit.dev/kitbash/auth/callback');
  assert.equal(to.searchParams.get('scope'), 'identify');
  assert.ok(!login.headers.location.includes('never-sent'), 'the secret never leaves the server');
  assert.equal(back.status, 302);
  assert.ok(back.headers.location.startsWith('http://127.0.0.1:45678/callback?code='));
  assert.deepEqual(s.calls, [{ code: 'good-code', redirectUri: 'https://imkirit.dev/kitbash/auth/callback' }]);

  // a wrong verifier is refused, and the one-time code is gone afterwards
  const wrong = await request(s.port, 'POST', '/auth/token', { body: { code: otc, verifier: 'x'.repeat(43) } });
  assert.equal(wrong.status, 400);
  const again = await request(s.port, 'POST', '/auth/token', { body: { code: otc, verifier } });
  assert.equal(again.status, 400, 'one-time code works once at most');

  const second = await signIn(s.port);
  const ok = await request(s.port, 'POST', '/auth/token', { body: { code: second.otc, verifier: second.verifier } });
  assert.equal(ok.status, 200);
  assert.ok(/^[A-Za-z0-9_-]{40,}$/.test(ok.json.token));
  assert.deepEqual(ok.json.user, { id: '123456789012345678', name: 'Kirit', avatar: 'https://cdn.discordapp.com/avatars/123456789012345678/abc.png?size=64' });
  const me = await request(s.port, 'GET', '/api/me', { token: ok.json.token });
  assert.equal(me.json.user.name, 'Kirit');
  s.server.close();
  h.cleanupDir(s.dir);
});

test('sign-in refuses bad input, unknown state and a failed Discord exchange', async () => {
  const s = await start();
  assert.equal((await request(s.port, 'GET', '/auth/login?port=80&challenge=' + 'a'.repeat(43))).status, 400);
  assert.equal((await request(s.port, 'GET', '/auth/login?port=45678&challenge=short')).status, 400);
  assert.equal((await request(s.port, 'GET', '/auth/callback?code=good-code&state=made-up')).status, 400);
  const login = await request(s.port, 'GET', '/auth/login?port=45678&challenge=' + 'a'.repeat(43));
  const state = new URL(login.headers.location).searchParams.get('state');
  assert.equal((await request(s.port, 'GET', `/auth/callback?code=bad-code&state=${state}`)).status, 502);
  assert.equal((await request(s.port, 'GET', `/auth/callback?code=good-code&state=${state}`)).status, 400, 'state is single use');
  s.server.close();
  h.cleanupDir(s.dir);
});

test('sync: needs a token, stores a valid document, refuses junk and oversized bodies, logout ends the session', async () => {
  const s = await start();
  const { otc, verifier } = await signIn(s.port);
  const { token } = (await request(s.port, 'POST', '/auth/token', { body: { code: otc, verifier } })).json;

  assert.equal((await request(s.port, 'GET', '/api/sync')).status, 401);
  assert.equal((await request(s.port, 'GET', '/api/sync', { token: 'x'.repeat(43) })).status, 401);
  assert.deepEqual((await request(s.port, 'GET', '/api/sync', { token })).json, { doc: null });

  const doc = { packs: [{ id: 'p1', name: 'Friday', gameId: 'repo', mods: [], updatedAt: '2026-10-18T10:00:00Z' }], favorites: ['repomimesis'], settings: { values: { theme: 'dark' } }, history: [] };
  const put = await request(s.port, 'PUT', '/api/sync', { token, body: { doc } });
  assert.equal(put.status, 200);
  const got = (await request(s.port, 'GET', '/api/sync', { token })).json.doc;
  assert.deepEqual(got.packs, doc.packs);
  assert.ok(got.updatedAt);

  assert.equal((await request(s.port, 'PUT', '/api/sync', { token, body: { doc: { packs: 'nope' } } })).status, 400);
  assert.equal((await request(s.port, 'PUT', '/api/sync', { token, body: '{not json' })).status, 400);
  const big = await request(s.port, 'PUT', '/api/sync', { token, body: { doc: { packs: [], pad: 'x'.repeat(300 * 1024) } } }).catch(() => ({ status: 413 }));
  assert.equal(big.status, 413);

  await request(s.port, 'POST', '/auth/logout', { token });
  assert.equal((await request(s.port, 'GET', '/api/sync', { token })).status, 401);
  s.server.close();
  h.cleanupDir(s.dir);
});

test('rate limit on sign-in requests', async () => {
  const s = await start();
  let last;
  for (let i = 0; i < 35; i++) last = await request(s.port, 'GET', '/auth/login?port=1&challenge=x');
  assert.equal(last.status, 429);
  s.server.close();
  h.cleanupDir(s.dir);
});
