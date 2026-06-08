/* Unit tests for the DOM-free core: vec3, camera, physics, engine, viewmodel. */
'use strict';
const { Runner, loadCore } = require('./harness');

const LL = loadCore();
const { V, Camera, Phys, Engine, View, CONFIG } = LL;
const t = new Runner('unit');

/* ===================== vec3 ===================== */
(() => {
  t.ok('add', V.eq(V.add(V.of(1, 2, 3), V.of(4, 5, 6)), V.of(5, 7, 9)));
  t.ok('sub', V.eq(V.sub(V.of(4, 5, 6), V.of(1, 2, 3)), V.of(3, 3, 3)));
  t.ok('scale', V.eq(V.scale(V.of(1, -2, 3), 2), V.of(2, -4, 6)));
  t.approx('dot', V.dot(V.of(1, 2, 3), V.of(4, 5, 6)), 32);
  t.ok('cross', V.eq(V.cross(V.of(1, 0, 0), V.of(0, 1, 0)), V.of(0, 0, 1)));
  t.approx('len', V.len(V.of(3, 4, 0)), 5);
  t.approx('dist', V.dist(V.of(0, 0, 0), V.of(0, 3, 4)), 5);
  t.approx('normalize unit', V.len(V.normalize(V.of(0, 7, 0))), 1);
  t.ok('normalize zero is zero', V.eq(V.normalize(V.of(0, 0, 0)), V.of(0, 0, 0)));
  t.ok('lerp midpoint', V.eq(V.lerp(V.of(0, 0, 0), V.of(2, 4, 6), 0.5), V.of(1, 2, 3)));
  t.approx('clampLen caps', V.len(V.clampLen(V.of(10, 0, 0), 3)), 3);
  t.ok('clampLen keeps short', V.eq(V.clampLen(V.of(1, 0, 0), 3), V.of(1, 0, 0)));
  // closest approach: crossing paths meet at t=0.5
  const ca = V.closestApproach(V.of(-5, 0, 0), V.of(5, 0, 0), V.of(0, -1, 0), V.of(0, 1, 0));
  t.approx('closestApproach dist', ca.dist, 0, 1e-6);
  t.approx('closestApproach t', ca.t, 0.5, 1e-6);
  const cp = V.closestApproach(V.of(0, 5, 0), V.of(0, 5, 0), V.of(0, 0, 0), V.of(0, 0, 0));
  t.approx('closestApproach static', cp.dist, 5);
})();

/* ===================== camera ===================== */
(() => {
  const cam = new Camera();
  cam.snapTo('top'); t.ok('snap top looks down', cam.pitch > 1.4);
  cam.snapTo('front'); t.ok('snap front low pitch', cam.pitch < 0.2);
  cam.snapTo('side'); t.approx('snap side yaw', cam.yaw, Math.PI * 0.5, 1e-6);
  cam.snapTo('iso');
  cam.target = V.of(0, 0, 0); cam.distance = 100; cam.update();
  const c = cam.project(V.of(0, 0, 0), 800, 600);
  t.ok('origin is visible in front of camera', c.visible);
  t.approx('origin projects near center x', c.x, 400, 1);
  t.approx('origin projects near center y', c.y, 300, 1);
  const behind = V.add(cam.eye(), V.scale(V.normalize(V.sub(cam.eye(), cam.target)), 40));
  t.ok('point behind camera not visible', !cam.project(behind, 800, 600).visible);
  cam.pitch = 0; cam.orbit(0, 99); t.ok('orbit clamps pitch', Math.abs(cam.pitch) < Math.PI / 2);
  cam.distance = 100; cam.zoom(0.0001); t.ok('zoom clamps min distance', cam.distance >= 20);
  cam.distance = 100; cam.zoom(1e6); t.ok('zoom clamps max distance', cam.distance <= 600);
})();

/* ===================== physics: retarded-time observation ===================== */
(() => {
  const c = CONFIG.c; // 10
  const stat = (T, pos) => { const h = []; for (let i = 0; i <= T; i++) h.push({ t: i, pos: V.clone(pos) }); return h; };
  const O = V.of(0, 0, 0);
  t.ok('blind before light arrives', Phys.observe(stat(5, V.of(100, 0, 0)), O, 5, c).inbound === true);
  const r10 = Phys.observe(stat(10, V.of(100, 0, 0)), O, 10, c);
  t.ok('visible once light arrives', r10.visible);
  t.approx('stationary 100u @ c10 → 10-turn-old image', r10.age, 10);
  t.approx('apparent pos == start', r10.pos.x, 100);
  t.approx('lag stays constant while stationary', Phys.observe(stat(40, V.of(100, 0, 0)), O, 40, c).age, 10);
  t.approx('30u → age 3', Phys.observe(stat(20, V.of(30, 0, 0)), O, 20, c).age, 3);
  t.ok('within c → essentially live', Phys.observe(stat(20, V.of(5, 0, 0)), O, 20, c).age < 1);
  // moving target: image lags true position, retarded equation self-consistent
  const mov = []; for (let i = 0; i <= 30; i++) mov.push({ t: i, pos: V.of(100 + i, 0, 0) });
  const rm = Phys.observe(mov, O, 30, c);
  t.ok('moving-away image is behind true pos', rm.pos.x < 130 - 5);
  t.approx('retarded eqn holds: dist == c*age', V.dist(rm.pos, O), c * rm.age, 0.3);
  t.approx('apparent velocity recovered', rm.vel.x, 1, 0.01);
})();

