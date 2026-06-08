/* ai.js — computer opponents.
 *
 * An AI is just another player: it produces a plan {accel, weapon, aim, shield,
 * shieldDir} — the SAME commands a human issues — from the SAME sanctioned,
 * light-delayed view (game.viewFor(player)). It never sees the enemy's true
 * position, so it plays by exactly the same rules.
 *
 * Add a new personality with register(key, name, desc, decide). It will appear
 * in the menu automatically and flow through the identical turn machinery. */
(function () {
  'use strict';
  const V = window.LL.V, CFG = window.LL.CONFIG, Phys = window.LL.Phys;

  const strategies = [];
  const byKey = {};
  function register(key, name, description, decide) {
    const s = { key, name, description, decide };
    strategies.push(s); byKey[key] = s;
  }

  /* ---- shared helpers — all operate ONLY on the sanctioned view ---- */
  // where we believe the enemy is: the visible (delayed) image, or pre-battle intel
  const targetPoint = (view) => (view.enemy.visible ? view.enemy.pos : view.enemyIntel);
  const unitToward = (from, to) => {
    const d = V.sub(to, from), l = V.len(d);
    return l > 1e-6 ? V.scale(d, 1 / l) : V.of(1, 0, 0);
  };
  // an accel vector along `dir`, capped by max thrust AND the energy left for it
  const thrust = (dir, energyLeft) =>
    V.scale(dir, Math.min(CFG.maxAccel, Math.max(0, energyLeft) / CFG.accelCost));
  // a lead solution computed from the delayed image (same tool a human's button uses)
  const firingSolution = (view, weaponKey) =>
    Phys.interceptEstimate(view.me.pos, view.enemy, CFG.weapons[weaponKey].speed);
  const incomingShot = (view) => view.projectiles.find((p) => !p.own) || null;

  /* ---- HUNTER — super basic: close in, fire on sight, shield when shot at ---- */
  register('hunter', 'Hunter',
    'Closes the distance, fires on sight, raises shields when shot at.',
    function (view) {
      const plan = { accel: V.of(), weapon: 'none', aim: null, shield: 0, shieldDir: null };
      let energy = CFG.energyPerTurn;

      // DEFEND: a seen torpedo flies straight, so shield toward its extrapolated path
      const inc = incomingShot(view);
      if (inc) {
        plan.shield = 4;
        plan.shieldDir = V.add(inc.pos, V.scale(inc.vel, inc.age || 0));
        energy -= 4;
      }

      // ATTACK: lead the visible image with a laser, or a torpedo if a laser won't fit
      if (view.enemy.visible) {
        const lsol = firingSolution(view, 'laser');
        if (lsol.ok && energy >= CFG.weapons.laser.cost) {
          plan.weapon = 'laser'; plan.aim = lsol.aim; energy -= CFG.weapons.laser.cost;
        } else {
          const tsol = firingSolution(view, 'torpedo');
          if (tsol.ok && energy >= CFG.weapons.torpedo.cost) {
            plan.weapon = 'torpedo'; plan.aim = tsol.aim; energy -= CFG.weapons.torpedo.cost;
          }
        }
      }

      // MOVE: spend whatever energy is left closing on the target
      plan.accel = thrust(unitToward(view.me.pos, targetPoint(view)), energy);
      return plan;
    });

  window.LL.AI = {
    register,
    list: () => strategies.map((s) => ({ key: s.key, name: s.name, description: s.description })),
    get: (key) => byKey[key] || strategies[0],
    decide: (key, view) => (byKey[key] || strategies[0]).decide(view),
  };
})();
