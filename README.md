# LIGHT LAG

A two-player, browser-based tactical space duel where **the speed of light is the
weapon**. You never see your opponent's ship — you see the *light that left it in
the past*. To land a hit you must fire not where they *appear*, but where they
*will be* when your shot arrives.

No build step, no dependencies. **Just open `index.html` in any modern browser.**

---

## The idea

The board is a 3D grid. Light travels **10 units per turn** (`c = 10`). The two
ships start **100 units apart**, so light takes **10 turns** to cross the gap.

That means:

- For the first **10 turns you are blind** — your opponent's light hasn't reached
  you yet. You know only where they *started* (pre-battle intel).
- After that, you see a **10-turn-old image** of a stationary enemy. If they move,
  the image lags even more, and the *image* itself shows where they *were*, not
  where they *are*.
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

## How to play (hotseat)

Both players plan **simultaneously and in secret**, then the turn resolves together.

1. **Pass-the-device curtain** — hand the screen to the named player; the other
   must not watch.
2. **Plan** on the Tactical Console (right panel):
   - **Maneuver** — set your Δx/Δy/Δz displacement (capped at max speed). Costs
     energy per unit. `TOWARD` / `AWAY` / `HOLD` helpers included.
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
buttons to read 3D depth cleanly. Every object drops a shadow line to the floor
plane to anchor it in space.

**Winning:** destroy the enemy ship (100 HP). If nobody dies by turn 40, the arena
begins to **shrink** — forcing the ships together until the light-lag is small
enough that hits become reliable. Ties break on HP, then total damage dealt.

---

## What you see on your console

- **Your ship** — known exactly (cyan for P1, amber for P2).
- **Enemy** — only ever the light-delayed image, tagged `light T−N`, wrapped in
  its uncertainty bubble. Before first contact: `NO SIGNAL · first light ≈ turn N`.
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
| `js/ui.js` | tactical console, planning input, hotseat phase machine |
| `js/main.js` | bootstrap |

The retarded-time solver is the heart of it. For an observer at `O` at turn `T`,
it finds the emission time `t_e` where the enemy's light reaches you now:

```
dist( enemy(t_e), O )  =  c · (T − t_e)
```

Hit detection always uses **true** positions; only what players *perceive* is
delayed — so the simulation stays causal and deterministic while the *information*
is what's relativistically late.