/* ===================== physics: intercept + swept hit ===================== */
(() => {
  const sol = Phys.interceptEstimate(V.of(0, 0, 0), { visible: true, pos: V.of(100, 0, 0), vel: V.of(0, 2, 0), age: 5 }, 10);
  t.ok('intercept ok', sol.ok);
  t.approx('estNow extrapolated by age', sol.estNow.y, 10);
  t.ok('aim leads ahead of estNow', sol.aim.y > 10);
  t.approx('intercept consistent |aim|==w*tau', V.len(sol.aim), 10 * sol.tau, 0.5);
  t.ok('uncatchable target → no solution', !Phys.interceptEstimate(V.of(0, 0, 0), { visible: true, pos: V.of(50, 0, 0), vel: V.of(20, 0, 0), age: 0 }, 10).ok);
  t.ok('swept hit detected', Phys.sweptHit(V.of(-5, 0, 0), V.of(5, 0, 0), V.of(0, -1, 0), V.of(0, 1, 0), 2).hit);
  t.ok('swept miss', !Phys.sweptHit(V.of(-5, 20, 0), V.of(5, 20, 0), V.of(0, -1, 0), V.of(0, 1, 0), 2).hit);
})();

/* ===================== engine: setup, budget, resolution ===================== */
(() => {
  const g = new Engine();
  // starts are RANDOMIZED each game: at least startDistance apart, both inside the arena
  let minSep = Infinity, maxSep = 0, allInside = true;
  for (let i = 0; i < 200; i++) {
    const gg = new Engine();
    const d = V.dist(gg.ships[0].pos, gg.ships[1].pos);
    minSep = Math.min(minSep, d); maxSep = Math.max(maxSep, d);
    if (V.len(gg.ships[0].pos) > CONFIG.arenaRadius0 || V.len(gg.ships[1].pos) > CONFIG.arenaRadius0) allInside = false;
  }
  t.ok('randomized starts are always >= startDistance apart', minSep >= CONFIG.startDistance - 1e-9, 'minSep=' + minSep.toFixed(2));
  t.ok('randomized starts actually vary (not a fixed pair)', maxSep - minSep > 1e-6);
  t.ok('randomized starts stay inside the arena', allInside);
  t.ok('explicit starts override randomization (deterministic tests)',
    V.eq(new Engine({ starts: [V.of(-50, 0, 0), V.of(50, 0, 0)] }).ships[0].pos, V.of(-50, 0, 0)));
  t.ok('a seeded rng makes starts reproducible',
    V.eq(new Engine({ rng: (() => { let s = 7; return () => (s = (s * 9301 + 49297) % 233280) / 233280; })() }).ships[0].pos,
         new Engine({ rng: (() => { let s = 7; return () => (s = (s * 9301 + 49297) % 233280) / 233280; })() }).ships[0].pos));
  t.ok('plan within budget valid', g.planValid({ accel: V.of(2, 0, 0), weapon: 'torpedo', shield: 0 }));
  t.ok('over-budget plan invalid', !g.planValid({ accel: V.of(3, 0, 0), weapon: 'laser', shield: 8 }));
  t.ok('over-speed plan invalid', !g.planValid({ accel: V.of(9, 0, 0), weapon: 'none' }));

  // engine enforces budget even if a plan bypasses the UI
  const sane = g._enforceBudget({ accel: V.of(3, 0, 0), weapon: 'laser', aim: V.of(50, 0, 0), shield: 8, shieldDir: V.of(0, 0, 0) });
  t.ok('enforceBudget brings cost within budget', g.planCost(sane) <= CONFIG.energyPerTurn + 1e-9);
  t.ok('enforceBudget sheds shield first', sane.shield === 0);

  // the author's opening scenario: both move + fire, nothing connects, both blind
  const g2 = new Engine();
  g2.submitPlan(0, { accel: V.of(2, 0, 0), weapon: 'torpedo', aim: V.of(50, 0, 0) });
  g2.submitPlan(1, { accel: V.of(0, 2, 0), weapon: 'torpedo', aim: V.of(-50, 0, 0) });
  const r1 = g2.resolve();
  t.ok('turn 1: no hits', r1.hits.length === 0);
  t.ok('turn 1: two torpedoes launched', r1.spawns.length === 2);
  t.ok('turn 1: P1 blind to enemy', !g2.observeEnemy(0).visible);
  t.ok('turn 1: P2 blind to enemy', !g2.observeEnemy(1).visible);
})();

