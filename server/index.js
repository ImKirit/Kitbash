// Starts the account and sync service. Settings come from environment
// variables, usually loaded from an env file by systemd (see README.md).
//
//   DISCORD_CLIENT_ID      public id of the Discord application
//   DISCORD_CLIENT_SECRET  secret of the Discord application, only on the server
//   SESSION_SECRET         random string, signs the session tokens
//   PUBLIC_URL             https://imkirit.dev/kitbash
//   PORT                   default 3160, listens on 127.0.0.1 only
//   DATA_DIR               default ./data
'use strict';

const path = require('path');
const https = require('https');
const { createApp } = require('./src/app');
const { createStore } = require('./src/store');

function need(name) {
  const v = process.env[name];
  if (!v) { console.error(`missing ${name}`); process.exit(1); }
  return v;
}

function post(url, form) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(form).toString();
    const req = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }, timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => (res.statusCode === 200 ? resolve(JSON.parse(data)) : reject(new Error('discord ' + res.statusCode))));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function get(url, token) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Authorization: 'Bearer ' + token }, timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => (res.statusCode === 200 ? resolve(JSON.parse(data)) : reject(new Error('discord ' + res.statusCode))));
    }).on('error', reject);
  });
}

const config = {
  clientId: need('DISCORD_CLIENT_ID'),
  clientSecret: need('DISCORD_CLIENT_SECRET'),
  sessionSecret: need('SESSION_SECRET'),
  publicUrl: process.env.PUBLIC_URL || 'https://imkirit.dev/kitbash',
};

const discord = {
  exchange: (code, redirectUri) => post('https://discord.com/api/oauth2/token', {
    client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'authorization_code', code, redirect_uri: redirectUri,
  }),
  user: (accessToken) => get('https://discord.com/api/users/@me', accessToken),
};

const store = createStore(path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data')));
const port = Number(process.env.PORT || 3160);
createApp({ config, discord, store }).listen(port, '127.0.0.1', () => console.log(`account service on 127.0.0.1:${port}`));
