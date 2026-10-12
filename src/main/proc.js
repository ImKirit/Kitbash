// Process checks through tasklist. The launcher never injects into or reads
// from a game process, it only asks Windows whether an image name is running.
'use strict';

const { execFile } = require('child_process');

function tasklist(imageName) {
  return new Promise((resolve) => {
    if (!/^[\w .()+-]+$/.test(imageName)) return resolve([]);
    execFile('tasklist', ['/FI', `IMAGENAME eq ${imageName}`, '/FO', 'CSV', '/NH'],
      { windowsHide: true, encoding: 'utf8' }, (err, stdout) => {
        if (err) return resolve(null); // unknown, callers treat this as "cannot tell"
        const pids = [];
        for (const line of String(stdout).split(/\r?\n/)) {
          const m = /^"([^"]+)","(\d+)"/.exec(line);
          if (m && m[1].toLowerCase() === imageName.toLowerCase()) pids.push(Number(m[2]));
        }
        resolve(pids);
      });
  });
}

// Pids of every process with this image name. Throws when Windows gives no
// answer, so that "cannot tell" is never mistaken for "not running".
async function pidsOf(imageName) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const pids = await tasklist(imageName);
    if (pids) return pids;
  }
  throw new Error('could not query the process list');
}

async function isRunning(imageName) {
  return (await pidsOf(imageName)).length > 0;
}

module.exports = { pidsOf, isRunning };