/* ===================== engine: idle turn / first contact (fast-forward core) ===================== */
(() => {
  // explicit 100u start so the light-front timing (first contact at turn 10) is exact
  const g = new Engine({ starts: [V.of(-50, 0, 0), V.of(50, 0, 0)] });
  let firstSeen = null, movedWhileIdle = false;
  const startA = V.clone(g.ships[0].pos), startB = V.clone(g.ships[1].pos);
  for (let i = 0; i < 15; i++) {
    g.idleTurn();
    if (V.dist(g.ships[0].pos, startA) > 1e-9 || V.dist(g.ships[1].pos, startB) > 1e-9) movedWhileIdle = true;
    if (firstSeen === null && g.observeEnemy(0).visible) firstSeen = g.turn;
  }
  t.ok('idleTurn: ships never move', !movedWhileIdle);
  t.ok('idleTurn: HP unchanged', g.ships[0].hp === CONFIG.startHP && g.ships[1].hp === CONFIG.startHP);
  t.ok('idleTurn: no projectiles ever', g.projectiles.length === 0);
  t.ok('idle first contact at turn 10', firstSeen === 10, 'firstSeen=' + firstSeen);
  t.approx('idle contact image is exactly 10 turns old', g.observeEnemy(0).age, 10, 1e-6);
  t.ok('idleTurn stores reports', g.reports.length === g.turn);
})();

/* ===================== engine: inertia (acceleration movement model) ===================== */
(() => {
  const fresh = () => { const g = new Engine(); g.ships[0].pos = V.of(0, 0, 0); g.ships[0].history = [{ t: 0, pos: V.of(0, 0, 0) }]; return g; };

  // from rest, one turn of thrust a sets velocity a and moves by a
  const g = fresh();
  g.submitPlan(0, { accel: V.of(3, 0, 0), weapon: 'none' }); g.submitPlan(1, { accel: V.of(), weapon: 'none' }); g.resolve();
  t.ok('thrust from rest sets velocity', V.eq(g.ships[0].vel, V.of(3, 0, 0)));
  t.approx('one turn from rest moves by thrust', g.ships[0].pos.x, 3);
  // COASTING: with no thrust, velocity persists and the ship keeps moving (inertia)
  g.submitPlan(0, { accel: V.of(), weapon: 'none' }); g.submitPlan(1, { accel: V.of(), weapon: 'none' }); g.resolve();
  t.ok('coasting keeps velocity', V.eq(g.ships[0].vel, V.of(3, 0, 0)));
  t.approx('coasting keeps moving without thrust', g.ships[0].pos.x, 6);

  // velocity accumulates only up to the terminal cap, and stays under c
  const g2 = fresh();
  for (let i = 0; i < 6; i++) { g2.submitPlan(0, { accel: V.of(3, 0, 0), weapon: 'none' }); g2.submitPlan(1, { accel: V.of(), weapon: 'none' }); g2.resolve(); }
  t.approx('velocity capped at terminal maxSpeed', V.len(g2.ships[0].vel), CONFIG.maxSpeed);
  t.ok('terminal speed stays below c (solver validity)', CONFIG.maxSpeed < CONFIG.c);
  t.ok('accel cap < terminal => real momentum (multi-turn ramp)', CONFIG.maxAccel < CONFIG.maxSpeed);

  // BRAKING: thrust opposite to velocity bleeds speed but cannot stop instantly from top speed
  const vTop = V.len(g2.ships[0].vel);
  g2.submitPlan(0, { accel: V.clampLen(V.neg(g2.ships[0].vel), CONFIG.maxAccel), weapon: 'none' }); g2.submitPlan(1, { accel: V.of(), weapon: 'none' }); g2.resolve();
  t.ok('braking reduces speed', V.len(g2.ships[0].vel) < vTop - 1e-6);
  t.ok('cannot fully stop from top speed in one turn', V.len(g2.ships[0].vel) > 1e-6);

  // economy: coasting is FREE, thrust costs accelCost per unit
  t.approx('coasting is free (only the weapon costs)', g.planCost({ accel: V.of(), weapon: 'laser' }), CONFIG.weapons.laser.cost);
  t.approx('thrust costs accelCost per unit', g.planCost({ accel: V.of(3, 0, 0), weapon: 'none' }), 3 * CONFIG.accelCost);

  // arena wall clamps position AND cancels the outward velocity component (no bounce / no pile-up)
  const g3 = new Engine(); const R = g3.arenaRadius();
  g3.ships[0].pos = V.of(R - 1, 0, 0); g3.ships[0].vel = V.of(5, 0, 0); g3.ships[0].history = [{ t: 0, pos: V.of(R - 1, 0, 0) }];
  g3.submitPlan(0, { accel: V.of(), weapon: 'none' }); g3.submitPlan(1, { accel: V.of(), weapon: 'none' }); g3.resolve();
  t.ok('ship clamped inside arena', V.len(g3.ships[0].pos) <= R + 1e-6);
  t.approx('outward velocity cancelled at the wall', g3.ships[0].vel.x, 0, 1e-6);
})();

