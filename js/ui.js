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
    refs: {}, _animGen: 0, _godMode: false,
    mode: 'hotseat',   // 'hotseat' (2 players) | 'ai' (vs computer)
    aiType: 'hunter',  // which AI personality when mode === 'ai'
    aiPlayer: 1,       // the computer is always player 2
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
    this.refs.curtainGodBtn = document.getElementById('curtainGodBtn');
    this.refs.menu = document.getElementById('menu');
    this.refs.menuButtons = document.getElementById('menuButtons');
    this.refs.menuHint = document.getElementById('menuHint');
    renderer.start();
    this.showMenu();
  };

  /* ---------- start menu (mode select) ---------- */
  UI.showMenu = function () {
    this._animGen++; this._stopFF(); this._godMode = false;
    document.body.className = '';
    this.refs.curtain.classList.remove('show');
    this.refs.turn.textContent = 'LIGHT LAG';
    this.refs.phase.textContent = 'MENU'; this.refs.phase.className = 'phase';
    this.refs.console.innerHTML = '';
    this.renderer.setScene(View.backdrop(CFG.arenaRadius0, false), V.of()); // ambient backdrop
    const mb = this.refs.menuButtons; mb.innerHTML = '';
    mb.appendChild(el('button', { class: 'primary', onclick: () => this.startGame('hotseat') }, ['2 PLAYERS (hotseat)']));
    window.LL.AI.list().forEach((ai) => {
      mb.appendChild(el('button', { title: ai.description, onclick: () => this.startGame('ai', ai.key) }, ['VS ' + ai.name.toUpperCase() + ' (AI)']));
    });
    this.refs.menuHint.textContent = window.LL.AI.list().map((a) => a.name + ' — ' + a.description).join('   ·   ');
    this.refs.menu.classList.add('show');
  };

  UI.startGame = function (mode, aiType) {
    this.mode = mode;
    if (aiType) this.aiType = aiType;
    this.refs.menu.classList.remove('show');
    this.game.reset();
    this.beginTurn();
  };

  // "NEW BATTLE" returns to the menu so the mode can be re-chosen
  UI.newGame = function () { this.showMenu(); };

  UI.beginTurn = function () {
    const p = 0;
    this.passTo(p, () => this.beginPlanning(p));
  };

  /* pass-device curtain. God mode can be entered ONLY here, and ONLY at the
   * start of a turn (the player-1 hand-off) — so there is never a half-made plan
   * to abandon. */
  UI.passTo = function (player, onReady) {
    this._animGen++;      // kill any running replay animation before a planning hand-off
    this._stopFF();       // and any running fast-forward
    this._godMode = false;
    const c = this.refs;
    const vsAI = this.mode === 'ai';
    c.curtainWho.textContent = vsAI ? 'YOUR MOVE' : 'PLAYER ' + (player + 1);
    c.curtainWho.className = 'who ' + (player === 0 ? 'p1' : 'p2');
    c.curtainMsg.textContent = vsAI
      ? `Turn ${this.game.turn + 1}. Plan your orders against the ${window.LL.AI.get(this.aiType).name}.`
      : `Turn ${this.game.turn + 1}. Make sure Player ${player + 1} is at the controls and the other player cannot see the screen. Your orders are planned in secret.`;
    c.curtain.classList.add('show');
    const btn = c.curtainBtn, god = c.curtainGodBtn;
    btn.className = 'primary';
    god.style.display = player === 0 ? '' : 'none'; // start-of-turn only
    const cleanup = () => { btn.removeEventListener('click', onReadyH); god.removeEventListener('click', onGodH); };
    const onReadyH = () => { cleanup(); c.curtain.classList.remove('show'); onReady(); };
    const onGodH = () => { cleanup(); c.curtain.classList.remove('show'); this.enterGodMode(); };
    btn.addEventListener('click', onReadyH);
    god.addEventListener('click', onGodH);
  };

  /* ---------- god mode (debug): god view + fast-forward only ---------- */
  UI.enterGodMode = function () {
    this._godMode = true;
    document.body.className = '';
    this.refs.turn.textContent = 'TURN ' + (this.game.turn + 1);
    this.refs.phase.textContent = 'GOD MODE (debug)';
    this.refs.phase.className = 'phase resolve';
    this._showGodPanel();
    this._renderGod();
  };

  UI.exitGodMode = function () {
    this._godMode = false;
    this.passTo(0, () => this.beginPlanning(0));
  };

  UI._renderGod = function () {
    const s = View.buildGodScene(this.game);
    this.renderer.setScene(s.primitives, s.target);
    this._godLegend();
  };

  UI._showGodPanel = function () {
    const root = this.refs.console; root.innerHTML = '';
    const sec = el('div', { class: 'sec' }, [el('h3', null, ['God Mode (debug)'])]);
    sec.appendChild(el('div', { class: 'muted' }, ['All objects from both players, true positions.']));
    const ffRow = el('div', { class: 'row' }, [el('label', null, ['FF turns'])]);
    const ffNum = el('input', { type: 'number', min: 1, max: 60, step: 1, value: 10 });
    const ffBtn = el('button', { onclick: () => this.fastForward(parseInt(ffNum.value, 10)) }, ['⏩ FAST-FORWARD']);
    ffRow.appendChild(ffNum); ffRow.appendChild(ffBtn);
    sec.appendChild(ffRow);
    sec.appendChild(el('div', { class: 'muted' }, ['advance N turns with both ships idle, 1 turn/sec']));
    root.appendChild(sec);
    const exitSec = el('div', { class: 'sec' }, []);
    exitSec.appendChild(el('button', { class: 'primary', style: 'width:100%;padding:10px;', onclick: () => this.exitGodMode() }, ['◀ EXIT GOD MODE']));
    root.appendChild(exitSec);
  };

  UI.beginPlanning = function (player) {
    this.player = player;
    document.body.className = player === 0 ? 'p1-turn' : 'p2-turn';
    this.refs.turn.textContent = 'TURN ' + (this.game.turn + 1);
    this.refs.phase.textContent = 'PLAYER ' + (player + 1) + ' · PLAN';
    this.refs.phase.className = 'phase ' + (player === 0 ? 'p1' : 'p2');
    // fresh plan with sensible defaults (accel = thrust applied to persistent velocity)
    this.plan = { accel: V.of(), weapon: 'none', aim: null, shield: 0, shieldDir: null, showSolution: true };
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
      statLine('VELOCITY', `${V.fmt(me.vel, 1)} · ${V.len(me.vel).toFixed(1)}/t`),
      el('div', { class: 'statline' }, [el('span', null, ['SENSORS']), el('b', { class: ob.visible ? 'ok' : 'danger' }, [sensor])]),
    ]));

    // THRUST (acceleration applied to the ship's persistent velocity)
    const accel = this.plan.accel;
    const moveSec = el('div', { class: 'sec' }, [el('h3', null, [`Thrust · max accel ${CFG.maxAccel}/turn · top speed ${CFG.maxSpeed}`])]);
    ['x', 'y', 'z'].forEach((ax) => {
      const row = el('div', { class: 'row' }, []);
      row.appendChild(el('label', null, ['a' + ax]));
      const sl = el('input', { type: 'range', min: -CFG.maxAccel, max: CFG.maxAccel, step: 0.5, value: accel[ax] });
      const num = el('input', { type: 'number', min: -CFG.maxAccel, max: CFG.maxAccel, step: 0.5, value: accel[ax] });
      const sync = (val) => { this.plan.accel[ax] = clampNum(val, -CFG.maxAccel, CFG.maxAccel); sl.value = this.plan.accel[ax]; num.value = this.plan.accel[ax]; this.onPlanChanged(); };
      sl.addEventListener('input', () => sync(parseFloat(sl.value)));
      num.addEventListener('input', () => sync(parseFloat(num.value)));
      row.appendChild(sl); row.appendChild(num);
      moveSec.appendChild(row);
    });
    moveSec.appendChild(el('div', { class: 'toolbar' }, [
      el('button', { onclick: () => { this.plan.accel = V.of(); this.buildConsole(); this.onPlanChanged(); } }, ['COAST']),
      el('button', { onclick: () => this.setBrake() }, ['BRAKE']),
      el('button', { onclick: () => this.setAccelToward(1) }, ['TOWARD']),
      el('button', { onclick: () => this.setAccelToward(-1) }, ['AWAY']),
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

    // (Debug tools — fast-forward & god view — live in God Mode, entered from the
    //  start-of-turn curtain, so they can never abandon a half-made plan.)

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
    // aim at exactly what you SEE — the light-delayed image (or start intel).
    // Leading the target is the explicit job of the FIRING SOLUTION button.
    const v = this.game.viewFor(this.player);
    return v.enemy.visible ? V.clone(v.enemy.pos) : V.clone(v.enemyIntel);
  };
  UI.selectWeapon = function (key) {
    this.plan.weapon = key;
    if (key !== 'none') this.plan.aim = this.defaultAim();
    this.buildConsole();
  };
  UI.setAccelToward = function (sign) {
    // thrust toward/away from the VISIBLE image (or start intel) — never the
    // enemy's true current position.
    const v = this.game.viewFor(this.player);
    const tgt = v.enemy.visible ? v.enemy.pos : v.enemyIntel;
    let dir = V.normalize(V.sub(tgt, v.me.pos));
    if (V.len2(dir) < 1e-6) dir = V.of(1, 0, 0);
    this.plan.accel = V.scale(dir, sign * CFG.maxAccel);
    this.buildConsole();
  };
  // thrust to kill momentum: accelerate opposite to current velocity (capped)
  UI.setBrake = function () {
    const me = this.game.ship(this.player);
    this.plan.accel = V.clampLen(V.neg(me.vel), CFG.maxAccel);
    this.buildConsole();
  };
  UI.faceShield = function (mode) {
    const v = this.game.viewFor(this.player);
    if (mode === 'incoming') {
      // a seen torpedo flies straight, so extrapolating its OBSERVED image is exact
      const incoming = v.projectiles.find((pv) => !pv.own);
      if (incoming) { this.plan.shieldDir = V.add(incoming.pos, V.scale(incoming.vel, incoming.age || 0)); this.onPlanChanged(); return; }
    }
    // otherwise face the enemy's visible image (or start intel) — never their true pos
    this.plan.shieldDir = v.enemy.visible ? V.clone(v.enemy.pos) : V.clone(v.enemyIntel);
    this.onPlanChanged();
  };

  /* ---------- derived display ---------- */
  UI.onPlanChanged = function () {
    const g = this.game, r = this.refs.live;
    if (this.plan.shield > 0 && !this.plan.shieldDir) this.faceShield('enemy');
    const cost = g.planCost(this.plan);
    const over = cost > CFG.energyPerTurn + 1e-6;
    const accel = this.plan.accel;
    const speedBad = V.len(accel) > CFG.maxAccel + 1e-6;
    // thrust readout: resulting velocity/speed after this turn's thrust
    if (r.moveReadout) {
      const me = g.ship(this.player);
      const nextVel = V.clampLen(V.add(me.vel, accel), CFG.maxSpeed);
      r.moveReadout.textContent = `thrust ${V.len(accel).toFixed(1)} · ${(V.len(accel) * CFG.accelCost).toFixed(1)}⚡ → speed ${V.len(nextVel).toFixed(1)}/t`;
    }
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
    if (r.warn) r.warn.textContent = over ? '⚠ over power budget — reduce orders' : (speedBad ? '⚠ exceeds max thrust' : '');
    this.refreshScene();
  };

  UI.refreshScene = function () {
    const { primitives, target } = View.buildPlanScene(this.game, this.player, this.plan, { showSolution: this.plan.showSolution });
    this.renderer.setScene(primitives, target);
  };

  UI._godLegend = function () {
    this.refs.legend.innerHTML = '<b style="color:#ffd34e">GOD MODE (debug)</b> — every object, true positions';
    this.refs.hint.textContent = 'omniscient debug view · drag to orbit · scroll to zoom';
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
    this.game.submitPlan(this.player, { accel: V.clone(this.plan.accel), weapon: this.plan.weapon, aim: this.plan.aim ? V.clone(this.plan.aim) : null, shield: this.plan.shield, shieldDir: this.plan.shieldDir ? V.clone(this.plan.shieldDir) : null });
    if (this.player === 0 && this.mode === 'ai') {
      // the computer plans from its own sanctioned (light-delayed) view, then resolve
      this.game.submitPlan(this.aiPlayer, window.LL.AI.decide(this.aiType, this.game.viewFor(this.aiPlayer)));
      this.runResolve();
    } else if (this.player === 0) {
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
    if (over) { this._godMode = false; this.gameOver(); return; }
    // fast-forward only runs inside god mode — return to the god-mode panel
    this._showGodPanel();
    this._renderGod();
    this.refs.phase.textContent = 'GOD MODE (debug)';
  };

  UI._renderFF = function () {
    this.refs.turn.textContent = 'TURN ' + this.game.turn;
    this.refs.phase.textContent = 'FAST-FWD · ' + this._ffRemaining + ' left';
    this.refs.phase.className = 'phase resolve';
    if (this._ffStatus) this._ffStatus.textContent = `advancing… turn ${this.game.turn}, ${this._ffRemaining} remaining`;
    const s = View.buildGodScene(this.game); // FF runs in god mode -> always the truth view
    this.renderer.setScene(s.primitives, s.target);
    this._godLegend();
  };

  UI._showFFPanel = function () {
    document.body.className = '';
    const root = this.refs.console; root.innerHTML = '';
    const sec = el('div', { class: 'sec' }, [el('h3', null, ['Fast-Forward (god mode)'])]);
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
