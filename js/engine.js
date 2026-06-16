/* engine.js — game state, turn resolution, and per-player observation.
 * Attached to LL.Engine (a Game constructor + CONFIG). */
(function () {
  'use strict';
  const V = window.LL.V;
  const Phys = window.LL.Phys;

  const CONFIG = {
    c: 10,                 // speed of light, grid-units per turn (THE load-bearing constant)
    startDistance: 50,     // ships begin EXACTLY this far apart (orientation randomized). At
                           // spawnBoost each (closing 10/turn), a passive pair collides on turn 5.
    spawnBoost: 5,         // initial speed each stargate imparts (ships launch toward each other)
    shipCollideRadius: 6,  // two ships destroy each other if their swept paths pass this close
    // shrinking arena (a sphere, ships clamped inside). Overtime forces engagement.
    arenaRadius0: 160,     // starting boundary radius
    arenaRadiusMin: 18,    // walls stop closing here
    normalTurnCap: 40,     // overtime (shrink) begins after this turn
    arenaShrinkPerTurn: 3, // boundary closes this fast in overtime
    hardTurnCap: 110,      // absolute safety stop
    maxAccel: 3,           // max change in velocity per turn (the thrust input; slider range)
    maxSpeed: 6,           // terminal velocity cap (0.6c; well under c=10 so the light solver stays valid)
    accelCost: 2,          // energy per unit of thrust — coasting at constant velocity is FREE
    energyPerTurn: 12,     // use-it-or-lose-it budget each turn
    startHP: 100,
    hitRadius: 5,          // direct-hit distance (a real target inside the uncertainty cloud)
    weapons: {
      laser:   { cost: 8, damage: 45, speed: 10, splash: 0, life: 50, name: 'LASER' },
      torpedo: { cost: 5, damage: 32, speed: 6,  splash: 9, life: 40, name: 'TORPEDO' },
    },
    shield: { maxStrength: 8, absorbPerPoint: 6, cosThreshold: 0.5 }, // 60° half-angle cone
  };

  const PLAYER_COLORS = ['#38e1ff', '#ff7a59'];
  let _pid = 1;
  const nextId = () => _pid++;

  // Uniform random unit vector (uniform on the sphere). rng() -> [0,1).
  function randomDir(rng) {
    const z = 2 * rng() - 1, t = 2 * Math.PI * rng(), s = Math.sqrt(Math.max(0, 1 - z * z));
    return V.of(s * Math.cos(t), s * Math.sin(t), z);
  }
  // A facing pair of stargates from two spawn points: each gate sits at a spawn
  // point and faces along the axis toward the other (so they look at each other,
  // and ships launch toward the centre). Used for both random and explicit starts.
  function stargatesFrom(starts) {
    const axis = V.normalize(V.sub(starts[1], starts[0])); // from gate 0 toward gate 1
    return [
      { owner: 0, pos: V.clone(starts[0]), facing: V.clone(axis) },
      { owner: 1, pos: V.clone(starts[1]), facing: V.neg(axis) },
    ];
  }
  // Randomized stargate placement: a random orientation about a random midpoint,
  // with both gates kept comfortably inside the arena. The separation is FIXED at
  // exactly startDistance so a passive pair (launched at spawnBoost, closing
  // 10/turn) always collides on turn 5 — only the orientation/midpoint vary.
  // Shifting BOTH gates by the same midpoint offset preserves their separation.
  function randomStargates(rng) {
    const r = rng || Math.random;
    const dir = randomDir(r);
    const half = CONFIG.startDistance / 2;                // fixed gap => deterministic turn-5 collision
    const maxOff = Math.max(0, CONFIG.arenaRadius0 - 12 - half); // keep both inside the wall
    const off = V.scale(randomDir(r), r() * maxOff);
    return stargatesFrom([V.add(off, V.scale(dir, -half)), V.add(off, V.scale(dir, half))]);
  }

  function makeShip(owner, pos, vel) {
    return {
      id: nextId(), kind: 'ship', owner,
      pos: V.clone(pos), vel: V.clone(vel || V.of()), hp: CONFIG.startHP, alive: true,
      damageDealt: 0,
      history: [{ t: 0, pos: V.clone(pos) }],
      shield: { strength: 0, dir: V.of(0, 0, 0) }, // active during the resolving tick
    };
  }

  function Game(opts) { this.reset(opts); }

  // opts.starts = [posA, posB] forces positions (tests); opts.rng = ()->[0,1)
  // seeds the random placement. Default: randomized stargates >= startDistance apart.
  Game.prototype.reset = function (opts) {
    opts = opts || {};
    _pid = 1;
    this.cfg = CONFIG;
    this.turn = 0;
    // Each ship launches from a stargate. The two gates face each other and are
    // static, universally-visible landmarks (see viewFor) — they reveal where each
    // ship STARTED, never where it is now (the enemy ship stays light-delayed).
    // Randomized games give each ship a spawnBoost launch velocity toward the
    // centre; explicit opts.starts spawn AT REST for deterministic tests.
    this.stargates = opts.starts ? stargatesFrom(opts.starts) : randomStargates(opts.rng);
    const boost = opts.starts ? 0 : CONFIG.spawnBoost;
    this.ships = this.stargates.map((g) => makeShip(g.owner, g.pos, V.scale(g.facing, boost)));
    this.projectiles = [];
    this.plans = [null, null];
    this.phase = 'plan';       // 'plan' | 'resolve' | 'gameover'
    this.planningPlayer = 0;   // whose console is up
    this.winner = null;        // 0 | 1 | 'draw' | null
    this.endReason = null;
    this.log = [];             // each entry tagged `to` = the player who may perceive it
    this.reports = [];         // full per-turn truth reports, for the post-game replay
    this.lastReport = null;
  };

  Game.prototype.ship = function (p) { return this.ships[p]; };
  Game.prototype.enemyOf = function (p) { return this.ships[1 - p]; };

  /* Boundary radius at a given turn (shrinks during overtime to force closure). */
  Game.prototype.arenaRadiusAt = function (turn) {
    if (turn <= CONFIG.normalTurnCap) return CONFIG.arenaRadius0;
    const shrunk = CONFIG.arenaRadius0 - CONFIG.arenaShrinkPerTurn * (turn - CONFIG.normalTurnCap);
    return Math.max(CONFIG.arenaRadiusMin, shrunk);
  };
  Game.prototype.arenaRadius = function () { return this.arenaRadiusAt(this.turn); };
  Game.prototype.inOvertime = function () { return this.turn > CONFIG.normalTurnCap; };

  Game.prototype.weaponList = function () {
    return Object.keys(CONFIG.weapons).map((k) => ({ key: k, ...CONFIG.weapons[k] }));
  };

  /* --- plan cost / validation -------------------------------------------- */
  Game.prototype.planCost = function (plan) {
    if (!plan) return 0;
    let cost = V.len(plan.accel || V.of()) * CONFIG.accelCost;
    if (plan.weapon && plan.weapon !== 'none') cost += CONFIG.weapons[plan.weapon].cost;
    cost += plan.shield || 0;
    return cost;
  };
  Game.prototype.planValid = function (plan) {
    if (!plan) return false;
    if (V.len(plan.accel || V.of()) > CONFIG.maxAccel + 1e-6) return false;
    if ((plan.shield || 0) > CONFIG.shield.maxStrength + 1e-6) return false;
    return this.planCost(plan) <= CONFIG.energyPerTurn + 1e-6;
  };

  Game.prototype.submitPlan = function (player, plan) {
    this.plans[player] = plan;
  };

  /* Advance exactly one turn with BOTH players idle. Used by fast-forward to
   * observe light-lag / debug behaviours without either ship acting. */
  Game.prototype.idleTurn = function () {
    this.submitPlan(0, { accel: V.of(), weapon: 'none', shield: 0 });
    this.submitPlan(1, { accel: V.of(), weapon: 'none', shield: 0 });
    return this.resolve();
  };

  /* --- observation (light-delayed) for a given viewer --------------------- */
  Game.prototype.observeEnemy = function (viewer) {
    const me = this.ships[viewer];
    const enemy = this.ships[1 - viewer];
    const ob = Phys.observe(enemy.history, me.pos, this.turn, CONFIG.c);
    // Before any light has arrived, reveal NOTHING about the enemy — not its start
    // position, not the range/ETA. The raw solver returns oldest/arrivesAt for
    // omniscient callers; the sanctioned per-player channel strips them.
    if (!ob.visible) return { visible: false, inbound: true };
    return ob;
  };

  /* Own projectiles return TRUE positions (telemetry link); enemy projectiles
   * return light-delayed images (you must spot them coming). Each entry carries
   * only sanitized fields (type/pos/vel/age) — never a reference to the live
   * projectile, so an enemy projectile's true position can't leak through. */
  Game.prototype.observeProjectiles = function (viewer) {
    const me = this.ships[viewer];
    const out = [];
    for (const pr of this.projectiles) {
      if (!pr.alive) continue;
      if (pr.owner === viewer) {
        out.push({ own: true, visible: true, type: pr.type, pos: V.clone(pr.pos), vel: V.clone(pr.vel), age: 0 });
      } else {
        const ob = Phys.observe(pr.history, me.pos, this.turn, CONFIG.c);
        if (ob.visible) out.push({ own: false, visible: true, type: pr.type, pos: ob.pos, vel: ob.vel, age: ob.age });
      }
    }
    return out;
  };

  Game.prototype.firingSolution = function (viewer, weaponKey) {
    const w = CONFIG.weapons[weaponKey];
    if (!w) return { ok: false };
    const me = this.ships[viewer];
    const image = this.observeEnemy(viewer);
    return Phys.interceptEstimate(me.pos, image, w.speed);
  };

  /* The SANCTIONED per-player view. This is the only thing player-facing code
   * (planning UI + plan-scene renderer) may consult for the enemy. It contains
   * ONLY light-delayed images — never the enemy's true position/velocity and,
   * since starts are randomized and secret, no start intel either: until the
   * enemy's light arrives you have NO idea where they are. (God mode is the one
   * explicit exception and reads game.ships directly.) */
  Game.prototype.viewFor = function (viewer) {
    return {
      player: viewer,
      turn: this.turn,
      arenaRadius: this.arenaRadius(),
      overtime: this.inOvertime(),
      me: this.ships[viewer],                          // your own ship — your true state is yours to know
      enemy: this.observeEnemy(viewer),                // light-delayed image ONLY (blind => no position)
      projectiles: this.observeProjectiles(viewer),    // own true; enemy delayed
      stargates: this.stargates,                       // static launch points: public, fixed, never move
    };
  };

  /* --- resolution: advance one tick, return a truth report for replay ----- */
  Game.prototype.resolve = function () {
    const T = this.turn, T1 = T + 1;
    const report = { from: T, to: T1, moves: [], spawns: [], hits: [], destroyed: [], expired: [], segments: [] };
    const R = this.arenaRadiusAt(T1); // boundary this tick (shrinks in overtime)

    // Authoritative rules layer: never trust the UI to have enforced the budget.
    this.plans = this.plans.map((p) => this._enforceBudget(p || {}));
    // record the (sanitized) orders both players issued this turn, for the game log
    report.plans = this.plans.map((p) => ({
      accel: V.clone(p.accel || V.of()), weapon: p.weapon || 'none',
      aim: p.aim ? V.clone(p.aim) : null, shield: p.shield || 0,
      shieldDir: p.shieldDir ? V.clone(p.shieldDir) : null,
    }));

    // snapshot pre-move ship positions (for swept collision this tick)
    const s0 = this.ships.map((s) => V.clone(s.pos));

    // 1) ships move + set shields for this tick
    this.ships.forEach((s, i) => {
      const plan = this.plans[i] || {};
      // Inertia: thrust changes a persistent velocity (capped), then position
      // advances by that velocity (semi-implicit Euler). Coasting needs no thrust.
      const a = V.clampLen(plan.accel || V.of(), CONFIG.maxAccel);
      let v = V.clampLen(V.add(s.vel, a), CONFIG.maxSpeed);
      let np = V.add(s.pos, v);
      // arena wall: clamp position and cancel the outward velocity component (no bounce)
      if (V.len(np) > R) {
        const n = V.normalize(np);
        np = V.scale(n, R);
        const outward = V.dot(v, n);
        if (outward > 0) v = V.sub(v, V.scale(n, outward));
      }
      s.vel = v;
      s.pos = np;
      s.history.push({ t: T1, pos: V.clone(np) });
      s.shield = {
        strength: Math.min(plan.shield || 0, CONFIG.shield.maxStrength),
        // anchor the cone at the ship's post-move position (where it is when struck)
        dir: plan.shieldDir ? V.normalize(V.sub(plan.shieldDir, np)) : V.of(),
      };
      report.moves.push({ owner: i, from: s0[i], to: V.clone(np) });
    });
    const s1 = this.ships.map((s) => V.clone(s.pos));

    // 1b) ship-ship collision: if the two hulls' swept paths pass within
    // shipCollideRadius this tick, BOTH ships are destroyed (a head-on or grazing
    // ram). Swept (not just endpoint) so fast ships can't tunnel through each other.
    if (this.ships[0].alive && this.ships[1].alive) {
      const ca = V.closestApproach(s0[0], s1[0], s0[1], s1[1]);
      if (ca.dist <= CONFIG.shipCollideRadius) {
        const point = V.scale(V.add(V.lerp(s0[0], s1[0], ca.t), V.lerp(s0[1], s1[1], ca.t)), 0.5);
        this.ships.forEach((s) => { s.hp = 0; }); // step 4 marks both destroyed
        report.collision = { point, t: ca.t };
        // a collision is a local event both ships feel at once (no light delay)
        this._log(0, 'COLLISION — both ships destroyed', 'hit');
        this._log(1, 'COLLISION — both ships destroyed', 'hit');
      }
    }

    // 2) move existing projectiles + swept collision vs enemy ship
    const survivors = [];
    for (const pr of this.projectiles) {
      if (!pr.alive) continue;
      const p0 = V.clone(pr.pos);
      const p1 = V.add(pr.pos, pr.vel);
      pr.pos = p1; pr.history.push({ t: T1, pos: V.clone(p1) });
      const seg = { owner: pr.owner, type: pr.type, p0, p1: V.clone(p1), hit: false };
      report.segments.push(seg);

      const targetIdx = 1 - pr.owner;
      const target = this.ships[targetIdx];
      let detonated = false;
      if (target.alive && target.hp > 0) { // a target already dropped to 0 this tick takes no further hits
        const reach = pr.splash > 0 ? pr.splash : CONFIG.hitRadius;
        const r = Phys.sweptHit(p0, p1, s0[targetIdx], s1[targetIdx], reach);
        if (r.hit) {
          detonated = true; seg.hit = true;
          this._applyDamage(pr, target, targetIdx, r, report);
        }
      }
      // lifetime / range
      const age = T1 - pr.spawnT;
      const tooFar = V.len(pr.pos) > CONFIG.arenaRadius0 + 60;
      if (detonated) { pr.alive = false; }
      else if (age >= pr.life || tooFar) { pr.alive = false; report.expired.push(pr.id); }
      else survivors.push(pr);
    }
    this.projectiles = survivors;

    // 3) spawn newly-fired projectiles at the muzzle (ship's new position)
    this.ships.forEach((s, i) => {
      const plan = this.plans[i] || {};
      if (!s.alive || !plan.weapon || plan.weapon === 'none') return;
      const w = CONFIG.weapons[plan.weapon];
      const dir = V.normalize(V.sub(plan.aim || V.add(s.pos, V.of(1, 0, 0)), s.pos));
      if (V.len2(dir) < 1e-9) return;
      const pr = {
        id: nextId(), kind: 'proj', type: plan.weapon, owner: i,
        pos: V.clone(s.pos), vel: V.scale(dir, w.speed),
        history: [{ t: T1, pos: V.clone(s.pos) }],
        spawnT: T1, life: w.life, damage: w.damage, splash: w.splash, alive: true,
      };
      this.projectiles.push(pr);
      report.spawns.push({ owner: i, type: plan.weapon, pos: V.clone(s.pos), vel: V.clone(pr.vel) });
      // only the firer knows they fired (the enemy must wait for the muzzle light)
      this._log(i, `You fire ${w.name}`, i === 0 ? 'p1' : 'p2');
    });

    // 4) deaths / game over
    this.ships.forEach((s, i) => {
      if (s.alive && s.hp <= 0) { s.alive = false; report.destroyed.push(i); }
    });

    this.turn = T1;
    this.plans = [null, null];

    const dead = this.ships.filter((s) => !s.alive);
    if (dead.length) {
      const alive = this.ships.filter((s) => s.alive);
      if (alive.length === 1) { this.winner = alive[0].owner; this.endReason = 'destroyed'; }
      else if (report.collision) { this.winner = 'draw'; this.endReason = 'collision'; }
      else { this.winner = this._tiebreak(); this.endReason = 'mutual destruction'; }
      this.phase = 'gameover';
    } else if (this.turn >= CONFIG.hardTurnCap) {
      this.winner = this._tiebreak(); this.endReason = 'time limit'; this.phase = 'gameover';
    } else {
      this.phase = 'plan';
      this.planningPlayer = 0;
    }
    // end-of-turn truth snapshot of both ships (for the game log)
    report.state = this.ships.map((s) => ({ pos: V.clone(s.pos), vel: V.clone(s.vel), hp: s.hp, alive: s.alive }));
    this.lastReport = report;
    this.reports.push(report);
    return report;
  };

  /* A complete, JSON-serializable record of the game so far: config, per-turn
   * orders + resulting truth state + events, and the outcome. Used by the UI to
   * download/console a real playthrough, and by tests/debugging. */
  Game.prototype.exportLog = function (meta) {
    const C = CONFIG;
    return {
      meta: Object.assign({ savedAtTurn: this.turn }, meta || {}),
      config: {
        c: C.c, startDistance: C.startDistance, maxAccel: C.maxAccel, maxSpeed: C.maxSpeed,
        accelCost: C.accelCost, energyPerTurn: C.energyPerTurn, startHP: C.startHP, hitRadius: C.hitRadius,
        arenaRadius0: C.arenaRadius0, arenaRadiusMin: C.arenaRadiusMin, normalTurnCap: C.normalTurnCap,
        hardTurnCap: C.hardTurnCap, weapons: C.weapons, shield: C.shield,
      },
      start: this.ships.map((s) => ({ pos: V.clone(s.history[0].pos) })),
      stargates: this.stargates.map((g) => ({ owner: g.owner, pos: V.clone(g.pos), facing: V.clone(g.facing) })),
      outcome: { winner: this.winner, endReason: this.endReason, turns: this.turn },
      turns: this.reports.map((r) => ({
        turn: r.to, plans: r.plans, state: r.state,
        spawns: r.spawns, hits: r.hits, destroyed: r.destroyed,
        collision: r.collision || null,
      })),
    };
  };

  /* Sanitize a plan against the hard rules the engine OWNS (never trusts the UI):
   * clamp speed & shield, then enforce the energy budget by shedding shield, then
   * weapon, then scaling the move — so move > weapon > shield in priority. */
  Game.prototype._enforceBudget = function (plan) {
    const p = {
      accel: plan.accel ? V.clampLen(plan.accel, CONFIG.maxAccel) : V.of(),
      weapon: plan.weapon || 'none',
      aim: plan.aim || null,
      shield: Math.max(0, Math.min(plan.shield || 0, CONFIG.shield.maxStrength)),
      shieldDir: plan.shieldDir || null,
    };
    const over = () => this.planCost(p) - CONFIG.energyPerTurn;
    if (over() > 1e-9 && p.shield > 0) p.shield = Math.max(0, p.shield - Math.ceil(over()));
    if (over() > 1e-9 && p.weapon !== 'none') { p.weapon = 'none'; p.aim = null; }
    if (over() > 1e-9) {
      const maxUnits = Math.max(0, CONFIG.energyPerTurn - p.shield) / CONFIG.accelCost;
      p.accel = V.clampLen(p.accel, Math.min(CONFIG.maxAccel, maxUnits));
    }
    if (p.shield === 0) p.shieldDir = null;
    return p;
  };

  /* Tiebreaker ladder: HP, then total damage dealt, then draw. */
  Game.prototype._tiebreak = function () {
    const [a, b] = this.ships;
    if (Math.abs(a.hp - b.hp) > 1e-9) return a.hp > b.hp ? 0 : 1;
    if (Math.abs(a.damageDealt - b.damageDealt) > 1e-9) return a.damageDealt > b.damageDealt ? 0 : 1;
    return 'draw';
  };

  Game.prototype._applyDamage = function (pr, target, targetIdx, hit, report) {
    let dmg = pr.damage;
    // splash falloff (torpedo): reduce by distance from detonation
    if (pr.splash > 0) {
      const fall = Math.max(0, 1 - hit.miss / pr.splash);
      dmg = pr.damage * (0.4 + 0.6 * fall); // direct ~full, edge ~40%
    }
    // shield: blocks if the shot arrives from within the shielded cone.
    // A projectile's velocity points away from its origin, so the direction the
    // shot is INCOMING FROM is the reverse of its velocity.
    let blocked = 0;
    const sh = target.shield;
    if (sh && sh.strength > 0 && V.len2(sh.dir) > 1e-6) {
      const fromDir = V.normalize(V.neg(pr.vel)); // toward where the shot came from
      if (V.dot(fromDir, sh.dir) >= CONFIG.shield.cosThreshold) {
        blocked = Math.min(dmg, sh.strength * CONFIG.shield.absorbPerPoint);
      }
    }
    const applied = Math.max(0, dmg - blocked);
    target.hp = Math.max(0, target.hp - applied);
    this.ships[pr.owner].damageDealt += applied;
    report.hits.push({
      target: targetIdx, owner: pr.owner, type: pr.type,
      point: V.clone(hit.point), damage: applied, blocked, miss: hit.miss,
    });
    // only the ship that is hit perceives the impact (a local event); the shooter
    // must wait for the return light to learn whether the shot connected.
    this._log(targetIdx,
      `Incoming ${pr.type} hits you for ${applied.toFixed(0)}` +
      (blocked > 0 ? ` (shield −${blocked.toFixed(0)})` : ''), 'hit');
  };

  Game.prototype._log = function (to, msg, cls) {
    this.log.unshift({ turn: this.turn, msg, cls: cls || 'info', to });
    if (this.log.length > 60) this.log.pop();
  };

  window.LL.Engine = Game;
  window.LL.CONFIG = CONFIG;
  window.LL.PLAYER_COLORS = PLAYER_COLORS;
})();