/* ===================== engine: combat, shields, overkill, tiebreak ===================== */
(() => {
  // laser eventually hits a near, stationary target and deals damage credited to firer
  const g = new Engine();
  g.ships[0].pos = V.of(0, 0, 0); g.ships[0].history = [{ t: 0, pos: V.of(0, 0, 0) }];
  g.ships[1].pos = V.of(10, 0, 0); g.ships[1].history = [{ t: 0, pos: V.of(10, 0, 0) }];
  let hit = false;
  for (let i = 0; i < 4 && !hit; i++) {
    g.submitPlan(0, { accel: V.of(), weapon: i === 0 ? 'laser' : 'none', aim: V.of(10, 0, 0) });
    g.submitPlan(1, { accel: V.of(), weapon: 'none' });
    if (g.resolve().hits.length) hit = true;
  }
  t.ok('laser hits stationary target', hit);
  t.ok('damage reduced enemy HP', g.ships[1].hp < CONFIG.startHP);
  t.ok('damage credited to firer', g.ships[0].damageDealt > 0);

  // shield direction is anchored at the POST-move position (not pre-move)
  const gs = new Engine();
  gs.ships[1].pos = V.of(0, 0, 0); gs.ships[1].history = [{ t: 0, pos: V.of(0, 0, 0) }];
  gs.submitPlan(0, { accel: V.of(), weapon: 'none' });
  gs.submitPlan(1, { accel: V.of(3, 0, 0), weapon: 'none', shield: 2, shieldDir: V.of(0, 10, 0) });
  gs.resolve();
  const expected = V.normalize(V.sub(V.of(0, 10, 0), V.of(3, 0, 0))); // from post-move (3,0,0)
  t.ok('shield cone anchored post-move', V.eq(gs.ships[1].shield.dir, expected, 1e-6));

  // shield blocks a shot from the faced cone, but not from behind
  const blockTest = (faceX) => {
    const gg = new Engine();
    gg.ships[0].pos = V.of(0, 0, 0); gg.ships[0].history = [{ t: 0, pos: V.of(0, 0, 0) }];
    gg.ships[1].pos = V.of(10, 0, 0); gg.ships[1].history = [{ t: 0, pos: V.of(10, 0, 0) }];
    let blocked = 0, dealt = 0;
    for (let i = 0; i < 4; i++) {
      gg.submitPlan(0, { accel: V.of(), weapon: i === 0 ? 'laser' : 'none', aim: V.of(10, 0, 0) });
      gg.submitPlan(1, { accel: V.of(), weapon: 'none', shield: 8, shieldDir: V.of(faceX, 0, 0) });
      const r = gg.resolve();
      r.hits.forEach((h) => { if (h.target === 1) { blocked += h.blocked; dealt += h.damage; } });
      if (gg.phase !== 'plan') break;
    }
    return { blocked, dealt };
  };
  t.ok('shield facing the shooter blocks damage', blockTest(0).blocked > 0);     // face -x (toward P1)
  t.ok('shield facing away blocks nothing', blockTest(100).blocked === 0);       // face +x (away)

  // overkill: two lasers landing the same tick cannot double-credit / multi-log the kill
  const go = new Engine();
  go.ships[0].pos = V.of(0, 0, 0); go.ships[0].history = [{ t: 0, pos: V.of(0, 0, 0) }];
  go.ships[1].pos = V.of(10, 0, 0); go.ships[1].history = [{ t: 0, pos: V.of(10, 0, 0) }]; go.ships[1].hp = 10;
  const laser = () => ({ id: 1, kind: 'proj', type: 'laser', owner: 0, pos: V.of(0, 0, 0), vel: V.of(10, 0, 0), history: [{ t: 0, pos: V.of(0, 0, 0) }], spawnT: 0, life: 50, damage: 45, splash: 0, alive: true });
  go.projectiles = [laser(), laser()];
  go.submitPlan(0, { accel: V.of(), weapon: 'none' }); go.submitPlan(1, { accel: V.of(), weapon: 'none' });
  const ro = go.resolve();
  t.ok('doomed ship is destroyed', !go.ships[1].alive);
  t.ok('only one hit registered on the kill tick', ro.hits.filter((h) => h.target === 1).length === 1);
  t.ok('overkill not double-credited', go.ships[0].damageDealt <= 45 + 1e-6);

  // torpedo splash deals falloff (a near miss still detonates for partial damage)
  const gt = new Engine();
  gt.ships[1].pos = V.of(0, 0, 0); gt.ships[1].history = [{ t: 0, pos: V.of(0, 0, 0) }];
  const w = CONFIG.weapons.torpedo;
  gt.projectiles = [{ id: 2, kind: 'proj', type: 'torpedo', owner: 0, pos: V.of(-w.speed, w.splash - 1, 0), vel: V.of(w.speed, 0, 0), history: [{ t: 0, pos: V.of(-w.speed, w.splash - 1, 0) }], spawnT: 0, life: w.life, damage: w.damage, splash: w.splash, alive: true }];
  gt.submitPlan(0, { accel: V.of(), weapon: 'none' }); gt.submitPlan(1, { accel: V.of(), weapon: 'none' });
  const rt = gt.resolve();
  t.ok('torpedo near-miss detonates with splash', rt.hits.length === 1);
  t.ok('splash damage is reduced (not full)', rt.hits[0].damage > 0 && rt.hits[0].damage < w.damage);
})();

