/* camera.js — orbit camera + perspective projection onto a 2D canvas.
 * Pure helper, independent of game rules. Attached to LL.Camera. */
(function () {
  'use strict';
  const V = window.LL.V;

  function Camera() {
    this.target = V.of(0, 0, 0); // look-at point in world space
    this.yaw = Math.PI * 0.25;   // azimuth around world Y (up) axis
    this.pitch = Math.PI * 0.18; // elevation above XZ plane, clamped
    this.distance = 220;         // eye distance from target
    this.fov = (60 * Math.PI) / 180;
    this.near = 0.5;
    this._eye = V.of();
    this._right = V.of();
    this._up = V.of();
    this._fwd = V.of();
  }

  Camera.prototype.eye = function () {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    // direction from target to eye (Y is up)
    const dir = V.of(cp * sy, sp, cp * cy);
    return V.add(this.target, V.scale(dir, this.distance));
  };

  /* Recompute the view basis. Call once per frame before projecting. */
  Camera.prototype.update = function () {
    const eye = this.eye();
    this._eye = eye;
    const fwd = V.normalize(V.sub(this.target, eye));
    const worldUp = V.of(0, 1, 0);
    let right = V.cross(fwd, worldUp);
    if (V.len2(right) < 1e-8) right = V.of(1, 0, 0); // looking straight up/down
    right = V.normalize(right);
    const up = V.normalize(V.cross(right, fwd));
    this._fwd = fwd; this._right = right; this._up = up;
  };

  /* Project a world point. Returns {x,y} screen px, depth (view-space forward),
   * scale (px per world unit at that depth), and visible (in front of near plane). */
  Camera.prototype.project = function (p, w, h) {
    const rel = V.sub(p, this._eye);
    const vx = V.dot(rel, this._right);
    const vy = V.dot(rel, this._up);
    const vz = V.dot(rel, this._fwd); // depth into screen
    const focal = (h * 0.5) / Math.tan(this.fov * 0.5);
    if (vz <= this.near) {
      return { x: 0, y: 0, depth: vz, scale: 0, visible: false };
    }
    const inv = focal / vz;
    return {
      x: w * 0.5 + vx * inv,
      y: h * 0.5 - vy * inv,
      depth: vz,
      scale: inv,
      visible: true,
    };
  };

  Camera.prototype.orbit = function (dYaw, dPitch) {
    this.yaw += dYaw;
    const lim = Math.PI * 0.49;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch + dPitch));
  };

  Camera.prototype.zoom = function (factor) {
    this.distance = Math.max(20, Math.min(600, this.distance * factor));
  };

  /* Snap to a fixed viewing preset so depth always reads the same way. */
  Camera.prototype.snapTo = function (view) {
    const presets = {
      iso:   { yaw: Math.PI * 0.25, pitch: Math.PI * 0.18 },
      top:   { yaw: 0, pitch: Math.PI * 0.49 },
      front: { yaw: 0, pitch: Math.PI * 0.02 },
      side:  { yaw: Math.PI * 0.5, pitch: Math.PI * 0.02 },
    };
    const p = presets[view] || presets.iso;
    this.yaw = p.yaw; this.pitch = p.pitch;
  };

  window.LL.Camera = Camera;
})();
