/* render.js — generic 3D-to-2D canvas renderer for Light Lag.
 * Knows nothing about game rules; it draws a flat list of world-space
 * primitives produced by viewmodel.js, projecting them with LL.Camera.
 * Attached to LL.Renderer. */
(function () {
  'use strict';
  const V = window.LL.V;
  const Camera = window.LL.Camera;

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = new Camera();
    this.scene = [];
    this.dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    this.w = 0; this.h = 0;
    this._running = false;
    this._bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  Renderer.prototype.resize = function () {
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  };

  Renderer.prototype._bindInput = function () {
    const c = this.canvas;
    let dragging = false, lx = 0, ly = 0;
    c.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointerup', (e) => { dragging = false; try { c.releasePointerCapture(e.pointerId); } catch (_) {} });
    c.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
      this.cam.orbit(-dx * 0.006, dy * 0.006);
    });
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.cam.zoom(e.deltaY > 0 ? 1.08 : 0.926); }, { passive: false });
  };

  Renderer.prototype.setScene = function (scene, target) {
    this.scene = scene || [];
    if (target) this.cam.target = target;
  };

  Renderer.prototype.start = function () {
    if (this._running) return; this._running = true;
    const loop = () => { if (!this._running) return; this.draw(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  };

  Renderer.prototype.proj = function (p) { return this.cam.project(p, this.w, this.h); };

  Renderer.prototype.draw = function () {
    const ctx = this.ctx, w = this.w, h = this.h;
    this.cam.update();
    ctx.clearRect(0, 0, w, h);

    // split primitives: backdrop (grid/sphere) first, then depth-sorted objects, labels last
    const back = [], objs = [], labels = [];
    for (const p of this.scene) {
      if (p.type === 'grid' || p.type === 'sphere' || p.type === 'starfield') back.push(p);
      else if (p.type === 'label') labels.push(p);
      else objs.push(p);
    }
    for (const p of back) this._drawPrim(p);

    // depth sort objects far->near using anchor depth
    for (const p of objs) p._d = this._anchorDepth(p);
    objs.sort((a, b) => b._d - a._d);
    for (const p of objs) this._drawPrim(p);

    for (const p of labels) this._drawPrim(p);

    this._drawGizmo(); // fixed orientation reference in the top-right corner
  };

  /* Small orientation sphere with X/Y/Z stubs, pinned to the top-right corner
   * (below the camera-preset buttons). Reflects the live camera orientation. */
  Renderer.prototype._drawGizmo = function () {
    const ctx = this.ctx;
    const cx = this.w - 54, cy = 94, R = 22;
    const r = this.cam._right, u = this.cam._up, f = this.cam._fwd;
    ctx.save();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(110,139,176,0.45)';
    ctx.fillStyle = 'rgba(10,16,25,0.55)';
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    const axes = [
      { v: V.of(1, 0, 0), c: '#ff6b6b', n: 'X' },
      { v: V.of(0, 1, 0), c: '#5cff9d', n: 'Y' },
      { v: V.of(0, 0, 1), c: '#6db3ff', n: 'Z' },
    ];
    axes.forEach((a) => { a._d = V.dot(a.v, f); }); // +ve = pointing into the screen
    axes.sort((a, b) => b._d - a._d);               // draw far axes first
    for (const a of axes) {
      const sx = V.dot(a.v, r), sy = -V.dot(a.v, u);
      const ex = cx + sx * R, ey = cy + sy * R;
      const front = a._d <= 0;
      ctx.globalAlpha = front ? 1 : 0.35;
      ctx.strokeStyle = a.c; ctx.lineWidth = front ? 1.8 : 1.1;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.fillStyle = a.c;
      ctx.beginPath(); ctx.arc(ex, ey, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = front ? 0.95 : 0.5;
      ctx.font = '9px "SF Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(a.n, cx + sx * (R + 8), cy + sy * (R + 8));
    }
    ctx.restore();
  };

  Renderer.prototype._anchorDepth = function (p) {
    const a = p.pos || p.a || p.center || V.of();
    const pr = this.proj(a);
    return pr.visible ? pr.depth : 1e9;
  };

  Renderer.prototype._drawPrim = function (p) {
    const ctx = this.ctx, w = this.w, h = this.h;
    switch (p.type) {
      case 'starfield': return this._starfield(p);
      case 'grid': return this._grid(p);
      case 'sphere': return this._sphere(p);
      case 'line': return this._line(p);
      case 'arrow': return this._arrow(p);
      case 'point': return this._point(p);
      case 'ship': return this._ship(p);
      case 'bubble': return this._bubble(p);
      case 'burst': return this._burst(p);
      case 'label': return this._label(p);
    }
  };

  /* ---- primitive drawers ---- */
  Renderer.prototype._seg = function (a, b, color, width, dash) {
    const pa = this.proj(a), pb = this.proj(b);
    if (!pa.visible || !pb.visible) return; // simple near-plane cull
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = width || 1;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    ctx.restore();
  };

  Renderer.prototype._line = function (p) { this._seg(p.a, p.b, p.color, p.width, p.dash); };

  Renderer.prototype._arrow = function (p) {
    this._seg(p.a, p.b, p.color, p.width || 1.5, p.dash);
    const pa = this.proj(p.a), pb = this.proj(p.b);
    if (!pa.visible || !pb.visible) return;
    const ang = Math.atan2(pb.y - pa.y, pb.x - pa.x);
    const s = 7;
    const ctx = this.ctx; ctx.save(); ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.moveTo(pb.x, pb.y);
    ctx.lineTo(pb.x - s * Math.cos(ang - 0.4), pb.y - s * Math.sin(ang - 0.4));
    ctx.lineTo(pb.x - s * Math.cos(ang + 0.4), pb.y - s * Math.sin(ang + 0.4));
    ctx.closePath(); ctx.fill(); ctx.restore();
  };

  Renderer.prototype._point = function (p) {
    const pr = this.proj(p.pos); if (!pr.visible) return;
    const ctx = this.ctx; ctx.save();
    const r = p.r || 4;
    if (p.fill !== false) { ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(pr.x, pr.y, r, 0, 7); ctx.fill(); }
    if (p.ring) { ctx.strokeStyle = p.color; ctx.lineWidth = p.ringW || 1.5; if (p.dash) ctx.setLineDash(p.dash); ctx.beginPath(); ctx.arc(pr.x, pr.y, r + (p.ringGap || 3), 0, 7); ctx.stroke(); }
    ctx.restore();
  };

  Renderer.prototype._ship = function (p) {
    const pr = this.proj(p.pos); if (!pr.visible) return;
    const ctx = this.ctx; ctx.save();
    const r = p.size || 9;
    // glow
    ctx.shadowColor = p.color; ctx.shadowBlur = p.ghost ? 4 : 14;
    ctx.strokeStyle = p.color; ctx.fillStyle = p.ghost ? 'transparent' : p.color;
    ctx.globalAlpha = p.ghost ? 0.85 : 1;
    ctx.lineWidth = p.ghost ? 1.5 : 2;
    if (p.ghost && p.dash) ctx.setLineDash(p.dash);
    // diamond hull
    ctx.beginPath();
    ctx.moveTo(pr.x, pr.y - r);
    ctx.lineTo(pr.x + r * 0.7, pr.y);
    ctx.lineTo(pr.x, pr.y + r);
    ctx.lineTo(pr.x - r * 0.7, pr.y);
    ctx.closePath();
    if (!p.ghost) ctx.fill();
    ctx.stroke();
    ctx.restore();
    // drop line to floor for depth cue
    if (p.dropLine) {
      const foot = V.of(p.pos.x, 0, p.pos.z);
      this._seg(p.pos, foot, p.color, 0.5, [2, 4]);
      const pf = this.proj(foot);
      if (pf.visible) { ctx.save(); ctx.fillStyle = p.color; ctx.globalAlpha = 0.4; ctx.beginPath(); ctx.arc(pf.x, pf.y, 2, 0, 7); ctx.fill(); ctx.restore(); }
    }
  };

  Renderer.prototype._bubble = function (p) {
    const pr = this.proj(p.pos); if (!pr.visible) return;
    const rpx = p.worldRadius * pr.scale;
    if (rpx < 1) return;
    const ctx = this.ctx; ctx.save();
    ctx.strokeStyle = p.color; ctx.globalAlpha = p.alpha != null ? p.alpha : 0.5;
    ctx.lineWidth = 1; if (p.dash !== null) ctx.setLineDash(p.dash || [3, 5]);
    ctx.beginPath(); ctx.arc(pr.x, pr.y, rpx, 0, 7); ctx.stroke();
    if (p.fillAlpha) { ctx.globalAlpha = p.fillAlpha; ctx.fillStyle = p.color; ctx.fill(); }
    ctx.restore();
  };

  Renderer.prototype._burst = function (p) {
    const pr = this.proj(p.pos); if (!pr.visible) return;
    const rpx = (p.worldRadius || 6) * pr.scale * (p.t || 1);
    const ctx = this.ctx; ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - (p.t || 0)) * (p.alpha || 1);
    ctx.fillStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = 20;
    ctx.beginPath(); ctx.arc(pr.x, pr.y, Math.max(1, rpx), 0, 7); ctx.fill();
    ctx.restore();
  };

  Renderer.prototype._label = function (p) {
    const pr = this.proj(p.pos); if (!pr.visible) return;
    const ctx = this.ctx; ctx.save();
    ctx.font = (p.font || '11px') + ' "SF Mono", monospace';
    ctx.fillStyle = p.color; ctx.globalAlpha = p.alpha != null ? p.alpha : 1;
    ctx.textAlign = p.align || 'left';
    const dx = p.dx || 8, dy = p.dy || -8;
    if (p.bg) {
      const m = ctx.measureText(p.text);
      ctx.globalAlpha = 0.65; ctx.fillStyle = p.bg;
      ctx.fillRect(pr.x + dx - 3, pr.y + dy - 10, m.width + 6, 14);
      ctx.globalAlpha = p.alpha != null ? p.alpha : 1; ctx.fillStyle = p.color;
    }
    ctx.fillText(p.text, pr.x + dx, pr.y + dy);
    ctx.restore();
  };

  Renderer.prototype._grid = function (p) {
    const R = p.radius, step = p.step || 25;
    const color = p.color || '#15324d';
    for (let x = -R; x <= R + 1e-6; x += step) {
      this._seg(V.of(x, 0, -R), V.of(x, 0, R), color, 0.5);
    }
    for (let z = -R; z <= R + 1e-6; z += step) {
      this._seg(V.of(-R, 0, z), V.of(R, 0, z), color, 0.5);
    }
  };

  Renderer.prototype._sphere = function (p) {
    const c = p.center || V.of(), R = p.radius, color = p.color || '#1d3a55';
    const rings = p.rings || 6, seg = p.seg || 36;
    const ctx = this.ctx;
    // latitude rings
    for (let i = 1; i < rings; i++) {
      const phi = -Math.PI / 2 + (Math.PI * i) / rings;
      const y = R * Math.sin(phi), rr = R * Math.cos(phi);
      let prev = null;
      for (let j = 0; j <= seg; j++) {
        const th = (2 * Math.PI * j) / seg;
        const pt = V.add(c, V.of(rr * Math.cos(th), y, rr * Math.sin(th)));
        if (prev) this._seg(prev, pt, color, 0.5);
        prev = pt;
      }
    }
    // a few longitude lines
    for (let k = 0; k < 6; k++) {
      const th = (Math.PI * k) / 6;
      let prev = null;
      for (let j = 0; j <= seg; j++) {
        const phi = -Math.PI / 2 + (Math.PI * j) / seg;
        const pt = V.add(c, V.of(R * Math.cos(phi) * Math.cos(th), R * Math.sin(phi), R * Math.cos(phi) * Math.sin(th)));
        if (prev) this._seg(prev, pt, color, 0.4);
        prev = pt;
      }
    }
  };

  Renderer.prototype._starfield = function (p) {
    // static-ish stars: deterministic from index, projected for parallax
    const ctx = this.ctx; ctx.save(); ctx.fillStyle = '#9fb6d6';
    const stars = p.stars; ctx.globalAlpha = 0.5;
    for (const s of stars) {
      const pr = this.proj(s); if (!pr.visible) continue;
      ctx.fillRect(pr.x, pr.y, 1, 1);
    }
    ctx.restore();
  };

  window.LL.Renderer = Renderer;
})();