/* ===================== engine: overtime + termination + per-viewer log ===================== */
(() => {
  const g = new Engine();
  t.ok('arena full size pre-overtime', g.arenaRadiusAt(CONFIG.normalTurnCap) === CONFIG.arenaRadius0);
  t.ok('arena shrinks in overtime', g.arenaRadiusAt(CONFIG.normalTurnCap + 10) < CONFIG.arenaRadius0);
  t.ok('arena clamps to minimum', g.arenaRadiusAt(1e9) === CONFIG.arenaRadiusMin);

  let guard = 0;
  while (g.phase !== 'gameover' && guard++ < 500) g.idleTurn();
  t.ok('passive game terminates', g.phase === 'gameover');
  t.ok('terminates at hard cap', g.turn === CONFIG.hardTurnCap);
  t.ok('equal passive game is a draw', g.winner === 'draw');
  t.ok('ships forced inside shrunken arena', V.len(g.ships[0].pos) <= CONFIG.arenaRadiusMin + 1e-6);

  const tb = new Engine();
  tb.ships[0].hp = 50; tb.ships[1].hp = 50; tb.ships[0].damageDealt = 10;
  t.ok('tiebreak by damage when HP tied', tb._tiebreak() === 0);
  tb.ships[0].hp = 30;
  t.ok('tiebreak by HP first', tb._tiebreak() === 1);

  // per-viewer log tagging: you see your own fire + hits on you, never enemy fire
  const gl = new Engine();
  gl.ships[0].pos = V.of(0, 0, 0); gl.ships[0].history = [{ t: 0, pos: V.of(0, 0, 0) }];
  gl.ships[1].pos = V.of(10, 0, 0); gl.ships[1].history = [{ t: 0, pos: V.of(10, 0, 0) }];
  for (let i = 0; i < 3; i++) {
    gl.submitPlan(0, { accel: V.of(), weapon: i === 0 ? 'laser' : 'none', aim: V.of(10, 0, 0) });
    gl.submitPlan(1, { accel: V.of(), weapon: 'none' });
    gl.resolve();
  }
  t.ok('every log entry is tagged to a player', gl.log.length > 0 && gl.log.every((e) => e.to === 0 || e.to === 1));
  t.ok('fire entries tagged to the firer (P0)', gl.log.filter((e) => /You fire/.test(e.msg)).every((e) => e.to === 0));
  t.ok('hit entries tagged to the victim (P1)', gl.log.filter((e) => /hits you/.test(e.msg)).every((e) => e.to === 1));
})();

/* ===================== viewmodel: no center axes, fair framing, scenes ===================== */
(() => {
  // explicit symmetric starts so light timing is deterministic in this block
  const g = new Engine({ starts: [V.of(-50, 0, 0), V.of(50, 0, 0)] });
  const bd = View.backdrop(CONFIG.arenaRadius0, false);
  t.ok('backdrop has NO world axes (removed)', !bd.some((p) => p.type === 'axes'));
  t.ok('backdrop has grid + sphere + starfield', ['grid', 'sphere', 'starfield'].every((tp) => bd.some((p) => p.type === tp)));

  // before contact: NO SIGNAL label, no enemy ghost ship, and NO enemy-position hint
  const early = View.buildPlanScene(g, 0, { accel: V.of(), weapon: 'none' }, {});
  t.ok('pre-contact shows NO SIGNAL', early.primitives.some((p) => p.type === 'label' && /NO SIGNAL/.test(p.text)));
  t.ok('pre-contact draws no enemy ghost ship', !early.primitives.some((p) => p.type === 'ship' && p.ghost));
  // the only non-own primitives pre-contact are the backdrop + own-ship markers: nothing
  // is drawn anywhere near the (hidden) enemy start position.
  const enemyStart = g.ships[1].pos;
  t.ok('pre-contact draws nothing at/near the hidden enemy position',
    !early.primitives.some((p) => p.pos && V.dist(p.pos, enemyStart) < CONFIG.maxSpeed));
  t.ok('pre-contact camera frames own ship only (no enemy guess)', V.eq(early.target, g.ships[0].pos));

  // camera framing must use the APPARENT enemy, never the true (hidden) position.
  // Move the enemy (P1) in +y while P0 stays put and observes.
  for (let i = 0; i < 12; i++) {
    g.submitPlan(0, { accel: V.of(), weapon: 'none' });
    g.submitPlan(1, { accel: V.of(0, 3, 0), weapon: 'none' });
    g.resolve();
  }
  const ob = g.observeEnemy(0);
  const scene = View.buildPlanScene(g, 0, { accel: V.of(), weapon: 'none' }, {});
  t.ok('enemy now visible as a delayed ghost', ob.visible && scene.primitives.some((p) => p.type === 'ship' && p.ghost));
  t.ok('contact shows age badge', scene.primitives.some((p) => p.type === 'label' && /light T−/.test(p.text)));
  t.ok('uncertainty bubble drawn', scene.primitives.some((p) => p.type === 'bubble'));
  const apparentMidY = (g.ships[0].pos.y + ob.pos.y) / 2;
  const trueMidY = (g.ships[0].pos.y + g.ships[1].pos.y) / 2;
  t.ok('camera frames the APPARENT enemy, not the true position',
    Math.abs(scene.target.y - apparentMidY) < Math.abs(scene.target.y - trueMidY) - 1,
    `target.y=${scene.target.y.toFixed(1)} apparent=${apparentMidY.toFixed(1)} true=${trueMidY.toFixed(1)}`);

  // replay scene builds with ship trails and does not throw
  const rep = View.buildReplayScene(g, g.turn * 0.5);
  t.ok('replay scene builds', rep.primitives.length > 5);
  t.ok('replay includes ship trajectory lines', rep.primitives.some((p) => p.type === 'line'));
})();

