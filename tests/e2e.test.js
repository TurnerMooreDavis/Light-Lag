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
  t.ok('opens at the start menu', doc.getElementById('menu').classList.contains('show'));
  t.ok('gizmo renderer hook exists', typeof LL.renderer._drawGizmo === 'function');
  t.ok('menu lists a computer opponent', Array.from(doc.querySelectorAll('#menuButtons button')).some((b) => /VS .* \(AI\)/.test(b.textContent)));

  const clickCurtain = () => doc.getElementById('curtainBtn').click();
  const startMode = (re) => { Array.from(doc.querySelectorAll('#menuButtons button')).find((b) => re.test(b.textContent)).click(); };
  startMode(/2 PLAYERS/);
  t.ok('choosing 2 players opens the pass-device curtain', doc.getElementById('curtain').classList.contains('show'));
  // pin deterministic symmetric starts for the scripted duel (starts are otherwise randomized)
  game.reset({ starts: [V.of(-50, 0, 0), V.of(50, 0, 0)] });
  const towardDir = (p) => {
    const ob = game.observeEnemy(p), me = game.ship(p);
    // blind => steer toward the arena centre (no enemy position is known)
    const tgt = ob.visible ? V.add(ob.pos, V.scale(ob.vel, ob.age || 0)) : V.of();
    const d = V.normalize(V.sub(tgt, me.pos));
    return V.len2(d) > 1e-6 ? d : V.of(1, 0, 0);
  };
  function planAndCommit(player, opts) {
    if (opts.weapon) UI.selectWeapon(opts.weapon);
    const wCost = opts.weapon && opts.weapon !== 'none' ? CONFIG.weapons[opts.weapon].cost : 0;
    const shield = opts.shield || 0;
    const thrust = Math.min(CONFIG.maxAccel, Math.max(0, CONFIG.energyPerTurn - wCost - shield) / CONFIG.accelCost);
    UI.plan.accel = V.scale(towardDir(player), thrust);
    if (wCost) UI.plan.aim = UI.firingSolutionAim() || UI.apparentAim();
    if (shield) { UI.plan.shield = shield; UI.faceShield('enemy'); }
    UI.onPlanChanged();
    flushRaf(2); // exercises render.js (incl. the gizmo) without throwing
    UI.commit();
  }

  // ---------- a full duel ----------
  const openingBlind = !game.observeEnemy(0).visible; // turn 0, 100u apart => no light yet
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
  // light-lag invariant: you are blind at the opening, and contact (if any) is never
  // instantaneous. With inertia, aggressive closing can even end the duel before light
  // arrives (sawEnemyAtTurn === null) — the deterministic turn-10 case is unit-tested.
  t.ok('enemy hidden by light-lag at the opening', openingBlind);
  t.ok('contact never beats the light front', sawEnemyAtTurn === null || sawEnemyAtTurn >= 8, 'sawEnemyAtTurn=' + sawEnemyAtTurn);
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
  t.ok('new battle returns to the start menu', doc.getElementById('menu').classList.contains('show'));
  startMode(/2 PLAYERS/); // fresh hotseat game for the god-mode / gizmo checks below
  t.ok('fresh game resets to turn 0 at the curtain', game.turn === 0 && game.phase === 'plan');

  // ---------- GOD MODE entry (only from the start-of-turn curtain) ----------
  const shipCount = () => LL.renderer.scene.filter((p) => p.type === 'ship').length;
  const consoleText = () => doc.getElementById('console').textContent;
  const curtainGod = doc.getElementById('curtainGodBtn');
  t.ok('curtain has a god-mode button', !!curtainGod);
  t.ok('god-mode button shown at the start-of-turn (player-1) curtain', curtainGod.style.display !== 'none');

  curtainGod.click(); // enter god mode instead of starting player 1's turn
  t.ok('god mode is active', UI._godMode === true);
  t.ok('curtain dismissed on entering god mode', !doc.getElementById('curtain').classList.contains('show'));
  t.ok('god mode reveals BOTH ships at true positions', shipCount() === 2);
  t.ok('god-mode console has the fast-forward tool', /FAST-FORWARD/.test(consoleText()));
  t.ok('god-mode console has an exit button', /EXIT GOD MODE/i.test(consoleText()));
  t.ok('god-mode console has NO planning controls', !/(LOCK IN ORDERS|Weapons|Shields|Maneuver)/.test(consoleText()));
  let drawErr = null; try { LL.renderer.draw(); } catch (e) { drawErr = e; }
  t.ok('renderer.draw (with gizmo) runs in god mode', !drawErr, drawErr && drawErr.stack);

  // ---------- FAST-FORWARD inside god mode: each turn's resolution is ANIMATED (rAF) ----------
  const a0 = V.clone(game.ships[0].pos), b0 = V.clone(game.ships[1].pos), startTurn = game.turn;
  const ffNum = doc.querySelector('#console input[type=number]');
  const ffBtn = Array.from(doc.querySelectorAll('#console button')).find((b) => /FAST-FORWARD/.test(b.textContent));
  ffNum.value = '5';
  let ffErr = null;
  try {
    ffBtn.click(); // resolves the 1st turn and starts its animation
    t.ok('fast-forward shows a STOP control', Array.from(doc.querySelectorAll('#console button')).some((b) => /STOP/.test(b.textContent)));
    t.ok('first turn resolved immediately', game.turn === startTurn + 1);
    flushRaf(2); // partway through the 1st tick's animation
    t.ok('mid-animation still shows both ships (god view, truth)', shipCount() === 2);
    flushRaf(120); // drive the rAF animation chain through all 5 turns
  } catch (e) { ffErr = e; }
  t.ok('fast-forward runs without error', !ffErr, ffErr && ffErr.stack);
  t.ok('fast-forward advanced exactly 5 turns', game.turn === startTurn + 5, `turn ${startTurn} -> ${game.turn}`);
  t.ok('both ships stayed idle during fast-forward', V.eq(game.ships[0].pos, a0, 1e-9) && V.eq(game.ships[1].pos, b0, 1e-9));
  t.ok('still in god mode after fast-forward', UI._godMode === true);
  t.ok('god-mode panel restored after fast-forward', /FAST-FORWARD/.test(consoleText()) && /EXIT GOD MODE/i.test(consoleText()));

  // ---------- exit god mode -> back to the start-of-turn curtain ----------
  Array.from(doc.querySelectorAll('#console button')).find((b) => /EXIT GOD MODE/i.test(b.textContent)).click();
  t.ok('exiting god mode returns to the curtain', UI._godMode === false && doc.getElementById('curtain').classList.contains('show'));

  // ---------- planning console no longer carries debug/FF; gizmo still draws ----------
  clickCurtain(); // start player 1's turn
  t.ok('planning console has no fast-forward/debug controls', !/FAST-FORWARD/.test(consoleText()));
  t.ok('plan scene has no world-axis primitive', !LL.View.buildPlanScene(game, 0, { accel: V.of(), weapon: 'none' }, {}).primitives.some((p) => p.type === 'axes'));
  let drawErr2 = null; try { LL.renderer.draw(); } catch (e) { drawErr2 = e; }
  t.ok('renderer.draw (with gizmo) runs in planning', !drawErr2, drawErr2 && drawErr2.stack);

  // ---------- god-mode button is hidden at the player-2 hand-off (a plan is pending) ----------
  planAndCommit(0, { weapon: 'none' }); // commit player 1 -> passTo(1)
  t.ok('god-mode button hidden at the player-2 curtain', doc.getElementById('curtainGodBtn').style.display === 'none');

  // ---------- VS COMPUTER: the AI is a player that auto-plans from its own delayed view ----------
  UI.showMenu();
  startMode(/VS HUNTER/);
  t.ok('vs-computer mode engaged', UI.mode === 'ai');
  t.ok('vs-ai opens straight to the human turn (no player-2 hand-off)', doc.getElementById('curtain').classList.contains('show'));
  let aiErr = null, humanTurns = 0, perTurnLogOk = true;
  try {
    for (let i = 0; i < 100 && game.phase !== 'gameover'; i++) {
      clickCurtain();                                  // human readies — there is no second curtain
      planAndCommit(0, { weapon: 'laser', toward: true }); // commit triggers AI plan + resolve
      humanTurns++;
      // the log is refreshed every round, not just at game over
      if (!(window.LL.lastGameLog && window.LL.lastGameLog.turns.length === game.turn)) perTurnLogOk = false;
    }
  } catch (e) { aiErr = e; }
  t.ok('the game log is updated every round (not only at game over)', perTurnLogOk);
  t.ok('vs-ai duel runs without exceptions', !aiErr, aiErr && aiErr.stack);
  t.ok('one human commit resolves exactly one turn (AI auto-plays)', game.turn === humanTurns);
  t.ok('vs-ai reached a conclusion', game.phase === 'gameover');
  t.ok('the AI engaged — damage was dealt', game.ships[0].hp < CONFIG.startHP || game.ships[1].hp < CONFIG.startHP);

  // ---------- game log: captured for inspection / sharing ----------
  t.ok('game-over offers a download-log button', Array.from(doc.querySelectorAll('#console button')).some((b) => /DOWNLOAD GAME LOG/i.test(b.textContent)));
  t.ok('full game log stashed on window after the match', !!(window.LL.lastGameLog && Array.isArray(window.LL.lastGameLog.turns) && window.LL.lastGameLog.turns.length === game.turn));
  t.ok('game log records the outcome', !!window.LL.lastGameLog.outcome && window.LL.lastGameLog.outcome.winner === game.winner);
  t.ok('game log records each turn\'s orders + state', window.LL.lastGameLog.turns[0].plans.length === 2 && window.LL.lastGameLog.turns[0].state.length === 2);
  let dlErr = null; try { UI.downloadGameLog(); } catch (e) { dlErr = e; }
  t.ok('downloadGameLog runs without throwing', !dlErr, dlErr && dlErr.stack);

  // ---------- god-mode fast-forward: the AI keeps acting (toggle); the player coasts ----------
  UI.showMenu();
  startMode(/VS HUNTER/);
  doc.getElementById('curtainGodBtn').click(); // enter god mode at turn 0
  const aiToggle = () => Array.from(doc.querySelectorAll('#console label')).find((l) => /AI keeps acting/i.test(l.textContent));
  t.ok('vs-ai god panel offers an "AI keeps acting" toggle', !!aiToggle());
  t.ok('the toggle defaults to ON', UI._ffAiActs === true);
  const runFF = (n) => { doc.querySelector('#console input[type=number]').value = String(n); Array.from(doc.querySelectorAll('#console button')).find((b) => /FAST-FORWARD/.test(b.textContent)).click(); flushRaf(160); };
  // pin deterministic starts: human at origin coasting +y, AI off to +x so its
  // pursuit (toward the centre / the human's image) is a clear -x move.
  game.ships[0].pos = V.of(0, 0, 0); game.ships[0].history = [{ t: 0, pos: V.of(0, 0, 0) }]; game.ships[0].vel = V.of(0, 2, 0);
  game.ships[1].pos = V.of(80, 0, 0); game.ships[1].history = [{ t: 0, pos: V.of(80, 0, 0) }]; game.ships[1].vel = V.of();
  const aiStart = V.clone(game.ships[1].pos), humanStartY = game.ships[0].pos.y;
  runFF(6);
  t.ok('fast-forward advanced 6 turns', game.turn === 6);
  t.ok('with the toggle ON the AI keeps maneuvering (pursues)', game.ships[1].pos.x < aiStart.x - 1);
  t.ok('the player just coasts on momentum during fast-forward', V.eq(game.ships[0].vel, V.of(0, 2, 0), 1e-9) && game.ships[0].pos.y > humanStartY + 1);
  // turn the AI off and fast-forward again: the AI must stop thrusting (coast only)
  const tcb = aiToggle().querySelector('input[type=checkbox]'); tcb.checked = false; tcb.dispatchEvent(new window.Event('change'));
  t.ok('toggle OFF recorded', UI._ffAiActs === false);
  const aiVelFrozen = V.clone(game.ships[1].vel);
  runFF(4);
  t.ok('with the toggle OFF the AI no longer thrusts (velocity unchanged)', V.eq(game.ships[1].vel, aiVelFrozen, 1e-9));

  t.ok('no uncaught window errors during e2e', errors.length === 0, errors.join(' | '));
  process.exit(t.report() ? 0 : 1);
})();
