/* main.js — bootstrap: wire the game, renderer, and console together. */
(function () {
  'use strict';
  function boot() {
    const canvas = document.getElementById('scene');
    const game = new window.LL.Engine();
    const renderer = new window.LL.Renderer(canvas);

    // camera preset bar (axis snaps make 3D depth readable)
    const bar = document.createElement('div');
    bar.style.cssText = 'position:absolute;top:10px;right:12px;display:flex;gap:4px;pointer-events:auto;';
    [['ISO', 'iso'], ['TOP', 'top'], ['FRONT', 'front'], ['SIDE', 'side']].forEach(([label, view]) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'font:11px monospace;padding:3px 7px;background:#0d1626;color:#6f8bb0;border:1px solid #1d2c44;border-radius:3px;cursor:pointer;';
      b.addEventListener('click', () => renderer.cam.snapTo(view));
      bar.appendChild(b);
    });
    document.getElementById('viewport').appendChild(bar);

    window.LL.game = game;
    window.LL.renderer = renderer;
    window.LL.UI.init(game, renderer);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