/* ===================== viewmodel: god view (debug, all objects, truth) ===================== */
(() => {
  const g = new Engine();
  g.ships[0].pos = V.of(-20, 0, 0); g.ships[1].pos = V.of(20, 5, 0);
  g.projectiles = [
    { id: 1, kind: 'proj', type: 'laser', owner: 0, pos: V.of(-10, 0, 0), vel: V.of(10, 0, 0), alive: true },
    { id: 2, kind: 'proj', type: 'torpedo', owner: 1, pos: V.of(10, 5, 0), vel: V.of(-6, 0, 0), alive: true },
    { id: 3, kind: 'proj', type: 'laser', owner: 0, pos: V.of(0, 0, 0), vel: V.of(0, 0, 0), alive: false },
  ];
  const god = View.buildGodScene(g);
  const ships = god.primitives.filter((p) => p.type === 'ship');
  const pts = god.primitives.filter((p) => p.type === 'point');
  t.ok('god view shows both ships', ships.length === 2);
  t.ok('god view ship 0 at TRUE pos', ships.some((p) => V.eq(p.pos, V.of(-20, 0, 0))));
  t.ok('god view ship 1 at TRUE pos', ships.some((p) => V.eq(p.pos, V.of(20, 5, 0))));
  t.ok('god view shows both players\' live projectiles', pts.some((p) => V.eq(p.pos, V.of(-10, 0, 0))) && pts.some((p) => V.eq(p.pos, V.of(10, 5, 0))));
  t.ok('god view excludes dead projectiles', !pts.some((p) => V.eq(p.pos, V.of(0, 0, 0))));
  t.ok('god view target is true midpoint', V.eq(god.target, V.of(0, 2.5, 0)));

  // contrast: at turn 0 the plan view hides the enemy (light-lag), god view reveals it
  const g2 = new Engine();
  const planShips = View.buildPlanScene(g2, 0, { accel: V.of(), weapon: 'none' }, {}).primitives.filter((p) => p.type === 'ship');
  t.ok('plan view shows only own ship early', planShips.length === 1);
  t.ok('god view reveals the enemy even before its light arrives', View.buildGodScene(g2).primitives.filter((p) => p.type === 'ship').length === 2);
})();

