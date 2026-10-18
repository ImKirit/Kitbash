// The Discord picture of the signed-in user, fetched by the main process and
// cached in the data folder. The window never loads remote content, it only
// gets the local file.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CDN = 'https://cdn.discordapp.com/';

// Where the picture comes from. The account service sends the full avatar URL
// (or a bare hash). Users without their own picture get Discord's default
// picture, chosen from the user id the way Discord does it.
function avatarSource(user) {
  if (!user || !/^\d{5,25}$/.test(String(user.id || ''))) return null;
  const id = String(user.id);
  let hash = user.avatarHash || null;
  const m = /^https:\/\/cdn\.discordapp\.com\/avatars\/(\d+)\/(a_)?([a-f0-9]{16,64})\.(png|webp|gif|jpg|jpeg)/i.exec(String(user.avatar || ''));
  if (m && m[1] === id) hash = (m[2] || '') + m[3];
  if (hash && /^(a_)?[a-f0-9]{16,64}$/i.test(hash)) return `${CDN}avatars/${id}/${hash}.png?size=128`;
  const index = Number((BigInt(id) >> 22n) % 6n);
  return `${CDN}embed/avatars/${index}.png`;
}

// Returns a local file path or null. A new hash means a new URL and a new file.
async function localAvatar(user, { cacheDir, fetch }) {
  const url = avatarSource(user);
  if (!url) return null;
  const file = path.join(cacheDir, 'avatars', crypto.createHash('sha1').update(url).digest('hex').slice(0, 16) + '.png');
  if (fs.existsSync(file)) return file;
  try {
    const buf = await fetch(url, { maxBytes: 2 * 1024 * 1024, redirectHosts: [] });
    if (!buf || buf.length < 32 || buf.readUInt32BE(0) !== 0x89504e47) return null; // must be a PNG
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.part', buf);
    fs.renameSync(file + '.part', file);
    return file;
  } catch { return null; }
}

module.exports = { avatarSource, localAvatar };
