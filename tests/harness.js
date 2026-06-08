/* Shared test helpers: a tiny assertion runner, a DOM-free module loader for
 * unit tests, and a jsdom page loader for end-to-end tests. No test framework. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

function readJS(name) { return fs.readFileSync(path.join(ROOT, 'js', name + '.js'), 'utf8'); }

/* ---- assertion runner ---- */
function Runner(title) {
  this.title = title; this.pass = 0; this.fail = 0; this.fails = [];
}
Runner.prototype.ok = function (name, cond, extra) {
  if (cond) { this.pass++; } else { this.fail++; this.fails.push(name + (extra ? ' :: ' + extra : '')); }
};
Runner.prototype.approx = function (name, a, b, eps) {
  this.ok(name, Math.abs(a - b) <= (eps == null ? 0.05 : eps), `got ${a}, want ~${b}`);
};
Runner.prototype.report = function () {
  console.log(`\n[${this.title}] ${this.pass} passed, ${this.fail} failed`);
  if (this.fail) { console.log(this.fails.map((f) => '  FAIL ' + f).join('\n')); }
  return this.fail === 0;
};

/* ---- DOM-free loader for the pure modules (vec3, camera, physics, engine, viewmodel) ---- */
function loadCore() {
  const win = {};
  for (const f of ['vec3', 'camera', 'physics', 'engine', 'ai', 'viewmodel']) {
    // run each file's IIFE with `window` bound to our shared object; no node global pollution
    /* eslint-disable no-new-func */
    new Function('window', readJS(f))(win);
  }
  return win.LL;
}

/* ---- jsdom page loader for the full game (render + ui + main need a DOM) ---- */
function loadPage() {
  let JSDOM;
  try { JSDOM = require('jsdom').JSDOM; }
  catch (e) { throw new Error('jsdom is required for e2e tests — run `npm install` first.'); }

  const order = ['vec3', 'camera', 'physics', 'engine', 'ai', 'viewmodel', 'render', 'ui', 'main'];
  const inlined = order.map((f) => `<script>${readJS(f)}</script>`).join('\n');
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  html = html.replace(/<script src="js\/[^"]+"><\/script>\s*/g, '');
  html = html.replace('</body>', inlined + '\n</body>');

  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.error || e.message)));

  // canvas + layout stubs (no real pixels; calls must just not throw)
  const noop = () => {};
  const ctx = new Proxy({ measureText: () => ({ width: 8 }), createLinearGradient: () => ({ addColorStop: noop }) },
    { get: (o, k) => (k in o ? o[k] : noop), set: () => true });
  window.devicePixelRatio = 1;
  window.HTMLCanvasElement.prototype.getContext = () => ctx;
  window.Element.prototype.getBoundingClientRect = () => ({ width: 1200, height: 800, top: 0, left: 0, right: 1200, bottom: 800, x: 0, y: 0 });
  window.HTMLElement.prototype.setPointerCapture = noop;
  window.HTMLElement.prototype.releasePointerCapture = noop;

  // controllable requestAnimationFrame
  let rafs = [], clock = 0;
  window.requestAnimationFrame = (cb) => { rafs.push(cb); return rafs.length; };
  const flushRaf = (frames) => { for (let i = 0; i < frames; i++) { clock += 500; const b = rafs; rafs = []; for (const cb of b) cb(clock); } };

  // Fake setTimeout, installed ON DEMAND (after boot) so it can drive fast-forward
  // at "1s/turn" without real waiting and without disturbing jsdom's load events.
  let timers = [];
  function useFakeTimers() {
    window.setTimeout = (cb) => { timers.push(cb); return timers.length; };
    window.clearTimeout = () => {};
    return {
      fire: (n) => { for (let i = 0; i < n; i++) { const t = timers.shift(); if (!t) break; t(); } },
      pending: () => timers.length,
    };
  }

  return { dom, window, doc: window.document, errors, flushRaf, useFakeTimers };
}

module.exports = { Runner, loadCore, loadPage, ROOT, readJS };
