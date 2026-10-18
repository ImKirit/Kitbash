// Optional Discord account. The launcher works the same without it; signed in,
// modpacks, favourites, a few settings and the session history are synced
// through the account service (server/). The app never holds the Discord
// client secret: it only gets a session token from the service.
'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const path = require('path');
const { readJson, writeJsonAtomic } = require('./util');
const { merge } = require('./sync');

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

function request(base, method, route, { token, body } = {}) {
  const u = new URL(base.replace(/\/+$/, '') + route);
  const local = u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname);
  if (u.protocol !== 'https:' && !local) return Promise.reject(new Error('the account service must use https'));
  const lib = u.protocol === 'https:' ? https : http;
  const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = lib.request(u, {
      method, timeout: 15000,
      headers: { Accept: 'application/json', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; if (text.length > 1024 * 1024) req.destroy(); });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
        else reject(Object.assign(new Error((json && json.error) || 'HTTP ' + res.statusCode), { status: res.statusCode }));
      });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

class Account {
  // opts: { dataDir, server, openUrl(url), protect: { encrypt(str) -> Buffer, decrypt(Buffer) -> str } | null }
  constructor(opts) {
    this.server = opts.server;
    this.openUrl = opts.openUrl;
    this.protect = opts.protect || null;
    this.file = path.join(opts.dataDir, 'account.json');
    this.state = readJson(this.file, null) || {};
    this.pending = null;
  }

  token() {
    if (!this.state.token) return null;
    try { return this.protect && this.state.protected ? this.protect.decrypt(Buffer.from(this.state.token, 'base64')) : this.state.token; } catch { return null; }
  }

  status() {
    return { signedIn: !!this.token(), user: this.state.user || null, lastSync: this.state.lastSync || null, error: this.state.error || null, linking: !!this.pending, linkUrl: this.pending ? this.pending.url : null };
  }

  _save() { writeJsonAtomic(this.file, this.state); }

  // Opens the browser at the service, waits for the loopback callback,
  // trades the one-time code for a session token.
  login() {
    if (this.pending) return this.pending.promise;
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    let done;
    const promise = new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
        const code = u.searchParams.get('code');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><meta charset="utf-8"><body style="background:#000;color:#f4f5f7;font:15px Segoe UI,sans-serif;display:grid;place-items:center;height:100vh;margin:0"><p>Signed in. You can close this tab and go back to the launcher.</p>');
        done(code);
      });
      const timer = setTimeout(() => done(null, new Error('sign-in timed out')), LOGIN_TIMEOUT_MS);
      done = async (code, err) => {
        clearTimeout(timer);
        srv.close();
        const url = this.pending && this.pending.url;
        this.pending = null;
        if (err || !code) return reject(err || new Error('sign-in cancelled'));
        try {
          const r = await request(this.server, 'POST', '/auth/token', { body: { code, verifier } });
          this.state = { ...this.state, user: r.user, error: null };
          if (this.protect) { this.state.token = this.protect.encrypt(r.token).toString('base64'); this.state.protected = true; }
          else { this.state.token = r.token; this.state.protected = false; }
          this._save();
          resolve(this.status());
        } catch (e) { reject(e); }
        return url;
      };
      srv.listen(0, '127.0.0.1', () => {
        const url = `${this.server.replace(/\/+$/, '')}/auth/login?port=${srv.address().port}&challenge=${challenge}`;
        this.pending.url = url;
        this.openUrl(url);
      });
    });
    this.pending = { promise, url: null, cancel: () => done && done(null, new Error('sign-in cancelled')) };
    return promise;
  }

  cancel() { if (this.pending) this.pending.cancel(); }

  async logout() {
    const token = this.token();
    if (token) { try { await request(this.server, 'POST', '/auth/logout', { token }); } catch { /* offline: forget locally anyway */ } }
    this.state = {};
    this._save();
  }

  // Pulls the account copy, merges it with the local one, pushes the result.
  // Returns the merged document (the caller applies it locally).
  async sync(localDoc) {
    const token = this.token();
    if (!token) throw new Error('not signed in');
    try {
      const remote = (await request(this.server, 'GET', '/api/sync', { token })).doc;
      const merged = merge(localDoc, remote);
      const saved = (await request(this.server, 'PUT', '/api/sync', { token, body: { doc: merged } })).doc;
      this.state.lastSync = new Date().toISOString();
      this.state.error = null;
      this._save();
      return saved;
    } catch (e) {
      if (e.status === 401) { this.state = { error: 'signed-out' }; this._save(); }
      else { this.state.error = e.message; this._save(); }
      throw e;
    }
  }
}

module.exports = { Account, request };
