# LIGHT LAG

A two-player, browser-based tactical space duel where **the speed of light is the
weapon**. You never see your opponent's ship — you see the *light that left it in
the past*. To land a hit you must fire not where they *appear*, but where they
*will be* when your shot arrives.

No build step, no dependencies. **Just open `index.html` in any modern browser.**

---

## The idea

The board is a 3D grid. Light travels **10 units per turn** (`c = 10`). The two
ships spawn at **randomized positions, at least 100 units apart**, so light takes
**10+ turns** to cross the gap — and where the enemy starts is *secret*.

That means:

- For the first **~10 turns you are completely blind** — your opponent's light
  hasn't reached you yet, and there is **no pre-battle intel**: you have *no idea*
  where they are (not even a bearing or a range). All you can do is search.
- Once their light finally arrives you see a **10-turn-old image** of a stationary
  enemy. If they move, the image lags even more, and the *image* itself shows where
  they *were*, not where they *are*.
- A ship can be anywhere inside an **uncertainty bubble** (radius = their top
  speed × the image's age) around where you see them. The game draws this bubble.

### Two weapons, one beautiful asymmetry

| | **Laser** | **Torpedo** |
|---|---|---|
| Speed | `10` (= c) | `6` (< c) |
| In flight | **invisible** — its light arrives *with* the beam, so it can't be seen or dodged | **visible** — its light outruns it, so the target sees it coming (late) and can extrapolate its true path |
| Trade-off | undodgeable, but demands a *perfect* lead | dodgeable + splash, but demands an even *bigger* lead |

This isn't scripted — it falls straight out of the physics. A weapon that travels
at light speed cannot be seen before it hits, because there's no faster signal to
warn you.

### Leading the target

To hit, you lead by **(how old your image is) + (how long your shot takes to
arrive)**. The console computes a **firing solution** for you — but it can only
*assume the enemy holds course*. If they maneuver, it misses. That gap between
prediction and reality is the entire game.

---

## Modes

The start menu offers **2 Players (hotseat)** or **Vs Computer**. A computer
opponent is just another player: it issues the **same commands** from the **same
light-delayed view** (`game.viewFor(player)`) — it never sees your true position,
so it plays by the exact same rules. AI personalities live in `js/ai.js` behind a
small registry (`LL.AI.register(key, name, desc, decide)`); each appears in the
menu automatically. The first one, **Hunter**, is deliberately basic — charge in
at full thrust (it holds fire until in range so closing isn't slowed, and *seek*-
steers to correct momentum rather than overshoot), fire once in range, shield
when shot at — and is the template for future types
(timid/runner, sniper, etc.). A regression test runs Hunter against a player
fleeing in 50 random straight-line directions and asserts it kills them every
time (it wins because a straight-line runner gets pinned against the wall and
the overtime arena closes in — at equal top speed it can't be out-run forever).

## Running it

The game needs no server — just open `index.html`. But to have every finished
game **written to `./logs/` automatically**, serve it with the bundled Node dev
server (no dependencies):

```
npm start            # http://localhost:3000, logs -> ./logs/
PORT=8080 npm start
```

After **every round** (and every fast-forwarded turn) the client POSTs the
running log to `/api/log`; the server saves **one file per game**
(`logs/game-<id>.json`), overwritten as it grows — so in-progress and
fast-forwarded games are captured, not just finished ones. (Opened from
`file://` or a plain static server, the download button + console are the
fallback.)

## Game logs

Every match records a complete, JSON-serializable log via `game.exportLog()`
(callable anytime; also stashed at `window.LL.lastGameLog` and `console.log`ged
on game over, with a **Download Game Log** button). Each has the config, both
ships' start, the outcome, and per turn: both players' orders
(`accel`/`weapon`/`aim`/`shield`), the end-of-turn truth `state`
(`pos`/`vel`/`hp`), plus `spawns`/`hits`/`destroyed`.

## How to play (hotseat)

Both players plan **simultaneously and in secret**, then the turn resolves together.

1. **Pass-the-device curtain** — hand the screen to the named player; the other
   must not watch.
2. **Plan** on the Tactical Console (right panel):
   - **Thrust** — ships have **inertia**. The ax/ay/az inputs are *acceleration*
     (Δv, capped per turn) applied to a persistent velocity, up to a terminal
     speed. **Coasting at constant velocity is free**; only thrust costs energy —
     so a straight-line coaster is cheap but perfectly predictable (easy to lead),
     while dodging costs energy *and* takes turns (you can't stop or reverse on a
     dime). `COAST` (no thrust) / `BRAKE` (kill momentum) / `TOWARD` / `AWAY` helpers
     — `TOWARD`/`AWAY` steer relative to the enemy's image, so they're **disabled
     while you have no signal** (there's nothing to steer toward yet); set thrust
     manually or `COAST`/`BRAKE` until first light.
   - **Weapons** — `LASER`, `TORPEDO`, or `HOLD FIRE`. Pick an aim point
     numerically (the depth axis is a number, not an ambiguous click), or hit
     **◎ FIRING SOLUTION** to auto-lead the target, then nudge with `−`/`+`.
   - **Shields** — allocate strength and face the cone toward an expected threat
     (`FACE ENEMY` / `FACE INCOMING`). A 60° arc — guess the bearing right or it
     does nothing.
   - **Power Budget** — every turn gives `12⚡`. You can't sprint *and* fire the
     laser *and* shield; firing the big laser forces you to slow down (and a slow
     ship is a predictable, leadable ship).
   - **LOCK IN ORDERS** when your plan is within budget.
3. Repeat for Player 2, then watch the **truth replay** — the real positions, who
   shot what, and any hits — before the next turn.

**Camera:** drag to orbit, scroll to zoom, and use the `ISO / TOP / FRONT / SIDE`
buttons to read 3D depth cleanly. A small **orientation sphere** in the top-right
corner (under those buttons) shows which way X/Y/Z currently point. Every object
also drops a shadow line to the floor plane to anchor it in space.

**God mode (debug):** from the start-of-turn curtain, *Enter God Mode* shows an
omniscient view — every object from both players at its true position (it's the
one place light-delay is bypassed, on purpose). Its **fast-forward** advances
*N* turns at one turn per second and **animates each turn's resolution** — ships
glide, projectiles fly their paths, and hits burst. Human players always **coast**
through fast-forward (no input mid-FF); in *Vs Computer* a toggle keeps the **AI
acting** during fast-forward (default) or freezes it. Handy for watching the AI
hunt, seeing first light arrive at turn 10, or stepping through behaviour.

**Winning:** destroy the enemy ship (100 HP). If nobody dies by turn 40, the arena
begins to **shrink** — forcing the ships together until the light-lag is small
enough that hits become reliable. Ties break on HP, then total damage dealt.

---

## What you see on your console

- **Your ship** — known exactly (cyan for P1, amber for P2).
- **Enemy** — only ever the light-delayed image, tagged `light T−N`, wrapped in
  its uncertainty bubble. Before first contact there is **no enemy marker at all**,
  just `NO SIGNAL · enemy location unknown` — their start is randomized and secret,
  so nothing on screen hints at where they are or how far off.
- **Firing solution** — the yellow lead point, *if they hold course*.
- **Your own shots** — tracked live (you have telemetry on your own ordnance).
- **Incoming torpedoes** — shown as a delayed image plus an extrapolated
  "predicted now" marker (they fly straight, so you can project them). Incoming
  lasers are never drawn — you can't see them coming.

---

## Code layout

Plain ES5-ish vanilla JS, classic `<script>` tags, one global `LL` namespace —
runs straight from `file://`.

| File | Role |
|---|---|
| `js/vec3.js` | 3D vector math + closest-point-of-approach |
| `js/camera.js` | orbit camera + perspective projection, axis-snap presets |
| `js/physics.js` | **the core** — retarded-time `observe()`, intercept estimate, swept collision |
| `js/engine.js` | game state, turn resolution, energy, shields, overtime, win conditions |
| `js/viewmodel.js` | turns game state into drawable primitives (where light-lag becomes visible) |
| `js/render.js` | generic 3D→2D canvas renderer (depth-sorted painter's algorithm) |
| `js/ai.js` | computer opponents — strategy registry; each plans from the sanctioned view |
| `js/ui.js` | tactical console, planning input, mode menu, hotseat/vs-AI phase machine |
| `js/main.js` | bootstrap |

## Tests

```
npm install   # dev-only: jsdom, for the headless DOM tests
npm test      # unit suite + jsdom end-to-end suite (~113 checks)
```

- `tests/unit.test.js` — DOM-free coverage of vec3, camera, physics (the
  retarded-time solver, intercept, swept collision), the engine (resolution,
  energy budget, shields, overkill, overtime/tiebreak, idle/fast-forward,
  per-viewer log), and the view model (no center axes, fair camera framing).
- `tests/e2e.test.js` — drives the real DOM/render/UI under jsdom: a full duel,
  fairness of the per-viewer log, the post-game truth replay, fast-forward, and
  the corner gizmo.

The runtime game itself has **no dependencies** — `npm install` is only for tests.

## How it works

The retarded-time solver is the heart of it. For an observer at `O` at turn `T`,
it finds the emission time `t_e` where the enemy's light reaches you now:

```
dist( enemy(t_e), O )  =  c · (T − t_e)
```

Hit detection always uses **true** positions; only what players *perceive* is
delayed — so the simulation stays causal and deterministic while the *information*
is what's relativistically late.
