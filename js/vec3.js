/* vec3.js — minimal 3D vector math for Light Lag.
 * Vectors are plain {x,y,z} objects. All functions are pure (return new objects)
 * except where noted. Attached to the global LL namespace. */
(function () {
  'use strict';

  const V = {
    of: (x = 0, y = 0, z = 0) => ({ x, y, z }),
    clone: (a) => ({ x: a.x, y: a.y, z: a.z }),
    add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
    sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
    scale: (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
    mul: (a, b) => ({ x: a.x * b.x, y: a.y * b.y, z: a.z * b.z }),
    neg: (a) => ({ x: -a.x, y: -a.y, z: -a.z }),
    dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
    cross: (a, b) => ({
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    }),
    len2: (a) => a.x * a.x + a.y * a.y + a.z * a.z,
    len: (a) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z),
    dist2: (a, b) => {
      const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
      return dx * dx + dy * dy + dz * dz;
    },
    dist: (a, b) => Math.sqrt(V.dist2(a, b)),
    normalize: (a) => {
      const l = V.len(a);
      return l > 1e-12 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 0 };
    },
    /* linear interpolation a->b at t in [0,1] */
    lerp: (a, b, t) => ({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    }),
    /* clamp a vector's magnitude to maxLen, preserving direction */
    clampLen: (a, maxLen) => {
      const l = V.len(a);
      if (l <= maxLen || l < 1e-12) return V.clone(a);
      const s = maxLen / l;
      return { x: a.x * s, y: a.y * s, z: a.z * s };
    },
    eq: (a, b, eps = 1e-9) =>
      Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.z - b.z) < eps,
    fmt: (a, p = 1) => `(${a.x.toFixed(p)}, ${a.y.toFixed(p)}, ${a.z.toFixed(p)})`,
  };

  /* Closest point of approach between two points moving linearly over t in [0,1].
   * A(t) = a0 + (a1-a0)t,  B(t) = b0 + (b1-b0)t.
   * Returns { t, dist } where t in [0,1] minimizes |A(t)-B(t)|. */
  V.closestApproach = function (a0, a1, b0, b1) {
    const r0 = V.sub(a0, b0);            // relative position at t=0
    const rv = V.sub(V.sub(a1, a0), V.sub(b1, b0)); // relative velocity (per unit t)
    const vv = V.len2(rv);
    let t;
    if (vv < 1e-12) {
      t = 0; // no relative motion: separation constant, sample at start
    } else {
      t = -V.dot(r0, rv) / vv;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
    }
    const sep = V.add(r0, V.scale(rv, t)); // relative position at t
    return { t, dist: V.len(sep) };
  };

  window.LL = window.LL || {};
  window.LL.V = V;
})();
