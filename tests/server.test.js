/* Dev-server test: POST /api/log writes the game log to the logs folder, and
 * static files still serve. Uses an ephemeral port + a temp logs dir. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { Runner } = require('./harness');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lllogs-'));
process.env.LIGHTLAG_LOGS = tmp;            // redirect the server's log dir before requiring it
const { createServer } = require('../server.js');
const t = new Runner('server');

const post = (port, payload, cb) => {
  const data = Buffer.from(JSON.stringify(payload));
  const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/log', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } }, (res) => {
    let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => cb(res, b));
  });
  req.on('error', (e) => { t.ok('POST request sent', false, e.message); finish(); });
  req.end(data);
};
const get = (port, p, cb) => {
  http.get({ host: '127.0.0.1', port, path: p }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => cb(res, b)); });
};
let srv;
function finish() { srv.close(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} process.exit(t.report() ? 0 : 1); }); }

srv = createServer().listen(0, () => {
  const port = srv.address().port;
  const log = { meta: { mode: 'ai' }, outcome: { winner: 1, endReason: 'destroyed', turns: 23 }, turns: [{ turn: 1 }] };
  post(port, log, (res, body) => {
    let j = {}; try { j = JSON.parse(body); } catch (e) {}
    t.ok('POST /api/log responds ok with a filename', res.statusCode === 200 && j.ok === true && /^game-.*\.json$/.test(j.file || ''), body);
    const files = fs.readdirSync(tmp);
    t.ok('exactly one log file was written to the logs dir', files.length === 1, files.join(','));
    let saved = {}; try { saved = JSON.parse(fs.readFileSync(path.join(tmp, files[0]), 'utf8')); } catch (e) {}
    t.ok('the written log preserves the outcome', saved.outcome && saved.outcome.turns === 23 && saved.outcome.winner === 1);
    get(port, '/index.html', (gres, gbody) => {
      t.ok('static game still serves (GET /index.html)', gres.statusCode === 200 && /LIGHT/.test(gbody));
      finish();
    });
  });
});
