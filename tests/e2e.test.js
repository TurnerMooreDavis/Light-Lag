/* End-to-end tests driving the real DOM/render/UI code under jsdom:
 * full hotseat duel, fairness (per-viewer log), fast-forward, and the gizmo. */
'use strict';
const { Runner, loadPage } = require('./harness');

(async function run() {
  const t = new Runner('e2e');
  const page = loadPage();
  const { window, doc, errors, flushRaf, useFakeTimers } = page;
  await new Promise((r) => setTimeout(r, 120)); // let jsdom fire DOMContentLoaded -> boot()

  const LL = window.LL;
  t.ok('LL namespace booted', !!(LL && LL.game && LL.UI && LL.renderer && LL.View));
  if (!LL || !LL.game) { t.report(); process.exit(1); }
  const { UI, game, V, CONFIG } = LL;
  t.ok('opens at the pass-device curtain', doc.getElementById('curtain').classList.contains('show'));
  t.ok('gizmo renderer hook exists', typeof LL.renderer._drawGizmo === 'function');

  const clickCurtain = () => doc.getElementById('curtainBtn').click();
  const towardDir = (p) => {
    const ob = game.observeEnemy(p), me = game.ship(p);
    const tgt = ob.visible ? V.add(ob.pos, V.scale(ob.vel, ob.age || 0)) : game.ships[1 - p].history[0].pos;
    const d = V.normalize(V.sub(tgt, me.pos));
    return V.len2(d) > 1e-6 ? d : V.of(1, 0, 0);
  };
  function planAndCommit(player, opts) {
    if (opts.weapon) UI.selectWeapon(opts.weapon);
    const wCost = opts.weapon && opts.weapon !== 'none' ? CONFIG.weapons[opts.weapon].cost : 0;
    const shield = opts.shield || 0;
    const moveUnits = Math.min(CONFIG.maxSpeed, Math.max(0, CONFIG.energyPerTurn - wCost - shield) / CONFIG.moveCost);
    UI.plan.move = V.scale(towardDir(player), moveUnits);
    if (wCost) UI.plan.aim = UI.firingSolutionAim() || UI.apparentAim();
    if (shield) { UI.plan.shield = shield; UI.faceShield('enemy'); }
    UI.onPlanChanged();
    flushRaf(2); // exercises render.js (incl. the gizmo) without throwing
    UI.commit();
  }

  // ---------- a full duel ----------
  let sawEnemyAtTurn = null, hits = 0, exception = null;
  try {
    for (let turn = 0; turn < 40 && game.phase !== 'gameover'; turn++) {
      clickCurtain();
      if (game.observeEnemy(0).visible && sawEnemyAtTurn === null) sawEnemyAtTurn = game.turn;
      planAndCommit(0, { weapon: 'laser', toward: true, shield: turn % 3 === 0 ? 4 : 0 });
      clickCurtain();
      planAndCommit(1, { weapon: turn % 2 ? 'torpedo' : 'laser', toward: true });
      if (game.lastReport) hits += game.lastReport.hits.length;
      flushRaf(3);
    }
  } catch (e) { exception = e; }
  t.ok('no exception across a full duel', !exception, exception && exception.stack);
  t.ok('first contact delayed by light-lag (8-10 turns)', sawEnemyAtTurn >= 8 && sawEnemyAtTurn <= 10, 'sawEnemyAtTurn=' + sawEnemyAtTurn);
  t.ok('at least one hit landed', hits > 0, 'hits=' + hits);
  t.ok('the duel reached a conclusion', game.phase === 'gameover');
  t.ok('a winner was decided', game.winner === 0 || game.winner === 1 || game.winner === 'draw');
  t.ok('engine kept a full per-turn report log', game.reports.length === game.turn);
  t.ok('every battle-log entry is tagged to a viewer', game.log.length > 0 && game.log.every((e) => e.to === 0 || e.to === 1));

  // ---------- game-over screen + post-game truth replay ----------
  const overBtns = Array.from(doc.getElementById('console').querySelectorAll('button')).map((b) => b.textContent);
  t.ok('game-over offers replay + new battle', overBtns.some((x) => /REPLAY/.test(x)) && overBtns.some((x) => /NEW BATTLE/.test(x)));
  let replayErr = null;
  try { UI.playReplay(); flushRaf(12); } catch (e) { replayErr = e; }
  t.ok('truth replay runs without error', !replayErr, replayErr && replayErr.stack);

  // ---------- new battle resets ----------
  Array.from(doc.getElementById('console').querySelectorAll('button')).find((b) => /NEW BATTLE/.test(b.textContent)).click();
  flushRaf(1);
  t.ok('new battle resets to turn 0 at the curtain', game.turn === 0 && game.phase === 'plan');

  // ---------- gizmo + no center axes ----------
  clickCurtain(); // into a fresh planning view
  let drawErr = null;
  try { LL.renderer.draw(); } catch (e) { drawErr = e; }
  t.ok('renderer.draw (with gizmo) runs without error', !drawErr, drawErr && drawErr.stack);
  t.ok('plan scene contains no world-axis primitive', !LL.View.buildPlanScene(game, 0, { move: V.of(), weapon: 'none' }, {}).primitives.some((p) => p.type === 'axes'));

  // ---------- GOD VIEW (debug: all objects, both players, truth) ----------
  const godCheckbox = (root) => Array.from(doc.querySelectorAll((root || '#console') + ' label'))
    .find((l) => /god view/i.test(l.textContent));
  const shipCount = () => LL.renderer.scene.filter((p) => p.type === 'ship').length;
  UI.refreshScene();
  t.ok('plan view hides the enemy early (light-lag)', shipCount() === 1);
  const gc = godCheckbox('#console');
  t.ok('console has a god-view toggle', !!gc);
  const gcb = gc.querySelector('input[type=checkbox]');
  gcb.checked = true; gcb.dispatchEvent(new window.Event('change'));
  t.ok('god view reveals BOTH ships at once (truth)', shipCount() === 2);
  t.ok('UI.godView flag set', UI.godView === true);
  gcb.checked = false; gcb.dispatchEvent(new window.Event('change'));
  t.ok('toggling god view off restores the delayed view', shipCount() === 1 && UI.godView === false);

  // ---------- FAST-FORWARD (1 turn/sec, both idle), driven by fake timers ----------
  t.ok('on a planning screen before fast-forward', game.phase === 'plan');
  const a0 = V.clone(game.ships[0].pos), b0 = V.clone(game.ships[1].pos);
  const startTurn = game.turn;
  const fake = useFakeTimers();
  let ffErr = null;
  try {
    UI.fastForward(5);                       // does the 1st idle turn immediately, schedules the rest
    t.ok('fast-forward shows a STOP control', Array.from(doc.getElementById('console').querySelectorAll('button')).some((b) => /STOP/.test(b.textContent)));
    // god view is usable WITH fast-forward (toggle it on from the FF panel)
    const ffGod = godCheckbox('#console');
    t.ok('fast-forward panel exposes the god-view toggle', !!ffGod);
    const ffGcb = ffGod.querySelector('input[type=checkbox]');
    ffGcb.checked = true; ffGcb.dispatchEvent(new window.Event('change'));
    t.ok('god view during fast-forward shows both ships', LL.renderer.scene.filter((p) => p.type === 'ship').length === 2);
    for (let i = 0; i < 8 && fake.pending(); i++) fake.fire(1); // advance the 1s ticks
    UI.godView = false;
  } catch (e) { ffErr = e; }
  t.ok('fast-forward runs without error', !ffErr, ffErr && ffErr.stack);
  t.ok('fast-forward advanced exactly 5 turns', game.turn === startTurn + 5, `turn ${startTurn} -> ${game.turn}`);
  t.ok('both ships stayed idle during fast-forward', V.eq(game.ships[0].pos, a0, 1e-9) && V.eq(game.ships[1].pos, b0, 1e-9));
  t.ok('fast-forward ended back at a planning hand-off', game.phase === 'plan' && doc.getElementById('curtain').classList.contains('show'));

  t.ok('no uncaught window errors during e2e', errors.length === 0, errors.join(' | '));
  process.exit(t.report() ? 0 : 1);
})();
