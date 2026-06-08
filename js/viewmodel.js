/* viewmodel.js — turn game state into renderer primitives for a given viewer.
 * This is where light-lag becomes visible: delayed ghost images, "T-N" age
 * badges, uncertainty bubbles, and torpedo extrapolation.
 * Attached to LL.View. */
(function () {
  'use strict';
  const V = window.LL.V;
  const CFG = window.LL.CONFIG;
  const COL = window.LL.PLAYER_COLORS;

  let STARS = null;
  function stars() {
    if (STARS) return STARS;
    STARS = [];
    const R = CFG.arenaRadius0 * 3.2;
    for (let i = 0; i < 320; i++) {
      // deterministic-ish scatter on a big shell
      const a = i * 2.39996, b = (i * 0.7211) % (Math.PI);
      const r = R * (0.7 + 0.3 * ((i * 53 % 97) / 97));
      STARS.push(V.of(r * Math.cos(a) * Math.sin(b), r * Math.cos(b) * 0.6, r * Math.sin(a) * Math.sin(b)));
    }
    return STARS;
  }

  function backdrop(radius, overtime) {
    const R = radius || CFG.arenaRadius0;
    // No world-space axis lines through the centre — orientation is shown by the
    // corner gizmo (render.js _drawGizmo) instead.
    return [
      { type: 'starfield', stars: stars() },
      { type: 'grid', radius: R, step: 25, color: '#102236' },
      { type: 'sphere', center: V.of(), radius: R, color: overtime ? '#3a2030' : '#13283d', rings: 6, seg: 40 },
    ];
  }

  /* Planning view for `viewer`, reflecting an in-progress `plan`. */
  function buildPlanScene(game, viewer, plan, opts) {
    opts = opts || {};
    const me = game.ships[viewer];
    const myCol = COL[viewer], enCol = COL[1 - viewer];
    const prim = backdrop(game.arenaRadius(), game.inOvertime());

    // --- own ship (known exactly) ---
    prim.push({ type: 'ship', pos: me.pos, color: myCol, size: 10, dropLine: true });
    prim.push({ type: 'label', pos: me.pos, text: `YOU · HP ${me.hp.toFixed(0)}`, color: myCol, dy: -16, bg: '#04070d' });

    // --- momentum + planned thrust (inertia) ---
    // current velocity carries the ship forward; this turn's thrust bends it.
    const accel = V.clampLen(plan.accel || V.of(), CFG.maxAccel);
    const nextVel = V.clampLen(V.add(me.vel, accel), CFG.maxSpeed);
    const dest = V.add(me.pos, nextVel);                 // where the ship will actually be next turn
    if (V.len(me.vel) > 1e-3) {                           // faint arrow = current momentum (coast)
      prim.push({ type: 'arrow', a: me.pos, b: V.add(me.pos, me.vel), color: myCol, width: 1, dash: [2, 3] });
    }
    if (V.dist(dest, me.pos) > 1e-3) {                    // solid arrow = resulting heading after thrust
      prim.push({ type: 'arrow', a: me.pos, b: dest, color: myCol, width: 1.5 });
      prim.push({ type: 'ship', pos: dest, color: myCol, size: 9, ghost: true, dash: [3, 3], dropLine: true });
    }
    const muzzle = dest;                                  // a fired weapon spawns at the post-move position

    // --- own weapon plan ---
    if (plan.weapon && plan.weapon !== 'none' && plan.aim) {
      const w = CFG.weapons[plan.weapon];
      prim.push({ type: 'line', a: muzzle, b: plan.aim, color: myCol, width: 1, dash: [5, 4] });
      // extend the shot's straight path beyond the aim point (range preview)
      const dir = V.normalize(V.sub(plan.aim, muzzle));
      if (V.len2(dir) > 1e-6) {
        const end = V.add(muzzle, V.scale(dir, w.speed * w.life));
        prim.push({ type: 'line', a: plan.aim, b: end, color: myCol, width: 0.5, dash: [2, 8] });
      }
      prim.push({ type: 'point', pos: plan.aim, color: myCol, r: 4, fill: false, ring: true, ringW: 1.5, dash: [3, 3] });
      prim.push({ type: 'label', pos: plan.aim, text: `${w.name} aim`, color: myCol, dy: -10 });
    }

    // --- firing solution aid ---
    if (opts.showSolution && plan.weapon && plan.weapon !== 'none') {
      const sol = game.firingSolution(viewer, plan.weapon);
      if (sol.ok) {
        prim.push({ type: 'point', pos: sol.estNow, color: enCol, r: 3, fill: false, ring: true, dash: [2, 2], alpha: 0.6 });
        prim.push({ type: 'label', pos: sol.estNow, text: 'est. now', color: enCol, dy: -8, alpha: 0.7 });
        prim.push({ type: 'line', a: muzzle, b: sol.aim, color: '#ffd34e', width: 1, dash: [4, 3] });
        prim.push({ type: 'point', pos: sol.aim, color: '#ffd34e', r: 5, fill: false, ring: true, ringW: 2 });
        prim.push({ type: 'label', pos: sol.aim, text: 'SOLUTION (if they hold course)', color: '#ffd34e', dy: 14 });
      }
    }

    // --- enemy: light-delayed image ---
    const ob = game.observeEnemy(viewer);
    if (ob.visible) {
      prim.push({ type: 'ship', pos: ob.pos, color: enCol, size: 9, ghost: true, dash: [2, 4], dropLine: true });
      prim.push({ type: 'label', pos: ob.pos, text: `ENEMY · light T−${ob.age.toFixed(1)}`, color: enCol, dy: -16, bg: '#04070d' });
      if (V.len(ob.vel) > 1e-3) {
        prim.push({ type: 'arrow', a: ob.pos, b: V.add(ob.pos, V.scale(ob.vel, 4)), color: enCol, width: 1, dash: [2, 2] });
      }
      // uncertainty bubble: where they COULD be now, given max speed over the image age
      const unc = CFG.maxSpeed * ob.age;
      prim.push({ type: 'bubble', pos: ob.pos, worldRadius: unc, color: enCol, alpha: 0.35, dash: [3, 6] });
      prim.push({ type: 'label', pos: V.add(ob.pos, V.of(0, unc, 0)), text: `could be anywhere within ${unc.toFixed(0)}u`, color: enCol, dy: -2, alpha: 0.5 });
    } else {
      // no live signal yet — show pre-battle intel (start position), fading
      const intel = game.ships[1 - viewer].history[0].pos;
      prim.push({ type: 'point', pos: intel, color: enCol, r: 4, fill: false, ring: true, dash: [2, 2], alpha: 0.4 });
      const eta = ob.arrivesAt != null ? Math.ceil(ob.arrivesAt) : '?';
      prim.push({ type: 'label', pos: intel, text: `NO SIGNAL · last intel T0 · first light ≈ turn ${eta}`, color: enCol, dy: -10, alpha: 0.6 });
    }

    // --- projectiles: own true, enemy delayed (with extrapolation) ---
    for (const pv of game.observeProjectiles(viewer)) {
      const pr = pv.proj;
      if (pv.own) {
        prim.push({ type: 'point', pos: pv.pos, color: myCol, r: 3 });
        const ud = V.normalize(pv.vel);
        if (V.len2(ud) > 1e-9) prim.push({ type: 'arrow', a: pv.pos, b: V.add(pv.pos, V.scale(ud, 6)), color: myCol, width: 0.8 });
        prim.push({ type: 'label', pos: pv.pos, text: pr.type[0].toUpperCase(), color: myCol, dy: -6, alpha: 0.7 });
      } else {
        // delayed image of an incoming shot
        prim.push({ type: 'point', pos: pv.pos, color: enCol, r: 3, fill: false, ring: true, dash: [2, 2], alpha: 0.7 });
        // torpedoes fly straight => extrapolate their TRUE current position
        const predNow = V.add(pv.pos, V.scale(pv.vel, pv.age || 0));
        prim.push({ type: 'line', a: pv.pos, b: predNow, color: enCol, width: 0.8, dash: [2, 3] });
        prim.push({ type: 'point', pos: predNow, color: enCol, r: 4, ring: true, ringW: 2, fill: false });
        prim.push({ type: 'label', pos: predNow, text: `INCOMING ${pr.type} (pred. now)`, color: enCol, dy: -8 });
      }
    }

    // Camera centers ONLY on info the viewer legitimately has (own ship + the
    // enemy's *apparent* image / pre-battle intel) — never the enemy's true pos,
    // which would leak their hidden location through camera framing.
    const known = ob.visible ? ob.pos : game.ships[1 - viewer].history[0].pos;
    const target = V.scale(V.add(me.pos, known), 0.5);
    return { primitives: prim, target };
  }

  function histAt(hist, t) {
    // true position from a history at fractional turn t (clamped to range)
    let a = hist[0], b = hist[hist.length - 1];
    for (let i = 0; i < hist.length - 1; i++) {
      if (hist[i].t <= t && hist[i + 1].t >= t) { a = hist[i]; b = hist[i + 1]; break; }
    }
    const span = (b.t - a.t) || 1;
    return V.lerp(a.pos, b.pos, Math.max(0, Math.min(1, (t - a.t) / span)));
  }

  /* Post-game TRUTH replay over the whole battle. gtime is a continuous turn
   * index in [0, game.turn]; this is only ever shown once the match is decided,
   * so revealing true positions here does not break the light-delay contract. */
  function buildReplayScene(game, gtime) {
    const prim = backdrop(CFG.arenaRadius0, false);
    const tick = Math.max(0, Math.min(Math.floor(gtime), game.turn - 1));
    const localA = gtime - Math.floor(gtime);

    // both ships' full trajectories (the "dance"), drawn up to gtime
    game.ships.forEach((s, i) => {
      for (let k = 0; k < s.history.length - 1 && s.history[k + 1].t <= gtime + 1e-9; k++) {
        prim.push({ type: 'line', a: s.history[k].pos, b: s.history[k + 1].pos, color: COL[i], width: 0.6, dash: [2, 4] });
      }
      const p = histAt(s.history, gtime);
      prim.push({ type: 'ship', pos: p, color: COL[i], size: 10, dropLine: true, ghost: !s.alive });
      prim.push({ type: 'label', pos: p, text: `P${i + 1}`, color: COL[i], dy: -16, bg: '#04070d' });
    });

    // projectile segments and hit bursts for the tick currently playing
    const rep = game.reports[tick];
    if (rep) {
      for (const seg of rep.segments) {
        const p = V.lerp(seg.p0, seg.p1, localA);
        prim.push({ type: 'point', pos: p, color: COL[seg.owner], r: 3 });
        prim.push({ type: 'line', a: seg.p0, b: p, color: COL[seg.owner], width: 0.6, dash: [1, 4] });
      }
      if (localA > 0.5) {
        for (const h of rep.hits) {
          const tt = (localA - 0.5) / 0.5;
          const fullyBlocked = h.damage === 0 && h.blocked > 0;
          prim.push({ type: 'burst', pos: h.point, worldRadius: fullyBlocked ? 6 : 10, color: fullyBlocked ? '#5cff9d' : '#ff4d6d', t: tt });
        }
      }
    }
    const mid = V.scale(V.add(histAt(game.ships[0].history, gtime), histAt(game.ships[1].history, gtime)), 0.5);
    return { primitives: prim, target: mid };
  }

  function midTarget(game) {
    return V.scale(V.add(game.ships[0].pos, game.ships[1].pos), 0.5);
  }

  /* DEBUG god view — every in-game object from BOTH players at its TRUE current
   * position (no light delay). Deliberately omniscient; for debugging only. */
  function buildGodScene(game) {
    const prim = backdrop(game.arenaRadius(), game.inOvertime());
    game.ships.forEach((s, i) => {
      prim.push({ type: 'ship', pos: s.pos, color: COL[i], size: 10, dropLine: true, ghost: !s.alive });
      if (V.len(s.vel) > 1e-3) prim.push({ type: 'arrow', a: s.pos, b: V.add(s.pos, s.vel), color: COL[i], width: 1.2 });
      prim.push({ type: 'label', pos: s.pos, text: `P${i + 1} · HP ${s.hp.toFixed(0)} · v ${V.len(s.vel).toFixed(1)}`, color: COL[i], dy: -16, bg: '#04070d' });
    });
    let live = 0;
    for (const pr of game.projectiles) {
      if (!pr.alive) continue;
      live++;
      const col = COL[pr.owner];
      prim.push({ type: 'point', pos: pr.pos, color: col, r: 3 });
      prim.push({ type: 'line', a: pr.pos, b: V.of(pr.pos.x, 0, pr.pos.z), color: col, width: 0.4, dash: [2, 4] });
      const ud = V.normalize(pr.vel);
      if (V.len2(ud) > 1e-9) prim.push({ type: 'arrow', a: pr.pos, b: V.add(pr.pos, V.scale(ud, 6)), color: col, width: 0.8 });
      prim.push({ type: 'label', pos: pr.pos, text: `P${pr.owner + 1} ${pr.type}`, color: col, dy: -8, alpha: 0.85 });
    }
    prim.push({ type: 'label', pos: midTarget(game), text: `GOD VIEW · ${live} projectile${live === 1 ? '' : 's'} in flight`, color: '#ffd34e', dy: 0, alpha: 0.6 });
    return { primitives: prim, target: midTarget(game) };
  }

  window.LL.View = { backdrop, buildPlanScene, buildReplayScene, buildGodScene, midTarget, stars };
})();