/* ===================== AI: registry + Hunter behavior + view-only fairness ===================== */
(() => {
  const AI = LL.AI;
  // a hand-built sanctioned view (the only thing an AI ever receives)
  const mkView = (over) => Object.assign({
    player: 1, turn: 12, arenaRadius: CONFIG.arenaRadius0, overtime: false,
    me: { pos: V.of(0, 0, 0), vel: V.of() },
    enemy: { visible: true, pos: V.of(50, 0, 0), vel: V.of(0, 0, 0), age: 5 }, // within strike range
    projectiles: [],
  }, over || {});

  t.ok('registry lists the Hunter', AI.list().some((a) => a.key === 'hunter'));
  t.ok('every AI entry has name + description', AI.list().every((a) => a.name && a.description));
  t.ok('unknown key falls back to a real strategy', typeof AI.get('nope').decide === 'function');

  // Hunter: closes + fires on a visible enemy, no shield when nothing incoming
  let p = AI.decide('hunter', mkView());
  t.ok('hunter thrusts toward the enemy', V.dot(p.accel, V.of(1, 0, 0)) > 0);
  t.ok('hunter fires on a visible enemy', p.weapon !== 'none' && !!p.aim);
  t.ok('hunter does not shield with nothing incoming', p.shield === 0);
  // the AI issues the SAME commands as a human and stays within budget
  t.ok('hunter plan is valid & affordable', new Engine().planValid(p));

  // Hunter: shields toward a visibly incoming shot
  p = AI.decide('hunter', mkView({ projectiles: [{ own: false, type: 'torpedo', pos: V.of(20, 0, 0), vel: V.of(-6, 0, 0), age: 2 }] }));
  t.ok('hunter raises shields vs an incoming shot', p.shield > 0 && !!p.shieldDir);
  t.ok('hunter still affordable while shielding+firing', new Engine().planValid(p));

  // Hunter: blind (no light yet, start unknown) -> holds fire, searches toward the
  // arena centre (the neutral landmark) — never toward any leaked enemy position
  p = AI.decide('hunter', mkView({ me: { pos: V.of(-30, 0, 0), vel: V.of() }, enemy: { visible: false } }));
  t.ok('hunter holds fire when blind', p.weapon === 'none');
  t.ok('hunter searches toward the arena centre when blind', V.dot(p.accel, V.of(1, 0, 0)) > 0);

  // Hunter: SEEK steering cancels perpendicular momentum (turns in, doesn't just thrust at the point)
  p = AI.decide('hunter', mkView({ me: { pos: V.of(0, 0, 0), vel: V.of(0, CONFIG.maxSpeed, 0) }, enemy: { visible: true, pos: V.of(40, 0, 0), vel: V.of(), age: 1 } }));
  t.ok('hunter steers against perpendicular drift (seek)', p.accel.y < -1e-6);

  // Hunter: beyond strike range -> holds fire and commits near-max thrust to closing
  p = AI.decide('hunter', mkView({ enemy: { visible: true, pos: V.of(140, 0, 0), vel: V.of(), age: 8 } }));
  t.ok('hunter holds fire when far (closes first)', p.weapon === 'none');
  t.ok('hunter uses near-max thrust to close when far', V.len(p.accel) > CONFIG.maxAccel - 0.5);

  // FAIRNESS: the AI plans only from the delayed view — poisoning enemy true pos changes nothing
  const g = new Engine();
  for (let i = 0; i < 14; i++) { g.submitPlan(0, { accel: V.of(0, 2, 0), weapon: 'none' }); g.submitPlan(1, { accel: V.of(), weapon: 'none' }); g.resolve(); }
  const before = JSON.stringify(AI.decide('hunter', g.viewFor(1)));
  g.ships[0].pos = V.of(123456, 0, 0); g.ships[0].vel = V.of(999, 0, 0);
  t.ok('AI plan is unaffected by enemy true-pos tamper', JSON.stringify(AI.decide('hunter', g.viewFor(1))) === before);
})();

/* ===================== fairness: enemy TRUE position is never exposed to a player ===================== */
(() => {
  // explicit starts so the enemy reliably becomes visible within the loop
  const g = new Engine({ starts: [V.of(-50, 0, 0), V.of(50, 0, 0)] });
  // reach a state where the enemy is visible as a moving, delayed image
  for (let i = 0; i < 14; i++) { g.submitPlan(0, { accel: V.of(), weapon: 'none' }); g.submitPlan(1, { accel: V.of(0, 2, 0), weapon: 'none' }); g.resolve(); }
  t.ok('precondition: enemy visible as a delayed image', g.observeEnemy(0).visible);

  const planArgs = [g, 0, { accel: V.of(), weapon: 'laser', aim: V.of(0, 0, 0) }, { showSolution: true }];
  const sceneBefore = JSON.stringify(View.buildPlanScene(...planArgs).primitives);
  const viewBefore = JSON.stringify(g.viewFor(0));

  // POISON the enemy's true current position & velocity with absurd values
  g.ships[1].pos = V.of(99999, -88888, 77777);
  g.ships[1].vel = V.of(500, 500, 500);

  t.ok('player plan-scene is unaffected by enemy true-pos tamper', JSON.stringify(View.buildPlanScene(...planArgs).primitives) === sceneBefore);
  t.ok('viewFor is unaffected by enemy true-pos tamper', JSON.stringify(g.viewFor(0)) === viewBefore);

  const v = g.viewFor(0);
  t.ok('viewFor.enemy is exactly the delayed image (no true pos)', JSON.stringify(v.enemy) === JSON.stringify(g.observeEnemy(0)));
  t.ok('viewFor exposes NO start intel (randomized & secret)', !('enemyIntel' in v));
  t.ok('delayed image is NOT the poisoned true position', V.dist(v.enemy.pos, g.ships[1].pos) > 1000);
  const towardTgt = v.enemy.visible ? v.enemy.pos : V.of(); // how setAccelToward/AT-IMAGE pick their target
  t.ok('TOWARD/AT-IMAGE targets the visible image, not true pos', V.dist(towardTgt, g.ships[1].pos) > 1000);

  // BLIND viewer leaks nothing positional: no image, no start, no range/ETA
  const blind = new Engine({ starts: [V.of(-60, 0, 0), V.of(60, 0, 0)] }).viewFor(0);
  t.ok('blind view: enemy not visible', blind.enemy.visible === false);
  t.ok('blind view leaks no enemy position/range', blind.enemy.oldest === undefined && blind.enemy.arrivesAt === undefined && blind.enemy.pos === undefined && !('enemyIntel' in blind));

  // observeProjectiles must expose sanitized entries only (no live projectile reference)
  const g3 = new Engine(); g3.turn = 5;
  g3.ships[0].pos = V.of(0, 0, 0); g3.ships[0].history = [{ t: 0, pos: V.of(0, 0, 0) }];
  g3.projectiles = [{ id: 9, type: 'torpedo', owner: 1, alive: true, pos: V.of(8, 0, 0), vel: V.of(-1, 0, 0), history: [0, 1, 2, 3, 4, 5].map((tt) => ({ t: tt, pos: V.of(8, 0, 0) })) }];
  const obs = g3.observeProjectiles(0);
  t.ok('enemy projectile seen as a delayed image', obs.length === 1 && obs[0].own === false && obs[0].type === 'torpedo');
  t.ok('observed projectile exposes no live reference', obs[0].proj === undefined);

  // sanity: god view (debug) IS allowed to read true state — proves the tamper is real
  t.ok('god view (debug) does reflect the true/poisoned state', View.buildGodScene(g).primitives.some((p) => p.type === 'ship' && p.pos.x > 9000));
})();

