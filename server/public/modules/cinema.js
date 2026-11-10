// CCAM big-screen module: cinema
// Horizontal lanes, ONE photo per lane, sliding left → right. Each photo keeps its own aspect ratio
// (landscape stays wide, portrait stays tall and centred in its lane). No duplicated tracks and no tile
// insertion, so there is no seam/flicker at the loop. A new photo drops in from a random edge, grows big,
// then takes over a lane and keeps travelling right. Pin pauses the lanes and pops the photo up.
// Contract: export default create(ctx) -> { mount, refresh, add, remove, pin, destroy }.
export default function create(ctx) {
  const { photos, img, pick, R, reduce, settings } = ctx;
  const W = () => innerWidth, H = () => innerHeight;
  let root, lanes = [], tagEl = null, pinHandle = null, popTimer = null, pinnedId = null;

  function injectCss() {
    if (document.getElementById('mod-cinema-css')) return;
    const st = document.createElement('style'); st.id = 'mod-cinema-css';
    st.textContent = `
      .cine-lanes { position:absolute; inset:0; display:flex; flex-direction:column; gap:.6vw; padding:.6vw 0; overflow:hidden; }
      .cine-lane { position:relative; flex:1 1 0; min-height:0; overflow:hidden; }
      .cine-shot { position:absolute; top:0; bottom:0; margin:auto 0; left:50%; height:100%; width:auto; max-width:none;
        object-fit:contain; display:block; border-radius:.5vw; will-change:transform; background:#0b0f12;
        transform:translateX(-50%); }
      .cine-empty { position:absolute; inset:0; display:grid; place-items:center; color:#9fb0b2; font-size:max(16px,1.6vw); z-index:2; }
      .cine-fly { position:absolute; z-index:8; overflow:hidden; border-radius:.6vw; pointer-events:none;
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

  // Each lane holds ONE photo at a time. Every cycle the next photo slides in from the left while the
  // current one slides out to the right — the lane is never empty, so nothing flickers.
  function laneShots(lane) { return [...lane.el.querySelectorAll('.cine-shot')]; }
  function sizeShot(imgEl, p) {
    imgEl.src = img(p, 1600);
    const r = laneSize(imgEl);
    return r;
  }
  function laneSize(imgEl) {
    const w = imgEl.naturalWidth || 3, h = imgEl.naturalHeight || 2;
    const H0 = imgEl.parentElement.clientHeight || 200;
    return { w: Math.round(h ? (H0 * w / h) : H0 * 1.4), h: H0 };
  }
  function slideCycle(lane) {
    if (!root || !lane || pinnedId) return;
    clearTimeout(lane.timer);
    const ps = list();
    if (!ps.length) { laneShots(lane).forEach((i) => i.removeAttribute('src')); lane.p = null; emptyState(); lane.timer = setTimeout(() => slideCycle(lane), 1200); return; }
    const p = (lane.queue && lane.queue.shift()) || pick(ps.filter((x) => x.id !== lane.p?.id)) || ps[0];
    const [cur, next] = laneShots(lane);
    const incoming = (lane.turn = !lane.turn) ? cur : next;
    const outgoing = incoming === cur ? next : cur;
    incoming.style.opacity = '0';
    incoming.src = img(p, 1600);
    const show = () => {
      const iw = incoming.naturalWidth || 3, ih = incoming.naturalHeight || 2;
      const H0 = lane.el.clientHeight || 200;
      const w = Math.round(H0 * iw / ih);
      const off = -w / 2 + 4;
      const hold = Math.max(3500, (settings().loopSec || 5) * 1000);
      incoming.style.opacity = '1';
      const inAnim = incoming.animate(
        [{ transform: `translateX(${off - W()}px)` }, { transform: `translateX(${off}px)` }],
        { duration: reduce ? 200 : 900, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' },
      );
      let outAnim = null;
      if (outgoing && outgoing.src && outgoing.style.opacity !== '0') {
        const ow = Math.round(H0 * (outgoing.naturalWidth || 3) / (outgoing.naturalHeight || 2));
        outAnim = outgoing.animate(
          [{ transform: `translateX(${-ow / 2}px)` }, { transform: `translateX(${-ow / 2 + W()}px)` }],
          { duration: reduce ? 200 : 900, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' },
        );
      }
      lane.p = p;
      lane.timer = setTimeout(() => {
        if (outgoing) outgoing.style.opacity = '0';
        slideCycle(lane);
      }, hold);
    };
    if (incoming.complete && incoming.naturalWidth) show();
    else { incoming.onload = () => { incoming.onload = null; show(); }; lane.timer = setTimeout(show, 1500); }
  }
  function startLane(lane) {
    lane.turn = false;
    slideCycle(lane);
  }
  function build() {
    injectCss();
    const box = document.createElement('div'); box.className = 'cine-lanes';
    const n = innerHeight > innerWidth ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div'); el.className = 'cine-lane';
      const a = document.createElement('img'); a.className = 'cine-shot'; a.decoding = 'async'; a.style.opacity = '0';
      const b = document.createElement('img'); b.className = 'cine-shot'; b.decoding = 'async'; b.style.opacity = '0';
      el.appendChild(a); el.appendChild(b); box.appendChild(el);
      lanes.push({ el, a, b, p: null, anim: null, timer: null, turn: false, queue: [] });
    }
    root.appendChild(box);
    const empty = document.createElement('div'); empty.className = 'cine-empty'; empty.textContent = 'Photos will appear here'; root.appendChild(empty);
    const pop = document.createElement('div'); pop.className = 'cine-pop'; pop.innerHTML = '<img alt="" decoding="async">'; root.appendChild(pop);
    emptyState();
    lanes.forEach((lane, i) => setTimeout(() => startLane(lane), i * 250));
  }
  function showTag(p) {
    hideTag();
    tagEl = document.createElement('div'); tagEl.className = 'tag'; tagEl.setAttribute('data-brand-lock', '1');
    tagEl.textContent = p.by ? `by ${p.by}` : 'a guest';
    document.getElementById('stage').appendChild(tagEl);
    const foot = document.getElementById('foot');
    if (foot) tagEl.style.bottom = (innerHeight - foot.getBoundingClientRect().top + 5) + 'px';
    setTimeout(hideTag, 4500);
  }
  function hideTag() { if (tagEl) { tagEl.remove(); tagEl = null; } }

  // new photo: random edge → grows big in the middle → takes over a lane (keeps sliding right)
  function dropIn(p) {
    if (!root) return;
    const live = lanes.filter((l) => l.el && l.el.isConnected);
    if (!live.length) return;
    const lane = pick(live);
    showTag(p);
    const edge = pick(['top', 'bottom', 'left', 'right']);
    const w0 = 16 * W() / 100, h0 = w0 * 0.75;
    let x0, y0;
    if (edge === 'top') { x0 = R(0.1, 0.8) * W(); y0 = -h0; }
    else if (edge === 'bottom') { x0 = R(0.1, 0.8) * W(); y0 = H(); }
    else if (edge === 'left') { x0 = -w0; y0 = R(0.1, 0.8) * H(); }
    else { x0 = W(); y0 = R(0.1, 0.8) * H(); }
    const fly = document.createElement('div'); fly.className = 'cine-fly';
    fly.innerHTML = `<img src="${img(p, 1600)}" alt="">`;
    Object.assign(fly.style, { left: x0 + 'px', top: y0 + 'px', width: w0 + 'px', height: h0 + 'px', transition: 'none', opacity: '0', borderRadius: '0.6vw' });
    root.appendChild(fly);
    const bigW = Math.min(W() * 0.5, 900), bigH = bigW * 0.75;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      Object.assign(fly.style, { opacity: '1', transition: 'left .45s cubic-bezier(.4,0,.2,1), top .45s cubic-bezier(.4,0,.2,1), width .45s cubic-bezier(.4,0,.2,1), height .45s cubic-bezier(.4,0,.2,1), opacity .25s ease-out' });
      Object.assign(fly.style, { left: (W() - bigW) / 2 + 'px', top: (H() - bigH) / 2 + 'px', width: bigW + 'px', height: bigH + 'px' });
    }));
    setTimeout(() => {
      // land on the lane, take it over, and continue sliding to the right
      const r = lane.el.getBoundingClientRect();
      const iw = p.w || 3, ih = p.h || 2;
      const shotH = r.height, shotW = Math.min(shotH * iw / ih, W() * 0.9);
      Object.assign(fly.style, { transition: 'left .75s cubic-bezier(.4,0,.2,1), top .75s cubic-bezier(.4,0,.2,1), width .75s cubic-bezier(.4,0,.2,1), height .75s cubic-bezier(.4,0,.2,1), border-radius .5s' });
      Object.assign(fly.style, { left: (W() - shotW) / 2 + 'px', top: r.top + (shotH - r.height) / 2 + 'px', width: shotW + 'px', height: shotH + 'px', borderRadius: '.5vw' });
      setTimeout(() => {
        fly.remove();
        // hand the lane over: put the new photo first in that lane's queue and restart its cycle
        lane.queue = [p];
        clearTimeout(lane.timer);
        slideCycle(lane);
      }, reduce ? 120 : 760);
    }, reduce ? 120 : 520);
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
    mount(el) { root = el; build(); },
    refresh() {
      lanes.forEach((lane) => {
        if (!lane.p && list().length) { lane.queue = []; startLane(lane); }
        else if (lane.p && !list().some((p) => p.id === lane.p.id)) { lane.queue = []; slideCycle(lane); }
      });
      emptyState();
    },
    add(p) { dropIn(p); },
    remove(id) { lanes.forEach((lane) => { if (lane.p && lane.p.id === id) { lane.queue = []; slideCycle(lane); } }); emptyState(); },
    pin(pin) {
      if (!pin) {
        pinnedId = null; clearTimeout(popTimer);
        lanes.forEach((lane) => { lane.queue = []; slideCycle(lane); });
        if (pinHandle) { closePopup(pinHandle, () => { pinHandle = null; }); pinHandle = null; }
        return;
      }
      pinnedId = pin.id || null;
      lanes.forEach((lane) => clearTimeout(lane.timer));
      const p = ctx.photoById(pin.id); if (!p) return;
      const lane = lanes.find((l) => l.p && l.p.id === p.id) || pick(lanes);
      pinHandle = popup(p, lane);
    },
    destroy() {
      clearTimeout(popTimer); hideTag();
      lanes.forEach((lane) => clearTimeout(lane.timer));
      lanes = [];
      if (root) root.innerHTML = '';
    },
  };
}
