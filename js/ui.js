/* ui.js — tactical console, planning input, and the hotseat phase machine.
 * Attached to LL.UI. */
(function () {
  'use strict';
  const V = window.LL.V;
  const CFG = window.LL.CONFIG;
  const COL = window.LL.PLAYER_COLORS;
  const View = window.LL.View;

  /* tiny DOM helper */
  function el(tag, attrs, kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.startsWith('on') && typeof attrs[k] === 'function') e.addEventListener(k.slice(2), attrs[k]);
      else if (k === 'style') e.setAttribute('style', attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach((c) => e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return e;
  }

  const UI = {
    game: null, renderer: null, player: 0, plan: null,
    refs: {}, _animGen: 0,
  };

  UI.init = function (game, renderer) {
    this.game = game; this.renderer = renderer;
    this.refs.console = document.getElementById('console');
    this.refs.turn = document.getElementById('turnLabel');
    this.refs.phase = document.getElementById('phaseLabel');
    this.refs.curtain = document.getElementById('curtain');
    this.refs.curtainWho = document.getElementById('curtainWho');
    this.refs.curtainMsg = document.getElementById('curtainMsg');
    this.refs.curtainBtn = document.getElementById('curtainBtn');
    this.refs.legend = document.getElementById('legend');
    this.refs.hint = document.getElementById('hint');
    renderer.start();
    this.newGame();
  };

  UI.newGame = function () {
    this.game.reset();
    this.beginTurn();
  };

  UI.beginTurn = function () {
    const p = 0;
    this.passTo(p, () => this.beginPlanning(p));
  };

  /* pass-device curtain */
  UI.passTo = function (player, onReady) {
    this._animGen++;      // kill any running replay animation before a planning hand-off
    this._stopFF();       // and any running fast-forward
    const c = this.refs;
    c.curtainWho.textContent = 'PLAYER ' + (player + 1);
    c.curtainWho.className = 'who ' + (player === 0 ? 'p1' : 'p2');
    c.curtainMsg.textContent = `Turn ${this.game.turn + 1}. Make sure Player ${player + 1} is at the controls and the other player cannot see the screen. Your orders are planned in secret.`;
    c.curtain.classList.add('show');
    const btn = c.curtainBtn;
    btn.className = 'primary';
    const handler = () => { btn.removeEventListener('click', handler); c.curtain.classList.remove('show'); onReady(); };
    btn.addEventListener('click', handler);
  };

  UI.beginPlanning = function (player) {
    this.player = player;
    document.body.className = player === 0 ? 'p1-turn' : 'p2-turn';
    this.refs.turn.textContent = 'TURN ' + (this.game.turn + 1);
    this.refs.phase.textContent = 'PLAYER ' + (player + 1) + ' · PLAN';
    this.refs.phase.className = 'phase ' + (player === 0 ? 'p1' : 'p2');
    // fresh plan with sensible defaults
    this.plan = { move: V.of(), weapon: 'none', aim: null, shield: 0, shieldDir: null, showSolution: true };
    this.buildConsole();
    this.updateLegend(false);
    this.refreshScene();
  };

  /* ---------- console construction ---------- */
  UI.buildConsole = function () {
    const g = this.game, p = this.player, me = g.ship(p), col = COL[p];
    const root = this.refs.console;
    root.innerHTML = '';
    const r = (this.refs.live = {}); // live-updating element refs

    // STATUS
    const ob = g.observeEnemy(p);
    const sensor = ob.visible
      ? `SIGNAL · enemy light is T−${ob.age.toFixed(1)} old`
      : `NO SIGNAL · first light ≈ turn ${ob.arrivesAt != null ? Math.ceil(ob.arrivesAt) : '?'}`;
    root.appendChild(el('div', { class: 'sec' }, [
      el('h3', null, ['Ship Status']),
      statLine('HULL', `${me.hp.toFixed(0)} / ${CFG.startHP}`),
      bar('hp', me.hp / CFG.startHP, me.hp > 40 ? 'var(--good)' : 'var(--bad)'),
      statLine('POSITION', V.fmt(me.pos, 0)),
      el('div', { class: 'statline' }, [el('span', null, ['SENSORS']), el('b', { class: ob.visible ? 'ok' : 'danger' }, [sensor])]),
    ]));

    // MOVEMENT
    const move = this.plan.move;
    const moveSec = el('div', { class: 'sec' }, [el('h3', null, [`Maneuver · max ${CFG.maxSpeed}u/turn`])]);
    ['x', 'y', 'z'].forEach((ax) => {
      const row = el('div', { class: 'row' }, []);
      row.appendChild(el('label', null, ['Δ' + ax]));
      const sl = el('input', { type: 'range', min: -CFG.maxSpeed, max: CFG.maxSpeed, step: 0.5, value: move[ax] });
      const num = el('input', { type: 'number', min: -CFG.maxSpeed, max: CFG.maxSpeed, step: 0.5, value: move[ax] });
      const sync = (val) => { this.plan.move[ax] = clampNum(val, -CFG.maxSpeed, CFG.maxSpeed); sl.value = this.plan.move[ax]; num.value = this.plan.move[ax]; this.onPlanChanged(); };
      sl.addEventListener('input', () => sync(parseFloat(sl.value)));
      num.addEventListener('input', () => sync(parseFloat(num.value)));
      row.appendChild(sl); row.appendChild(num);
      moveSec.appendChild(row);
    });
    moveSec.appendChild(el('div', { class: 'toolbar' }, [
      el('button', { onclick: () => { this.plan.move = V.of(); this.buildConsole(); this.onPlanChanged(); } }, ['HOLD']),
      el('button', { onclick: () => this.setMoveToward(1) }, ['TOWARD']),
      el('button', { onclick: () => this.setMoveToward(-1) }, ['AWAY']),
    ]));
    r.moveReadout = el('div', { class: 'muted' }, ['']);
    moveSec.appendChild(r.moveReadout);
    root.appendChild(moveSec);

    // WEAPONS
    const wSec = el('div', { class: 'sec' }, [el('h3', null, ['Weapons'])]);
    const wrow = el('div', { class: 'toolbar' }, []);
    const weps = [{ key: 'none', name: 'HOLD FIRE' }].concat(g.weaponList());
    weps.forEach((w) => {
      const b = el('button', { class: 'choice' + (this.plan.weapon === w.key ? ' active' : '') }, [w.name + (w.cost ? ` ⚡${w.cost}` : '')]);
      b.addEventListener('click', () => { this.selectWeapon(w.key); });
      wrow.appendChild(b);
    });
    wSec.appendChild(wrow);
    r.weaponInfo = el('div', { class: 'muted' }, ['']);
    wSec.appendChild(r.weaponInfo);
    r.aimWrap = el('div', null, []);
    wSec.appendChild(r.aimWrap);
    root.appendChild(wSec);
    this.buildAimControls();

    // SHIELDS
    const sSec = el('div', { class: 'sec' }, [el('h3', null, [`Shields · max ${CFG.shield.maxStrength}`])]);
    const srow = el('div', { class: 'row' }, [el('label', null, ['Strength'])]);
    const ssl = el('input', { type: 'range', min: 0, max: CFG.shield.maxStrength, step: 1, value: this.plan.shield });
    const sval = el('span', { class: 'val' }, [String(this.plan.shield)]);
    ssl.addEventListener('input', () => { this.plan.shield = parseInt(ssl.value, 10); sval.textContent = this.plan.shield; this.onPlanChanged(); });
    srow.appendChild(ssl); srow.appendChild(sval);
    sSec.appendChild(srow);
    sSec.appendChild(el('div', { class: 'toolbar' }, [
      el('button', { onclick: () => this.faceShield('enemy') }, ['FACE ENEMY']),
      el('button', { onclick: () => this.faceShield('incoming') }, ['FACE INCOMING']),
    ]));
    r.shieldInfo = el('div', { class: 'muted' }, ['']);
    sSec.appendChild(r.shieldInfo);
    root.appendChild(sSec);

    // ENERGY + COMMIT
    const eSec = el('div', { class: 'sec' }, [el('h3', null, [`Power Budget · ${CFG.energyPerTurn}⚡/turn`])]);
    r.energyBar = bar('energy', 0, col);
    r.energyText = el('div', { class: 'statline' }, [el('span', null, ['ALLOCATED']), el('b', null, ['0'])]);
    eSec.appendChild(r.energyText);
    eSec.appendChild(r.energyBar);
    r.commit = el('button', { class: 'primary', style: 'width:100%;margin-top:10px;padding:10px;' }, ['LOCK IN ORDERS ▶']);
    r.commit.addEventListener('click', () => this.commit());
    eSec.appendChild(r.commit);
    r.warn = el('div', { class: 'muted danger', style: 'margin-top:6px;' }, ['']);
    eSec.appendChild(r.warn);
    root.appendChild(eSec);

    // DEBUG · FAST-FORWARD (advance N idle turns at 1/sec to observe light-lag)
    const dSec = el('div', { class: 'sec' }, [el('h3', null, ['Debug'])]);
    const ffRow = el('div', { class: 'row' }, [el('label', null, ['FF turns'])]);
    const ffNum = el('input', { type: 'number', min: 1, max: 60, step: 1, value: 10 });
    const ffBtn = el('button', { onclick: () => this.fastForward(parseInt(ffNum.value, 10)) }, ['⏩ FAST-FORWARD']);
    ffRow.appendChild(ffNum); ffRow.appendChild(ffBtn);
    dSec.appendChild(ffRow);
    dSec.appendChild(el('div', { class: 'muted' }, ['advance N turns with both ships idle, 1 turn/sec']));
    root.appendChild(dSec);

    // LOG
    const lSec = el('div', { class: 'sec' }, [el('h3', null, ['Battle Log'])]);
    r.log = el('div', { id: 'log' }, []);
    lSec.appendChild(r.log);
    root.appendChild(lSec);

    this.onPlanChanged();
    this.renderLog();
  };

  UI.buildAimControls = function () {
    const r = this.refs.live, wrap = r.aimWrap;
    wrap.innerHTML = '';
    if (this.plan.weapon === 'none') return;
    const w = CFG.weapons[this.plan.weapon];
    if (!this.plan.aim) this.plan.aim = this.defaultAim();
    r.weaponInfo.textContent = `${w.name}: ${w.damage} dmg · speed ${w.speed}${w.speed >= CFG.c ? ' (=c, invisible in flight)' : ' (<c, visible incoming)'}${w.splash ? ' · splash ' + w.splash : ''}`;

    ['x', 'y', 'z'].forEach((ax) => {
      const row = el('div', { class: 'row' }, [el('label', null, ['aim ' + ax])]);
      const num = el('input', { type: 'number', step: 1, value: Math.round(this.plan.aim[ax]) });
      num.addEventListener('input', () => { this.plan.aim[ax] = parseFloat(num.value) || 0; this.onPlanChanged(); });
      row.appendChild(num);
      const minus = el('button', { onclick: () => { this.plan.aim[ax] -= 2; num.value = Math.round(this.plan.aim[ax]); this.onPlanChanged(); } }, ['−']);
      const plus = el('button', { onclick: () => { this.plan.aim[ax] += 2; num.value = Math.round(this.plan.aim[ax]); this.onPlanChanged(); } }, ['+']);
      row.appendChild(minus); row.appendChild(plus);
      wrap.appendChild(row);
    });
    wrap.appendChild(el('div', { class: 'toolbar' }, [
      el('button', { onclick: () => { this.plan.aim = this.firingSolutionAim(); this.buildAimControls(); this.onPlanChanged(); } }, ['◎ FIRING SOLUTION']),
      el('button', { onclick: () => { this.plan.aim = this.apparentAim(); this.buildAimControls(); this.onPlanChanged(); } }, ['AT IMAGE']),
    ]));
    const tog = el('label', { class: 'muted', style: 'display:flex;gap:6px;align-items:center;margin-top:4px;' }, []);
    const cb = el('input', { type: 'checkbox' }); cb.checked = this.plan.showSolution;
    cb.addEventListener('change', () => { this.plan.showSolution = cb.checked; this.refreshScene(); });
    tog.appendChild(cb); tog.appendChild(document.createTextNode('show firing-solution overlay'));
    wrap.appendChild(tog);
  };

  /* ---------- plan helpers ---------- */
  UI.defaultAim = function () {
    return this.firingSolutionAim() || this.apparentAim();
  };
  UI.firingSolutionAim = function () {
    const sol = this.game.firingSolution(this.player, this.plan.weapon === 'none' ? 'laser' : this.plan.weapon);
    return sol.ok ? sol.aim : null;
  };
  UI.apparentAim = function () {
    const ob = this.game.observeEnemy(this.player);
    if (ob.visible) return V.add(ob.pos, V.scale(ob.vel, ob.age || 0)); // predicted-now of image
    return V.clone(this.game.ships[1 - this.player].history[0].pos);
  };
  UI.selectWeapon = function (key) {
    this.plan.weapon = key;
    if (key !== 'none') this.plan.aim = this.defaultAim();
    this.buildConsole();
  };
  UI.setMoveToward = function (sign) {
    const ob = this.game.observeEnemy(this.player);
    const me = this.game.ship(this.player);
    const tgt = ob.visible ? V.add(ob.pos, V.scale(ob.vel, ob.age || 0)) : this.game.ships[1 - this.player].history[0].pos;
    let dir = V.normalize(V.sub(tgt, me.pos));
    if (V.len2(dir) < 1e-6) dir = V.of(1, 0, 0);
    this.plan.move = V.scale(dir, sign * CFG.maxSpeed);
    this.buildConsole();
  };
  UI.faceShield = function (mode) {
    const ob = this.game.observeEnemy(this.player);
    const me = this.game.ship(this.player);
    if (mode === 'incoming') {
      const incoming = this.game.observeProjectiles(this.player).find((pv) => !pv.own);
      if (incoming) { const predNow = V.add(incoming.pos, V.scale(incoming.vel, incoming.age || 0)); this.plan.shieldDir = predNow; this.onPlanChanged(); return; }
    }
    this.plan.shieldDir = ob.visible ? V.add(ob.pos, V.scale(ob.vel, ob.age || 0)) : V.clone(this.game.ships[1 - this.player].history[0].pos);
    void me; this.onPlanChanged();
  };

  /* ---------- derived display ---------- */
  UI.onPlanChanged = function () {
    const g = this.game, r = this.refs.live;
    if (this.plan.shield > 0 && !this.plan.shieldDir) this.faceShield('enemy');
    const cost = g.planCost(this.plan);
    const over = cost > CFG.energyPerTurn + 1e-6;
    const speedBad = V.len(this.plan.move) > CFG.maxSpeed + 1e-6;
    // move readout
    if (r.moveReadout) r.moveReadout.textContent = `displacement ${V.len(this.plan.move).toFixed(1)}u · cost ${(V.len(this.plan.move) * CFG.moveCost).toFixed(1)}⚡`;
    // energy bar
    if (r.energyBar) {
      const frac = Math.min(1, cost / CFG.energyPerTurn);
      r.energyBar.firstChild.style.width = (frac * 100) + '%';
      r.energyBar.className = 'bar energy' + (over ? ' over' : '');
      r.energyText.lastChild.textContent = `${cost.toFixed(1)} / ${CFG.energyPerTurn}`;
    }
    // shield info
    if (r.shieldInfo) {
      r.shieldInfo.textContent = this.plan.shield > 0
        ? `absorbs up to ${(this.plan.shield * CFG.shield.absorbPerPoint)} dmg from the faced arc`
        : 'no shielding';
    }
    // validity
    const valid = !over && !speedBad;
    if (r.commit) { r.commit.disabled = !valid; }
    if (r.warn) r.warn.textContent = over ? '⚠ over power budget — reduce orders' : (speedBad ? '⚠ exceeds max speed' : '');
    this.refreshScene();
  };

  UI.refreshScene = function () {
    const { primitives, target } = View.buildPlanScene(this.game, this.player, this.plan, { showSolution: this.plan.showSolution });
    this.renderer.setScene(primitives, target);
  };

  UI.renderLog = function () {
    const r = this.refs.live; if (!r || !r.log) return;
    r.log.innerHTML = '';
    // a player only sees events they could physically know: their own actions and
    // hits they took. Enemy actions are never surfaced ahead of their light.
    const mine = this.game.log.filter((e) => e.to === this.player);
    if (!mine.length) r.log.appendChild(el('div', { class: 'muted' }, ['no contact reported']));
    for (const entry of mine.slice(0, 20)) {
      r.log.appendChild(el('div', { class: entry.cls }, [`T${entry.turn} · ${entry.msg}`]));
    }
  };

  UI.updateLegend = function (truth) {
    const p = this.player;
    if (truth) {
      this.refs.legend.innerHTML = '<b style="color:var(--warn)">TRUTH REPLAY</b> — what actually happened';
      this.refs.hint.textContent = 'post-game replay · drag to orbit';
      return;
    }
    this.refs.legend.innerHTML =
      `<div><span style="background:${COL[p]}"></span>your ship (known)</div>` +
      `<div><span style="background:${COL[1 - p]}"></span>enemy — light-delayed image</div>` +
      `<div><span style="background:#ffd34e"></span>firing solution (assumes held course)</div>` +
      `<div style="opacity:.6">dashed bubble = where they could be NOW</div>`;
    this.refs.hint.textContent = 'drag to orbit · scroll to zoom';
  };

  /* ---------- commit + resolve ---------- */
  UI.commit = function () {
    if (!this.game.planValid(this.plan)) return;
    this.game.submitPlan(this.player, { move: V.clone(this.plan.move), weapon: this.plan.weapon, aim: this.plan.aim ? V.clone(this.plan.aim) : null, shield: this.plan.shield, shieldDir: this.plan.shieldDir ? V.clone(this.plan.shieldDir) : null });
    if (this.player === 0) {
      this.passTo(1, () => this.beginPlanning(1));
    } else {
      this.runResolve();
    }
  };

  UI.runResolve = function () {
    const g = this.game;
    // Resolve SILENTLY. We never show a shared "truth" view between turns — that
    // would collapse the light delay to one turn. Each player only ever sees their
    // own light-delayed sensors (and feels hits on themselves) on their own screen.
    g.resolve();
    if (g.phase === 'gameover') { this.gameOver(); return; }
    this.refs.phase.textContent = 'TURN ' + g.turn + ' RESOLVED';
    this.refs.phase.className = 'phase resolve';
    document.body.className = '';
    this.passTo(0, () => this.beginPlanning(0));
  };

  /* Post-game god's-eye replay of the entire battle (fair: the match is decided). */
  UI.playReplay = function () {
    const g = this.game;
    if (g.turn <= 0) return;
    this.updateLegend(true);
    const token = ++this._animGen;
    const speed = 1.4;                       // turns per second
    const dur = (g.turn / speed) * 1000;
    let start = null;
    const step = (ts) => {
      if (token !== this._animGen) return;   // superseded by a new game / hand-off
      if (start == null) start = ts;
      const gtime = Math.min(g.turn, ((ts - start) / dur) * g.turn);
      const { primitives, target } = View.buildReplayScene(g, gtime);
      this.renderer.setScene(primitives, target);
      if (gtime < g.turn) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  /* ---------- fast-forward (debug) ----------
   * Advance `n` turns with both players idle, one turn per second, rendering the
   * current player's (delayed) sensor view so light-lag can be observed. */
  UI.fastForward = function (n) {
    n = Math.max(0, Math.min(60, Math.floor(n || 0)));
    if (n <= 0 || this.game.phase !== 'plan') return;
    this._ffRemaining = n;
    this._ffActive = true;
    this._animGen++;
    this._showFFPanel();
    this._ffStep();
  };

  UI._ffStep = function () {
    if (!this._ffActive) return;
    if (this._ffRemaining <= 0 || this.game.phase === 'gameover') { this._ffEnd(); return; }
    this.game.idleTurn();
    this._ffRemaining--;
    this._renderFF();
    if (this._ffRemaining > 0 && this.game.phase !== 'gameover') {
      this._ffTimer = setTimeout(() => this._ffStep(), 1000); // 1 turn / second
    } else {
      this._ffEnd();
    }
  };

  UI._stopFF = function () {
    this._ffActive = false;
    if (this._ffTimer) { clearTimeout(this._ffTimer); this._ffTimer = null; }
  };

  UI._ffEnd = function () {
    const over = this.game.phase === 'gameover';
    this._stopFF();
    if (over) { this.gameOver(); return; }
    this.passTo(0, () => this.beginPlanning(0));
  };

  UI._renderFF = function () {
    this.refs.turn.textContent = 'TURN ' + this.game.turn;
    this.refs.phase.textContent = 'FAST-FWD · ' + this._ffRemaining + ' left';
    this.refs.phase.className = 'phase resolve';
    if (this._ffStatus) this._ffStatus.textContent = `advancing… turn ${this.game.turn}, ${this._ffRemaining} remaining`;
    const { primitives, target } = View.buildPlanScene(this.game, this.player, { move: V.of(), weapon: 'none', shield: 0 }, {});
    this.renderer.setScene(primitives, target);
  };

  UI._showFFPanel = function () {
    document.body.className = '';
    const root = this.refs.console; root.innerHTML = '';
    const sec = el('div', { class: 'sec' }, [el('h3', null, ['Fast-Forward (debug)'])]);
    this._ffStatus = el('div', { class: 'muted' }, ['advancing…']);
    sec.appendChild(this._ffStatus);
    const stop = el('button', { class: 'primary', style: 'width:100%;padding:10px;margin-top:8px;', onclick: () => { this._ffRemaining = 0; this._ffEnd(); } }, ['■ STOP']);
    sec.appendChild(stop);
    root.appendChild(sec);
  };

  UI.gameOver = function () {
    const g = this.game;
    document.body.className = '';
    this.refs.phase.textContent = 'GAME OVER';
    this.refs.phase.className = 'phase resolve';
    this.refs.curtain.classList.remove('show');
    const root = this.refs.console; root.innerHTML = '';
    const winTxt = g.winner === 'draw' ? 'STALEMATE' : `PLAYER ${g.winner + 1} WINS`;
    const sec = el('div', { class: 'sec', style: 'text-align:center' }, [
      el('h1', { style: `letter-spacing:3px;color:${g.winner === 'draw' ? 'var(--warn)' : COL[g.winner]}` }, [winTxt]),
      el('div', { class: 'muted' }, [`by ${g.endReason || 'decision'} · ${g.turn} turns`]),
    ]);
    root.appendChild(sec);
    const hp = el('div', { class: 'sec' }, []);
    g.ships.forEach((s, i) => {
      hp.appendChild(el('div', { class: 'statline' }, [el('span', { class: i === 0 ? 'p1' : 'p2' }, ['P' + (i + 1)]), el('b', null, [`${s.hp.toFixed(0)} HP${s.alive ? '' : ' — destroyed'} · ${s.damageDealt.toFixed(0)} dmg dealt`])]));
    });
    root.appendChild(hp);
    const btns = el('div', { class: 'sec' }, []);
    const replay = el('button', { class: 'primary', style: 'width:100%;padding:10px;' }, ['▶ WATCH TRUTH REPLAY']);
    replay.addEventListener('click', () => this.playReplay());
    const again = el('button', { style: 'width:100%;padding:10px;margin-top:8px;' }, ['NEW BATTLE ↻']);
    again.addEventListener('click', () => this.newGame());
    btns.appendChild(replay); btns.appendChild(again);
    root.appendChild(btns);
    root.appendChild(el('div', { class: 'sec muted' }, ['The whole duel is now declassified — watch where the ships truly were versus the light each side was fighting.']));
    this.playReplay(); // auto-roll the reveal once
  };

  /* ---------- small builders ---------- */
  function statLine(k, v) { return el('div', { class: 'statline' }, [el('span', null, [k]), el('b', null, [String(v)])]); }
  function bar(cls, frac, color) {
    const i = el('i', null, []); i.style.width = Math.max(0, Math.min(1, frac)) * 100 + '%'; if (color) i.style.background = color;
    return el('div', { class: 'bar ' + cls }, [i]);
  }
  function clampNum(v, lo, hi) { v = isNaN(v) ? 0 : v; return Math.max(lo, Math.min(hi, v)); }

  window.LL.UI = UI;
})();
