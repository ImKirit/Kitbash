// JSON file storage: one file per user, one file for sessions. Writes go to a
// temp file first and are renamed into place.
'use strict';

const fs = require('fs');
const path = require('path');

function createStore(dir) {
  fs.mkdirSync(path.join(dir, 'users'), { recursive: true });
  const sessionsFile = path.join(dir, 'sessions.json');
  const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
  const write = (file, data) => { fs.writeFileSync(file + '.tmp', JSON.stringify(data)); fs.renameSync(file + '.tmp', file); };
  const userFile = (id) => path.join(dir, 'users', String(id).replace(/\D/g, '') + '.json');
  let sessions = read(sessionsFile, {});

  return {
    getSession: (id) => sessions[id] || null,
    putSession: (id, s) => { sessions[id] = s; write(sessionsFile, sessions); },
    deleteSession: (id) => { if (sessions[id]) { delete sessions[id]; write(sessionsFile, sessions); } },
    getUser: (id) => (read(userFile(id), {}).user || null),
    putUser: (user) => { const f = userFile(user.id); const cur = read(f, {}); write(f, { ...cur, user }); },
    getDoc: (id) => (read(userFile(id), {}).doc || null),
    putDoc: (id, doc) => { const f = userFile(id); const cur = read(f, {}); write(f, { ...cur, doc }); },
  };
}

module.exports = { createStore };
