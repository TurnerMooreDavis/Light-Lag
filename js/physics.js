/* physics.js — the heart of Light Lag: relativistic (retarded-time) observation,
 * intercept ("firing solution") estimation, and swept collision.
 * Attached to LL.Phys. Pure functions over position history. */
(function () {
  'use strict';
  const V = window.LL.V;

  /* A history is an array of samples { t:int, pos:{x,y,z} } in ascending t,
   * where pos is the object's position AT integer turn t. For a ship this runs
   * 0..T; for a projectile it starts at its spawn turn. */

  /* ---- Retarded-time observation -----------------------------------------
   * What does an observer located at O (its CURRENT position at time T) SEE of
   * an object with the given position history, given light speed c?
   *
   * Light emitted by the object at time t_e from position B(t_e) reaches O at
   *     t_e + dist(B(t_e), O) / c.
   * We want the emission whose light arrives exactly now (== T):
   *     dist(B(t_e), O) = c * (T - t_e).
   * Define f(t_e) = c*(T - t_e) - dist(B(t_e), O).
   *   - f(T)  <= 0  (light from "now" has not travelled any distance yet).
   *   - As t_e decreases, c*(T - t_e) grows by c per turn while dist can change
   *     by at most the object's speed (< c) per turn, so f is strictly
   *     increasing toward the past -> exactly ONE root.
   * Scan history newest->oldest for the first sample with f >= 0; the root lies
   * between it and the next-newer sample. Linear-interpolate the crossing.
   *
   * Returns:
   *   { visible:true, pos, vel, age, te }      // a delayed image
   *   { visible:false, inbound:true, ... }      // light not yet arrived (early game)
   */
  function observe(history, O, T, c) {
    const n = history.length;
    if (n === 0) return { visible: false, inbound: false };

    const f = (i) => c * (T - history[i].t) - V.dist(history[i].pos, O);

    // Velocity of the object across the sample ending at index i (per turn).
    const velAt = (i) => {
      if (n === 1) return V.of();
      const a = history[Math.max(0, i - 1)];
      const b = history[Math.min(n - 1, i)];
      const dt = b.t - a.t || 1;
      return V.scale(V.sub(b.pos, a.pos), 1 / dt);
    };

    let fNewer = f(n - 1); // at the latest sample (expected <= 0)
    if (fNewer >= 0) {
      // Object is within c units: its light reaches us essentially live.
      const k = n - 1;
      return {
        visible: true, inbound: false,
        pos: V.clone(history[k].pos), vel: velAt(k),
        age: T - history[k].t, te: history[k].t,
      };
    }

    for (let i = n - 2; i >= 0; i--) {
      const fi = f(i);
      if (fi >= 0) {
        // Root between sample i (older, f>=0) and i+1 (newer, f<0).
        const g = fi / (fi - fNewer); // in [0,1], fraction from i toward i+1
        const A = history[i], B = history[i + 1];
        const te = A.t + (B.t - A.t) * g;
        const pos = V.lerp(A.pos, B.pos, g);
        const vel = V.scale(V.sub(B.pos, A.pos), 1 / ((B.t - A.t) || 1));
        return { visible: true, inbound: false, pos, vel, age: T - te, te };
      }
      fNewer = fi;
    }

    // No emitted light has arrived yet — the object's oldest photons are still
    // in transit. We have no live image; callers may show last *intel* instead.
    return {
      visible: false, inbound: true,
      oldest: V.clone(history[0].pos), oldestT: history[0].t,
      arrivesAt: history[0].t + V.dist(history[0].pos, O) / c,
    };
  }

  /* ---- Firing solution (intercept estimate) ------------------------------
   * Optional tactical aid. We do NOT know the enemy's true present state — only
   * a delayed image. Best honest estimate of their CURRENT position is the
   * apparent position extrapolated forward by the image's age along apparent
   * velocity. Then solve for the lead point assuming they HOLD that course:
   *   fire from S a projectile of speed w; find tau>0 with
   *     | (P + Vt*tau) - S | = w * tau
   *   => (Vt·Vt - w^2) tau^2 + 2 (D·Vt) tau + (D·D) = 0,  D = P - S.
   * Returns { ok, aim, tau, estNow } or { ok:false }. estNow is the assumed
   * present enemy position (apparent image projected forward by its age). */
  function interceptEstimate(shooterPos, image, weaponSpeed) {
    if (!image || !image.visible) return { ok: false };
    const age = image.age || 0;
    const estNow = V.add(image.pos, V.scale(image.vel, age)); // assume held course
    const Vt = image.vel;
    const D = V.sub(estNow, shooterPos);
    const a = V.dot(Vt, Vt) - weaponSpeed * weaponSpeed;
    const b = 2 * V.dot(D, Vt);
    const c = V.dot(D, D);
    let tau;
    if (Math.abs(a) < 1e-9) {
      if (Math.abs(b) < 1e-9) return { ok: false, estNow };
      tau = -c / b;
    } else {
      const disc = b * b - 4 * a * c;
      if (disc < 0) return { ok: false, estNow }; // cannot catch them on this course
      const s = Math.sqrt(disc);
      const r1 = (-b - s) / (2 * a);
      const r2 = (-b + s) / (2 * a);
      // smallest strictly-positive root
      const pos = [r1, r2].filter((r) => r > 1e-6).sort((x, y) => x - y);
      if (!pos.length) return { ok: false, estNow };
      tau = pos[0];
    }
    if (!(tau > 0) || !isFinite(tau)) return { ok: false, estNow };
    const aim = V.add(estNow, V.scale(Vt, tau));
    return { ok: true, aim, tau, estNow };
  }

  /* ---- Swept collision ----------------------------------------------------
   * Did a projectile travelling p0->p1 (over one tick) pass within `radius` of
   * a ship travelling s0->s1 over the same tick? Uses closest-point-of-approach.
   * Returns { hit, t, point } where point is the impact location (ship frame). */
  function sweptHit(p0, p1, s0, s1, radius) {
    const ca = V.closestApproach(p0, p1, s0, s1);
    if (ca.dist <= radius) {
      const point = V.lerp(s0, s1, ca.t);
      return { hit: true, t: ca.t, point, miss: ca.dist };
    }
    return { hit: false, t: ca.t, miss: ca.dist };
  }

  window.LL.Phys = { observe, interceptEstimate, sweptHit };
})();
