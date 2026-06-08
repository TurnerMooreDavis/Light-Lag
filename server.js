/* Light Lag dev server: serves the static game AND persists every finished
 * game's log to ./logs (POST /api/log). Node only, no dependencies.
 *
 *   npm start            # http://localhost:3000, logs -> ./logs
 *   PORT=8080 npm start
 *
 * The browser can't write files itself, so the client POSTs its game log here
 * on game over and this writes it to the logs folder no matter what. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const LOGS = process.env.LIGHTLAG_LOGS || path.join(ROOT, 'logs');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.map': 'application/json',
};

function safeName(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, '-'); }

function writeLog(obj) {
  fs.mkdirSync(LOGS, { recursive: true });
  const gid = obj && obj.meta && obj.meta.gameId;
  let file;
  if (gid) {
    // one stable file per game — per-round POSTs overwrite it with the latest log
    file = `game-${safeName(gid)}.json`;
  } else {
    const o = obj && obj.outcome ? obj.outcome : {};
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    file = `game-${stamp}-t${safeName(o.turns)}-w${safeName(o.winner)}.json`;
  }
  fs.writeFileSync(path.join(LOGS, file), JSON.stringify(obj, null, 2));
  return file;
}

function handler(req, res) {
  if (req.method === 'POST' && req.url === '/api/log') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 8e6) req.destroy(); });
    req.on('end', () => {
      try {
        const file = writeLog(JSON.parse(body));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, file }));
        console.log('[lightlag] wrote logs/' + file);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e && e.message) }));
      }
    });
    return;
  }
  // static files (path-traversal guarded)
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, path.normalize(p));
  if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

function createServer() { return http.createServer(handler); }

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  createServer().listen(PORT, () => console.log(`Light Lag → http://localhost:${PORT}   (game logs saved to ${LOGS})`));
}

module.exports = { createServer, writeLog, LOGS };
