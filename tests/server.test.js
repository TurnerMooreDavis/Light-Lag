/* Dev-server test: POST /api/log writes the game log to the logs folder, keys a
 * stable file per gameId (so per-round posts overwrite one file), and static
 * files still serve. Uses an ephemeral port + a temp logs dir. */
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Runner } = require('./harness');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lllogs-'));
process.env.LIGHTLAG_LOGS = tmp;            // redirect the server's log dir before requiring it
const { createServer } = require('../server.js');
const t = new Runner('server');

const req = (port, method, p, body) => new Promise((resolve, reject) => {
  const data = body != null ? Buffer.from(JSON.stringify(body)) : null;
  const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} },
    (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
  r.on('error', reject); if (data) r.write(data); r.end();
});
const readJSON = (f) => JSON.parse(fs.readFileSync(path.join(tmp, f), 'utf8'));

(async () => {
  const srv = createServer();
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;

  // 1) a log with no gameId -> timestamped file, outcome preserved
  let res = await req(port, 'POST', '/api/log', { meta: { mode: 'ai' }, outcome: { winner: 1, endReason: 'destroyed', turns: 23 }, turns: [{ turn: 1 }] });
  let j = {}; try { j = JSON.parse(res.body); } catch (e) {}
  t.ok('POST /api/log responds ok with a filename', res.status === 200 && j.ok === true && /^game-.*\.json$/.test(j.file || ''), res.body);
  t.ok('the written log preserves the outcome', (() => { try { const s = readJSON(j.file); return s.outcome.turns === 23 && s.outcome.winner === 1; } catch (e) { return false; } })());

  // 2) per-round overwrite: the same gameId posted twice keeps ONE file with the latest content
  await req(port, 'POST', '/api/log', { meta: { gameId: 'gtest' }, outcome: { turns: 1 }, turns: [{ turn: 1 }] });
  const r2 = await req(port, 'POST', '/api/log', { meta: { gameId: 'gtest' }, outcome: { turns: 3 }, turns: [{ turn: 1 }, { turn: 2 }, { turn: 3 }] });
  t.ok('a gameId keys a stable filename', JSON.parse(r2.body).file === 'game-gtest.json');
  t.ok('repeated rounds overwrite ONE file per game', fs.readdirSync(tmp).filter((f) => /^game-gtest/.test(f)).length === 1);
  t.ok('the file holds the latest cumulative turns', readJSON('game-gtest.json').turns.length === 3);

  // 3) static game still serves
  const g = await req(port, 'GET', '/index.html');
  t.ok('static game still serves (GET /index.html)', g.status === 200 && /LIGHT/.test(g.body));

  await new Promise((r) => srv.close(r));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  process.exit(t.report() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
