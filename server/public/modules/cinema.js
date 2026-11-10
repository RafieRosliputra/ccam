// CCAM big-screen module: cinema
// Continuous conveyor lanes: every lane keeps moving left → right forever. Photos never "enter and
// disappear" — a tile that leaves the right edge is recycled to the left with the next photo, so the
// motion is uninterrupted. Each photo keeps its own aspect ratio (landscape wide, portrait tall).
// A NEW photo simply drops in (from a random edge, no big grow) onto a visible tile and joins the flow.
// Pin pauses the lanes and pops the photo up.
// Contract: export default create(ctx) -> { mount, refresh, add, remove, pin, destroy }.
export default function create(ctx) {
  const { photos, img, pick, R, reduce, settings } = ctx;
  const W = () => innerWidth, H = () => innerHeight;
  let root, lanes = [], raf = 0, lastT = 0, tagEl = null, pinHandle = null, pinnedId = null, nextIdx = 0;

  function injectCss() {
    if (document.getElementById('mod-cinema-css')) return;
    const st = document.createElement('style'); st.id = 'mod-cinema-css';
    st.textContent = `
      .cine-lanes { position:absolute; inset:0; display:flex; flex-direction:column; gap:.5vw; padding:.3vw 0; overflow:hidden; }
      .cine-lane { position:relative; flex:0 0 auto; min-height:0; overflow:hidden; }
      .cine-shot { position:absolute; top:50%; left:0; height:100%; width:auto; max-width:none; object-fit:contain;
        display:block; border-radius:.5vw; will-change:transform; background:#0b0f12; transform:translateY(-50%); }
      .cine-empty { position:absolute; inset:0; display:grid; place-items:center; color:#9fb0b2; font-size:max(16px,1.6vw); z-index:2; }
      .cine-fly { position:absolute; z-index:8; overflow:hidden; border-radius:.5vw; pointer-events:none;
        box-shadow:0 2vw 8vw rgba(0,0,0,.6); background:#1a2125; will-change:left,top,width,height; }
      .cine-fly img { width:100%; height:100%; object-fit:cover; display:block; }
      .cine-pop { position:absolute; z-index:5; display:none; overflow:hidden; background:transparent;
        box-shadow:0 2vw 8vw rgba(0,0,0,.55); will-change:left,top,width,height; }
      .cine-pop.on { display:block; }
      .cine-pop img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; will-change:transform; }
    `;
    document.head.appendChild(st);
  }
  const list = () => photos();
  function emptyState() { const el = root && root.querySelector('.cine-empty'); if (el) el.style.display = list().length ? 'none' : ''; }
  const shotWidth = (lane, p) => Math.max(60, (lane.el.clientHeight || 200) * ((p && p.w) || 3) / ((p && p.h) || 2));

  function laneLoop(lane) {
    // total width of the loop (tiles + gaps)
    let total = 0;
    for (const t of lane.tiles) total += shotWidth(lane, t.p) + lane.gap;
    lane.loopWidth = Math.max(1, total);
  }
  function assignTile(lane, tile, p) {
    tile.p = p;
    tile.img.src = img(p, 1600);
    tile.img.style.height = (lane.el.clientHeight || 200) + 'px'; // explicit, so the photo is exactly the lane height
    tile.img.style.width = shotWidth(lane, p) + 'px';
  }
  function buildLane() {
    const box = document.createElement('div'); box.className = 'cine-lanes';
    root.appendChild(box); // in the DOM first so each lane has a real height
    const n = innerHeight > innerWidth ? 2 : 3;
    const ps = list();
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div'); el.className = 'cine-lane';
      const lane = { el, tiles: [], speed: 38 + i * 9, gap: Math.round(innerWidth * 0.006), loopWidth: 1, paused: false };
      const count = 5;
      for (let k = 0; k < count; k++) {
        const im = document.createElement('img'); im.className = 'cine-shot'; im.decoding = 'async';
        const tile = { img: im, p: null, x: 0 };
        el.appendChild(im); lane.tiles.push(tile);
      }
      // lay them out left → right, starting slightly before the screen so the lane is always full
      let x = -Math.round(innerWidth * 0.2);
      for (const t of lane.tiles) {
        const p = ps.length ? ps[(nextIdx++) % ps.length] : null;
        if (p) assignTile(lane, t, p); else t.img.style.width = '0px';
        t.x = x;
        x += shotWidth(lane, p || { w: 3, h: 2 }) + lane.gap;
      }
      laneLoop(lane);
      box.appendChild(el);
      lanes.push(lane);
    }
    // give every lane an explicit height so the photos can fill it exactly
    const boxH = box.clientHeight || innerHeight;
    const gap = parseFloat(getComputedStyle(box).rowGap) || 0;
    const laneH = Math.max(80, Math.floor((boxH - gap * (n - 1)) / n));
    lanes.forEach((lane) => { lane.el.style.height = laneH + 'px'; });
    // now that the lanes have a height, size/reposition their photos to exactly fill it
    lanes.forEach((lane) => {
      const h = lane.el.clientHeight;
      lane.tiles.forEach((t) => { if (t.p) { t.img.style.height = h + 'px'; t.img.style.width = shotWidth(lane, t.p) + 'px'; } });
      laneLoop(lane);
    });
    const empty = document.createElement('div'); empty.className = 'cine-empty'; empty.textContent = 'Photos will appear here'; root.appendChild(empty);
    const pop = document.createElement('div'); pop.className = 'cine-pop'; pop.innerHTML = '<img alt="" decoding="async">'; root.appendChild(pop);
    emptyState();
    startRaf();
  }
  function startRaf() {
    cancelAnimationFrame(raf); lastT = 0;
    const step = (t) => {
      const dt = lastT ? Math.min(64, t - lastT) / 1000 : 0.016;
      lastT = t;
      for (const lane of lanes) {
        if (lane.paused) { lane.tiles.forEach((tile) => place(lane, tile)); continue; }
        for (const tile of lane.tiles) {
          tile.x += lane.speed * dt;                    // travel left → right
          const w = shotWidth(lane, tile.p || { w: 3, h: 2 });
          if (tile.x - w / 2 > W()) {                   // left the right edge: recycle to the left, keep going
            tile.x -= lane.loopWidth;
            const ps = list();
            if (ps.length) assignTile(lane, tile, ps[(nextIdx++) % ps.length]);
            else tile.img.style.width = '0px';
          }
          place(lane, tile);
        }
        laneLoop(lane);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  function place(lane, tile) {
    tile.img.style.transform = `translate(${Math.round(tile.x)}px, -50%)`;
  }

  function showTag(p) {
    hideTag();
    tagEl = document.createElement('div'); tagEl.className = 'tag'; tagEl.setAttribute('data-brand-lock', '1');
    tagEl.textContent = p.by ? `by ${p.by}` : 'a guest';
    document.getElementById('stage').appendChild(tagEl);
    const foot = document.getElementById('foot');
    if (foot) tagEl.style.bottom = (innerHeight - foot.getBoundingClientRect().top + 5) + 'px';
    setTimeout(hideTag, 4000);
  }
  function hideTag() { if (tagEl) { tagEl.remove(); tagEl = null; } }

  // new photo: drop from a random edge straight onto a visible tile (no big grow), then join the flow
  function dropIn(p) {
    if (!root || !lanes.length) return;
    const lane = pick(lanes);
    const visible = lane.tiles.filter((t) => t.x > W() * 0.12 && t.x < W() * 0.88); // centre on screen
    const tile = visible.length ? pick(visible) : pick(lane.tiles);
    if (!tile) return;
    showTag(p);
    const w = shotWidth(lane, p), h = lane.el.clientHeight;
    const r = lane.el.getBoundingClientRect();
    const target = { left: W() / 2 + tile.x - w / 2, top: r.top };
    const edge = pick(['top', 'bottom', 'left', 'right']);
    const start = edge === 'top' ? { x: target.left + w * 0.2, y: -h * 0.6 }
      : edge === 'bottom' ? { x: target.left + w * 0.2, y: H() + h * 0.1 }
      : edge === 'left' ? { x: -w, y: target.top + h * 0.2 }
      : { x: W() + w * 0.1, y: target.top + h * 0.2 };
    const fly = document.createElement('div'); fly.className = 'cine-fly';
    fly.innerHTML = `<img src="${img(p, 1600)}" alt="">`;
    Object.assign(fly.style, { left: start.x + 'px', top: start.y + 'px', width: w + 'px', height: h + 'px', transition: 'none' });
    root.appendChild(fly);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fly.style.transition = 'left .5s cubic-bezier(.4,0,.2,1), top .5s cubic-bezier(.4,0,.2,1)';
      fly.style.left = target.left + 'px'; fly.style.top = target.top + 'px';
    }));
    setTimeout(() => {
      fly.remove();
      assignTile(lane, tile, p); // the photo joins the moving row exactly where it landed
      laneLoop(lane);
    }, reduce ? 120 : 540);
  }

  function faceSafeScale(p, f, desired) {
    let sMax = desired;
    if (p.fc && p.fc.length) {
      const m = 0.02;
      for (const [x0, y0, x1, y1] of p.fc) {
        for (const ux of [x0, x1]) { const dx = ux - f[0]; if (dx > 0.001) sMax = Math.min(sMax, (1 - m - f[0]) / dx); else if (dx < -0.001) sMax = Math.min(sMax, (f[0] - m) / (-dx)); }
        for (const uy of [y0, y1]) { const dy = uy - f[1]; if (dy > 0.001) sMax = Math.min(sMax, (1 - m - f[1]) / dy); else if (dy < -0.001) sMax = Math.min(sMax, (f[1] - m) / (-dy)); }
      }
    }
    return Math.max(1, Math.min(desired, sMax));
  }
  function focusOf(p) {
    if (p.fc && p.fc.length) {
      let sx = 0, sy = 0, sw = 0;
      for (const [x0, y0, x1, y1] of p.fc) { const a = (x1 - x0) * (y1 - y0); sx += (x0 + x1) / 2 * a; sy += (y0 + y1) / 2 * a; sw += a; }
      if (sw) return [sx / sw, sy / sw];
    }
    return [0.5, 0.42];
  }
  function popup(p, lane) {
    const pop = root.querySelector('.cine-pop'), im = pop && pop.querySelector('img');
    if (!pop || !im) return null;
    const [fx, fy] = focusOf(p);
    const r0 = lane ? lane.el.getBoundingClientRect() : { left: W()*.3, top: H()*.3, width: W()*.4, height: H()*.3 };
    im.src = img(p, 1600);
    im.style.transition = 'none'; im.style.transform = 'scale(1.25)';
    im.style.transformOrigin = `${Math.round(fx*100)}% ${Math.round(fy*100)}%`;
    im.style.objectFit = 'cover'; im.style.objectPosition = `${Math.round(fx*100)}% ${Math.round(fy*100)}%`;
    Object.assign(pop.style, { transition: 'none', left: r0.left+'px', top: r0.top+'px', width: r0.width+'px', height: r0.height+'px', borderRadius: '.5vw' });
    pop.classList.add('on');
    const iw = p.w || 3, ih = p.h || 2;
    const k = Math.min(W()*0.92/iw, H()*0.88/ih);
    const tw = Math.round(iw*k), th = Math.round(ih*k);
    const target = { left: Math.round((W()-tw)/2), top: Math.round((H()-th)/2), width: tw, height: th };
    requestAnimationFrame(() => requestAnimationFrame(() => {
      pop.style.transition = 'left .8s cubic-bezier(.4,0,.2,1), top .8s cubic-bezier(.4,0,.2,1), width .8s cubic-bezier(.4,0,.2,1), height .8s cubic-bezier(.4,0,.2,1), border-radius .8s';
      im.style.transition = 'transform .8s cubic-bezier(.4,0,.2,1)';
      im.style.transform = 'scale(1)';
      Object.assign(pop.style, { left: target.left+'px', top: target.top+'px', width: target.width+'px', height: target.height+'px', borderRadius: '.35vw' });
    }));
    const zi = Math.max(1800, (settings().loopSec || 5) * 380);
    setTimeout(() => {
      im.style.transition = `transform ${zi}ms cubic-bezier(.4,0,.2,1)`;
      im.style.transform = `scale(${reduce ? 1 : faceSafeScale(p, [fx,fy], R(1.26,1.34))})`;
    }, 820);
    return { pop, im, r0, zi };
  }
  function closePopup(h, done) {
    if (!h) return;
    h.im.style.transition = 'transform .6s cubic-bezier(.4,0,.2,1)';
    h.im.style.transform = 'scale(1.35)';
    setTimeout(() => {
      h.pop.style.transition = 'left .7s cubic-bezier(.4,0,.2,1), top .7s cubic-bezier(.4,0,.2,1), width .7s cubic-bezier(.4,0,.2,1), height .7s cubic-bezier(.4,0,.2,1), border-radius .7s';
      Object.assign(h.pop.style, { left: h.r0.left+'px', top: h.r0.top+'px', width: h.r0.width+'px', height: h.r0.height+'px', borderRadius: '.5vw' });
      setTimeout(() => { h.pop.classList.remove('on'); h.im.style.transition = 'none'; h.im.style.transform = 'none'; if (done) done(); }, reduce ? 80 : 620);
    }, reduce ? 60 : 700);
  }

  return {
    mount(el) { root = el; injectCss(); buildLane(); },
    refresh() {
      const ps = list();
      if (ps.length) lanes.forEach((lane) => lane.tiles.forEach((t) => { if (!t.p) assignTile(lane, t, ps[(nextIdx++) % ps.length]); }));
      laneLoopAll(); emptyState();
    },
    add(p) { dropIn(p); },
    remove(id) { lanes.forEach((lane) => lane.tiles.forEach((t) => { if (t.p && t.p.id === id) { t.p = null; t.img.removeAttribute('src'); t.img.style.width = '0px'; } })); laneLoopAll(); emptyState(); },
    pin(pin) {
      if (!pin) {
        pinnedId = null;
        lanes.forEach((lane) => { lane.paused = false; });
        if (pinHandle) { closePopup(pinHandle, () => { pinHandle = null; }); pinHandle = null; }
        return;
      }
      pinnedId = pin.id || null;
      lanes.forEach((lane) => { lane.paused = true; });
      const p = ctx.photoById(pin.id); if (!p) return;
      const lane = lanes.find((l) => l.tiles.some((t) => t.p && t.p.id === p.id)) || pick(lanes);
      pinHandle = popup(p, lane);
    },
    destroy() { cancelAnimationFrame(raf); hideTag(); lanes = []; if (root) root.innerHTML = ''; },
  };
  function laneLoopAll() { lanes.forEach(laneLoop); }
}
