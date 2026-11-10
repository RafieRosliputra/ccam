// CCAM big-screen module: carousel
// Two vertical columns (left/right, 10% side margins) scrolling in opposite directions.
// A new photo slides straight into a column (no pop-up). When idle, the module waits until a photo is
// near the vertical centre of a column, eases that column to a stop, pops the photo out of its own slide,
// animates a ~30% zoom in towards the faces AND back out, returns it to the slide, then eases the column
// back up. Columns alternate. Everything uses the 1600px images so the transforms stay smooth.
// Contract: export default create(ctx) -> { mount, refresh, add, remove, pin, destroy }.
export default function create(ctx) {
  const { photos, img, pick, R, reduce, settings } = ctx;
  const W = () => innerWidth, H = () => innerHeight;
  let root, grid, per = 4, pinnedId = null, idleTimer = null, popTimer = null, popHandle = null;
  let tagEl = null, busy = false, nextCol = 0, pendingPop = null, scrolls = [];

  function injectCss() {
    if (document.getElementById('mod-carousel-css')) return;
    const st = document.createElement('style'); st.id = 'mod-carousel-css';
    st.textContent = `
      .car-grid { position:absolute; inset:0; display:flex; gap:.7vw; padding:.7vw 10%; }
      .car-col { flex:1 1 0; min-width:0; overflow:hidden; border-radius:.6vw; }
      .car-track { display:flex; flex-direction:column; gap:.7vw; will-change:transform; }
      .car-tile { position:relative; flex:none; aspect-ratio:4/3; overflow:hidden; border-radius:.5vw; background:#1a2125; }
      .car-tile img { width:100%; height:100%; object-fit:cover; display:block; }
      .car-tile.in { animation:carIn .6s cubic-bezier(.2,.8,.2,1); }
      @keyframes carIn { from { opacity:0; transform:scale(.86); } to { opacity:1; transform:none; } }
      .car-empty { position:absolute; inset:0; display:grid; place-items:center; color:#9fb0b2; font-size:max(16px,1.6vw); z-index:2; }
      .car-pop { position:absolute; z-index:5; display:none; overflow:hidden; background:transparent;
        box-shadow:0 2vw 8vw rgba(0,0,0,.55); will-change:left,top,width,height; }
      .car-pop.on { display:block; }
      .car-pop img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover;
        will-change:transform; transform:translateZ(0); backface-visibility:hidden; }
    `;
    document.head.appendChild(st);
  }
  const list = () => photos();
  function tileHtml(p, cls = '') { return `<div class="car-tile ${cls}" data-id="${p.id}"><img src="${img(p, 480)}" alt="" loading="lazy" decoding="async"></div>`; }
  function emptyState() { const el = root && root.querySelector('.car-empty'); if (el) el.style.display = list().length ? 'none' : ''; }

  // ---------- smooth scroll (Web Animations) with eased pause / resume ----------
  function startScroll(track, secs, reverse) {
    track.style.transform = 'none';
    // (reverse() cannot be used on an infinite animation — use the reversed keyframes instead)
    const frames = reverse
      ? [{ transform: 'translateY(-50%)' }, { transform: 'translateY(0)' }]
      : [{ transform: 'translateY(0)' }, { transform: 'translateY(-50%)' }];
    const anim = track.animate(frames, { duration: secs * 1000, iterations: Infinity, easing: 'linear' });
    return { track, anim };
  }
  function tweenRate(entry, target, ms) {
    if (!entry) return;
    const anim = entry.anim;
    const from = anim.playbackRate;
    if (target > 0 && anim.playState === 'paused') anim.play();
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // easeInOutQuad
      anim.updatePlaybackRate(from + (target - from) * e);
      if (k < 1) requestAnimationFrame(step);
      else { anim.updatePlaybackRate(target); if (target === 0) anim.pause(); }
    };
    requestAnimationFrame(step);
  }
  const easePause = (entry) => tweenRate(entry, 0, 420);
  const easeResume = (entry) => tweenRate(entry, 1, 520);

  function fill() {
    if (!grid) return;
    const ps = list();
    const cols = grid.children.length || 2;
    per = Math.max(4, Math.ceil((ps.length || 1) * 2 / cols));
    [...grid.children].forEach((col, c) => {
      const track = col.querySelector('.car-track');
      const items = [];
      for (let i = 0; i < per; i++) { if (!ps.length) break; items.push(tileHtml(ps[(c * 2 + i) % ps.length])); }
      track.innerHTML = items.join('') + items.join('');
    });
    emptyState();
  }
  function build() {
    injectCss();
    grid = document.createElement('div'); grid.className = 'car-grid';
    for (let c = 0; c < 2; c++) {
      const col = document.createElement('div'); col.className = 'car-col';
      const track = document.createElement('div'); track.className = 'car-track';
      col.appendChild(track); grid.appendChild(col);
    }
    root.appendChild(grid);
    const empty = document.createElement('div'); empty.className = 'car-empty'; empty.textContent = 'Photos will appear here'; root.appendChild(empty);
    const pop = document.createElement('div'); pop.className = 'car-pop';
    pop.innerHTML = '<img alt="" decoding="async">';
    root.appendChild(pop);
    fill();
    scrolls = [
      startScroll(grid.children[0].querySelector('.car-track'), 133, false),
      startScroll(grid.children[1].querySelector('.car-track'), 152, true),
    ];
  }

  // ---------- uploader tag (same look and 5px offset as the slideshow) ----------
  function showTag(p) {
    hideTag();
    tagEl = document.createElement('div');
    tagEl.className = 'tag';
    tagEl.setAttribute('data-brand-lock', '1');
    tagEl.textContent = p.by ? `by ${p.by}` : 'a guest';
    document.getElementById('stage').appendChild(tagEl);
    const foot = document.getElementById('foot');
    if (foot) tagEl.style.bottom = (innerHeight - foot.getBoundingClientRect().top + 5) + 'px';
  }
  function hideTag() { if (tagEl) { tagEl.remove(); tagEl = null; } }

  function focusOf(p) {
    if (p.fc && p.fc.length) {
      let sx = 0, sy = 0, sw = 0;
      for (const [x0, y0, x1, y1] of p.fc) { const a = (x1 - x0) * (y1 - y0); sx += (x0 + x1) / 2 * a; sy += (y0 + y1) / 2 * a; sw += a; }
      if (sw) return [sx / sw, sy / sw];
    }
    return [0.5, 0.42];
  }

  // ---------- pop-up: grows out of its slide, zoom in then out, back into the slide ----------
  function openPopup(p, tile, { pinned = false } = {}) {
    const pop = root.querySelector('.car-pop');
    const im = pop && pop.querySelector('img');
    if (!pop || !im) return null;
    const [fx, fy] = focusOf(p);
    const r0 = tile ? tile.getBoundingClientRect() : { left: W()*.35, top: H()*.3, width: W()*.3, height: H()*.3 };
    im.src = img(p, 1600); // 1600px is plenty on screen and keeps the zoom animation smooth (no 8K originals)
    im.style.transition = 'none';
    im.style.transform = 'scale(1.6)';   // starts zoomed-in inside the slide, zooms out as it grows
    im.style.transformOrigin = `${Math.round(fx * 100)}% ${Math.round(fy * 100)}%`;
    im.style.objectFit = 'cover';
    im.style.objectPosition = `${Math.round(fx * 100)}% ${Math.round(fy * 100)}%`;
    pop.classList.add('on');
    Object.assign(pop.style, { transition: 'none', left: r0.left + 'px', top: r0.top + 'px',
      width: r0.width + 'px', height: r0.height + 'px', borderRadius: '.5vw' });
    showTag(p);
    const iw = p.w || 3, ih = p.h || 2;
    const maxW = W() * 0.92, maxH = H() * 0.88;
    const k = Math.min(maxW / iw, maxH / ih);
    const tw = Math.round(iw * k), th = Math.round(ih * k);
    const target = { left: Math.round((W() - tw) / 2), top: Math.round((H() - th) / 2), width: tw, height: th };
    requestAnimationFrame(() => requestAnimationFrame(() => {
      pop.style.transition = 'left .8s cubic-bezier(.4,0,.2,1), top .8s cubic-bezier(.4,0,.2,1), width .8s cubic-bezier(.4,0,.2,1), height .8s cubic-bezier(.4,0,.2,1), border-radius .8s cubic-bezier(.4,0,.2,1)';
      im.style.transition = 'transform .8s cubic-bezier(.4,0,.2,1)';
      im.style.transform = 'scale(1)';
      Object.assign(pop.style, { left: target.left + 'px', top: target.top + 'px', width: target.width + 'px', height: target.height + 'px', borderRadius: '.35vw' });
    }));
    const zoomInMs = Math.max(1800, (settings().loopSec || 5) * 380);
    const zoomOutMs = Math.max(1400, (settings().loopSec || 5) * 300);
    const holdMs = 350;
    setTimeout(() => {
      im.style.transition = `transform ${zoomInMs}ms cubic-bezier(.4,0,.2,1)`;
      im.style.transformOrigin = `${Math.round(fx * 100)}% ${Math.round(fy * 100)}%`;
      im.style.transform = `scale(${reduce ? 1 : R(1.26, 1.34)})`;
      setTimeout(() => {
        if (pinned) return; // pinned stays zoomed until released
        im.style.transition = `transform ${zoomOutMs}ms cubic-bezier(.4,0,.2,1)`;
        im.style.transform = 'scale(1)';
      }, zoomInMs + holdMs);
    }, 820);
    return { pop, im, r0, zoomInMs, zoomOutMs, holdMs, pinned };
  }
  function closePopup(handle, done) {
    if (!handle) return;
    const { pop, im } = handle;
    im.style.transition = 'transform .7s cubic-bezier(.4,0,.2,1)';
    im.style.transform = 'scale(1.5)';   // zooms in as it shrinks back into the slide
    setTimeout(() => {
      const id = pop.dataset.id;
      const tile = id ? grid && grid.querySelector(`.car-tile[data-id="${id}"]`) : null;
      const r = tile ? tile.getBoundingClientRect() : handle.r0;
      pop.style.transition = 'left .7s cubic-bezier(.4,0,.2,1), top .7s cubic-bezier(.4,0,.2,1), width .7s cubic-bezier(.4,0,.2,1), height .7s cubic-bezier(.4,0,.2,1), border-radius .7s cubic-bezier(.4,0,.2,1)';
      im.style.transition = 'transform .7s cubic-bezier(.4,0,.2,1)';
      im.style.transform = 'scale(1.5)';
      Object.assign(pop.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', borderRadius: '.5vw' });
      hideTag();
      setTimeout(() => { pop.classList.remove('on'); im.style.transition = 'none'; im.style.transform = 'none'; im.style.objectPosition = '50% 50%'; if (done) done(); }, reduce ? 80 : 520);
    }, reduce ? 60 : 620);
  }

  // ---------- pick the column photo sitting at the vertical centre, then pop ----------
  function nearestToCentre(colIdx) {
    const col = grid && grid.children[colIdx]; if (!col) return null;
    let best = null, bd = Infinity; const hc = H() / 2;
    for (const t of col.querySelectorAll('.car-tile')) {
      const r = t.getBoundingClientRect(); if (r.height <= 0) continue;
      const d = Math.abs(r.top + r.height / 2 - hc);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
  function requestPop() {
    if (busy || pinnedId || !grid) return;
    const colIdx = nextCol;
    const attempt = () => {
      pendingPop = null;
      if (busy || pinnedId) return;
      const tile = nearestToCentre(colIdx);
      if (!tile) return;
      const r = tile.getBoundingClientRect();
      const centreOffset = Math.abs((r.top + r.height / 2) - H() / 2);
      if (centreOffset <= H() * 0.075) doPop(tile, colIdx); // wait until it reaches the middle of the strip
      else pendingPop = setTimeout(attempt, 200);
    };
    attempt();
  }
  function doPop(tile, colIdx) {
    const ps = list();
    const p = ps.find((x) => x.id === tile.dataset.id);
    if (!p) return;
    nextCol = 1 - colIdx;
    busy = true;
    easePause(scrolls[colIdx]); // ease the chosen column to a stop (not a hard snap)
    const pop = root.querySelector('.car-pop');
    if (!pop) { busy = false; return; }
    pop.dataset.id = p.id;
    popHandle = openPopup(p, tile);
    if (!popHandle) { busy = false; easeResume(scrolls[colIdx]); return; }
    popTimer = setTimeout(() => {
      closePopup(popHandle, () => {
        popHandle = null;
        easeResume(scrolls[colIdx]);
        busy = false; popTimer = null;
      });
    }, 840 + popHandle.zoomInMs + popHandle.holdMs + popHandle.zoomOutMs);
  }
  function scheduleIdle(ms = 5000) {
    clearTimeout(idleTimer);
    if (pendingPop) { clearTimeout(pendingPop); pendingPop = null; }
    idleTimer = setTimeout(() => { requestPop(); scheduleIdle(5000); }, ms);
  }

  return {
    mount(el) { root = el; build(); scheduleIdle(5000); },
    refresh() { fill(); },
    add(p) {
      if (!grid || !grid.children.length) return fill();
      const colIdx = Math.floor(Math.random() * grid.children.length);
      const track = grid.children[colIdx].querySelector('.car-track');
      if (!track.children.length) return fill();
      const node = document.createElement('div'); node.innerHTML = tileHtml(p, 'in'); const tile = node.firstElementChild;
      const twin = tile.cloneNode(true);
      track.insertBefore(tile, track.children[0]);
      track.insertBefore(twin, track.children[per] || null);
      emptyState();
      scheduleIdle(5000); // a new photo resets the idle clock; it does not pop
    },
    remove(id) { grid && grid.querySelectorAll(`.car-tile[data-id="${id}"]`).forEach((t) => t.remove()); emptyState(); },
    pin(pin) {
      if (!pin) {
        pinnedId = null;
        clearTimeout(popTimer); busy = false;
        if (popHandle) { closePopup(popHandle, () => { popHandle = null; }); popHandle = null; }
        hideTag();
        scrolls.forEach(easeResume);
        scheduleIdle(5000);
        return;
      }
      pinnedId = pin.id || null;
      clearTimeout(idleTimer); clearTimeout(popTimer);
      scrolls.forEach(easePause);
      const p = ctx.photoById(pin.id); if (!p) return;
      const col = grid.children[0].querySelector(`.car-tile[data-id="${p.id}"]`) ? 0 : 1;
      const tile = (grid.children[col] || grid.children[0]).querySelector(`.car-tile[data-id="${p.id}"]`);
      const pop = root.querySelector('.car-pop');
      if (pop) pop.dataset.id = p.id;
      popHandle = openPopup(p, tile, { pinned: true });
    },
    destroy() {
      clearTimeout(idleTimer); clearTimeout(popTimer); if (pendingPop) clearTimeout(pendingPop);
      hideTag();
      scrolls.forEach((s) => { try { s.anim.cancel(); } catch { /* ignore */ } });
      scrolls = [];
      if (root) root.innerHTML = '';
      grid = null;
    },
  };
}