/* ===================== AI: a straight-line runner is eventually killed (50 random directions) ===================== */
(() => {
  const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const rnd = mulberry32(0x1234abcd);
  const randDir = () => { let x, y, z, l; do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; l = x * x + y * y + z * z; } while (l < 1e-4 || l > 1); l = Math.sqrt(l); return V.of(x / l, y / l, z / l); };

  const RUNS = 50;
  let aiWins = 0, kills = 0, maxTurn = 0, worst = null;
  for (let run = 0; run < RUNS; run++) {
    // randomized (but seeded -> reproducible) start positions AND flee direction
    const g = new Engine({ rng: rnd }); const dir = randDir(); let guard = 0;
    while (g.phase !== 'gameover' && guard++ < 250) {
      g.submitPlan(0, { accel: V.scale(dir, CONFIG.maxAccel), weapon: 'none', shield: 0 }); // player flees straight, never fights
      g.submitPlan(1, LL.AI.decide('hunter', g.viewFor(1)));                                 // Hunter pursues
      g.resolve();
    }
    if (g.winner === 1) aiWins++;
    if (g.winner === 1 && g.endReason === 'destroyed') kills++;
    maxTurn = Math.max(maxTurn, g.turn);
    if (g.winner !== 1 && !worst) worst = { dir, winner: g.winner, reason: g.endReason, turns: g.turn };
  }
  t.ok(`AI beats a straight-line runner in all ${RUNS} random directions`, aiWins === RUNS, worst ? JSON.stringify(worst) : '');
  t.ok(`AI actually DESTROYS the runner in all ${RUNS} runs`, kills === RUNS, 'kills=' + kills + '/' + RUNS);
  t.ok('Hunter closes and kills promptly (well before the turn cap)', maxTurn <= 60, 'maxTurn=' + maxTurn);
})();

/* ===================== game log: complete, serializable record of a run ===================== */
(() => {
  const g = new Engine();
  g.ships[0].pos = V.of(0, 0, 0); g.ships[0].history = [{ t: 0, pos: V.of(0, 0, 0) }];
  g.ships[1].pos = V.of(10, 0, 0); g.ships[1].history = [{ t: 0, pos: V.of(10, 0, 0) }];
  g.submitPlan(0, { accel: V.of(1, 0, 0), weapon: 'laser', aim: V.of(10, 0, 0) });
  g.submitPlan(1, { accel: V.of(), weapon: 'none', shield: 3, shieldDir: V.of(0, 0, 0) });
  g.resolve(); g.idleTurn();
  const log = g.exportLog({ mode: 'ai', aiType: 'hunter' });
  t.ok('log has config + outcome + turns[]', !!log.config && !!log.outcome && Array.isArray(log.turns));
  t.ok('log turn count matches turns played', log.turns.length === g.turn);
  t.ok('log records both players\' orders per turn', log.turns[0].plans.length === 2 && log.turns[0].plans[0].weapon === 'laser');
  t.ok('log records end-of-turn state (pos/vel/hp)', log.turns[0].state.length === 2 && 'hp' in log.turns[0].state[0] && 'vel' in log.turns[0].state[0]);
  t.ok('log carries meta (mode/aiType)', log.meta.mode === 'ai' && log.meta.aiType === 'hunter');
  t.ok('log is JSON-serializable', typeof JSON.stringify(log) === 'string');
})();

process.exit(t.report() ? 0 : 1);
