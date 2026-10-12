// HTTPS downloads with a size limit and a strict redirect policy.
'use strict';

const https = require('https');

class DownloadError extends Error {
  constructor(message, status) { super(message); this.name = 'DownloadError'; this.code = 'EDOWNLOAD'; this.status = status || 0; }
}

// opts: { maxBytes, redirectHosts: [host], timeoutMs, onProgress(received, total) }
// Redirects are only followed to https and only to the listed hosts. An
// empty list means: no redirects at all.
function httpsGet(url, opts = {}, hops = 0) {
  const maxBytes = opts.maxBytes || 64 * 1024 * 1024;
  const redirectHosts = (opts.redirectHosts || []).map((h) => h.toLowerCase());
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new DownloadError('bad URL')); }
    if (u.protocol !== 'https:') return reject(new DownloadError('only https is allowed'));
    if (u.username || u.password) return reject(new DownloadError('credentials in URL are not allowed'));

    const req = https.get(u, { headers: { 'User-Agent': require('../brand').userAgent, Accept: '*/*' }, timeout: opts.timeoutMs || 30000 }, (res) => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        res.resume();
        if (hops >= 5) return reject(new DownloadError('too many redirects'));
        let next;
        try { next = new URL(res.headers.location, u); } catch { return reject(new DownloadError('bad redirect')); }
        if (next.protocol !== 'https:' || !redirectHosts.includes(next.hostname.toLowerCase())) {
          return reject(new DownloadError('redirect to a host that is not allowed: ' + next.hostname));
        }
        return resolve(httpsGet(next.href, opts, hops + 1));
      }
      if (status !== 200) { res.resume(); return reject(new DownloadError('HTTP ' + status, status)); }
      const total = Number(res.headers['content-length'] || 0);
      if (total > maxBytes) { res.destroy(); return reject(new DownloadError('file is larger than allowed')); }
      const chunks = [];
      let received = 0;
      res.on('data', (c) => {
        received += c.length;
        if (received > maxBytes) { res.destroy(); return reject(new DownloadError('file is larger than allowed')); }
        chunks.push(c);
        if (opts.onProgress) opts.onProgress(received, total);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', (e) => reject(new DownloadError(e.message)));
    });
    req.on('timeout', () => req.destroy(new DownloadError('timed out')));
    req.on('error', (e) => reject(e instanceof DownloadError ? e : new DownloadError(e.message)));
  });
}

module.exports = { httpsGet, DownloadError };
