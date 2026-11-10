// CCAM big-screen module: carousel
// Two vertical columns (left/right) scrolling in opposite directions, filling the screen with photos.
// A new photo slides straight into a column (no pop-up). When nothing new has arrived for ~5 s, a random
// photo pops out to full screen, zooms ~30% towards its faces / upper-middle, then goes back.
// Contract: export default create(ctx) -> { mount, refresh, add, remove, pin, destroy }.
export default function create(ctx) {
  const { photos, img, pick, R, reduce, settings } = ctx;
  const W = () => innerWidth, H = () => innerHeight;
  let root, grid, per = 4, pinnedId = null, idleTimer = null, popTimer = null, popEl = null, tagEl = null, busy = false;

  function injectCss() {
    if (document.getElementById('mod-carousel-css')) return;
    const st = document.createElement('style'); st.id = 'mod-carousel-css';
    st.textContent = `
      .car-grid { position:absolute; inset:0; display:flex; gap:.7vw; padding:.7vw; }
      .car-col { flex:1 1 0; min-width:0; overflow:hidden; border-radius:.6vw; }
      .car-track { display:flex; flex-direction:column; gap:.7vw; animation:carUp var(--speed,60s) linear infinite; }
      .car-col:nth-child(2) .car-track { animation-direction:reverse; }
      @keyframes carUp { from { transform: translateY(0); } to { transform: translateY(-50%); } }
      .car-track.paused { animation-play-state:paused; }
      .car-tile { position:relative; flex:none; aspect-ratio:4/3; overflow:hidden; border-radius:.5vw; background:#1a2125; }
      .car-tile img { width:100%; height:100%; object-fit:cover; display:block; }
      .car-tile.in { animation:carIn .6s cubic-bezier(.2,.8,.2,1); }
      @keyframes carIn { from { opacity:0; transform:scale(.86) translateY(-1.5vw); } to { opacity:1; transform:none; } }
      .car-empty { position:absolute; inset:0; display:grid; place-items:center; color:#9fb0b2; font-size:max(16px,1.6vw); z-index:2; }
      /* photo popping out of the carousel: full screen, slow zoom towards the faces */
      .car-pop { position:absolute; inset:0; z-index:5; display:none; overflow:hidden; background:#05080a; }
      .car-pop.on { display:block; }
      .car-pop img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; will-change:transform; }
    `;
    document.head.appendChild(st);
  }
  const list = () => photos();
  function tileHtml(p, cls = '') { return `<div class="car-tile ${cls}" data-id="${p.id}"><img src="${img(p, 480)}" alt="" loading="lazy"></div>`; }
  function emptyState() { const el = root && root.querySelector('.car-empty'); if (el) el.style.display = list().length ? 'none' : ''; }

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
    // exactly two rows/columns: left and right
    for (let c = 0; c < 2; c++) {
      const col = document.createElement('div'); col.className = 'car-col';
      const track = document.createElement('div'); track.className = 'car-track';
      track.style.setProperty('--speed', (c === 0 ? 58 : 66) + 's');
      col.appendChild(track); grid.appendChild(col);
    }
    root.appendChild(grid);
    const empty = document.createElement('div'); empty.className = 'car-empty'; empty.textContent = 'Photos will appear here'; root.appendChild(empty);
    const pop = document.createElement('div'); pop.className = 'car-pop';
    pop.innerHTML = '<img alt="">';
    root.appendChild(pop);
    fill();
  }

  // ---- idle pop-up: random photo, zoom towards faces, then back to the carousel ----
  function resizeTag() {
    if (!tagEl) return;
    const foot = document.getElementById('foot');
    if (foot) tagEl.style.bottom = (innerHeight - foot.getBoundingClientRect().top + 5) + 'px';
  }
  function showTag(p) {
    hideTag();
    tagEl = document.createElement('div');
    tagEl.className = 'tag';
    tagEl.setAttribute('data-brand-lock', '1');
    tagEl.innerHTML = (p.by ? `by ${String(p.by)}` : 'a guest');
    document.getElementById('stage').appendChild(tagEl);
    resizeTag();
  }
  function hideTag() { if (tagEl) { tagEl.remove(); tagEl = null; } }

  function focusOf(p) {
    if (p.fc && p.fc.length) {
      let sx = 0, sy = 0, sw = 0;
      for (const [x0, y0, x1, y1] of p.fc) { const a = (x1 - x0) * (y1 - y0); sx += (x0 + x1) / 2 * a; sy += (y0 + y1) / 2 * a; sw += a; }
      if (sw) return [sx / sw, sy / sw];
    }
    return [0.5, 0.42]; // faces usually middle / upper-middle
  }
  function popOut() {
    if (busy || pinnedId || !grid) return;
    const ps = list();
    if (ps.length < 2) return;
    const p = pick(ps);
    const tile = grid.querySelector(`.car-tile[data-id="${p.id}"]`);
    const pop = root.querySelector('.car-pop');
    const im = pop.querySelector('img');
    if (!pop || !im) return;
    busy = true;
    const r0 = tile ? tile.getBoundingClientRect() : { left: W()*.3, top: H()*.3, width: W()*.4, height: H()*.4 };
    im.style.transition = 'none';
    im.style.transform = 'none';
    im.src = img(p);
    pop.classList.add('on');
    im.style.objectFit = 'cover';
    im.style.clipPath = `inset(${r0.top}px ${W() - r0.left - r0.width}px ${H() - r0.top - r0.height}px ${r0.left}px)`;
    void im.offsetWidth;
    im.style.transition = 'clip-path .55s cubic-bezier(.2,.8,.2,1)';
    im.style.clipPath = 'inset(0 0 0 0)';
    showTag(p);
    const [fx, fy] = focusOf(p);
    const zoomMs = Math.max(2500, (settings().loopSec || 5) * 900);
    setTimeout(() => {
      im.style.transition = `transform ${zoomMs}ms cubic-bezier(.25,.6,.3,1)`;
      im.style.transformOrigin = `${Math.round(fx * 100)}% ${Math.round(fy * 100)}%`;
      im.style.transform = `scale(${reduce ? 1 : R(1.26, 1.34)})`;
    }, 620);
    popTimer = setTimeout(() => {
      im.style.transition = 'clip-path .5s cubic-bezier(.2,.8,.2,1)';
      im.style.clipPath = `inset(${r0.top}px ${W() - r0.left - r0.width}px ${H() - r0.top - r0.height}px ${r0.left}px)`;
      hideTag();
      setTimeout(() => { pop.classList.remove('on'); im.style.transition = 'none'; im.style.transform = 'none'; im.style.clipPath = 'none'; busy = false; popTimer = null; }, reduce ? 100 : 520);
    }, 620 + zoomMs);
  }
  function scheduleIdle(ms = 5000) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!pinnedId && !busy) popOut();
      scheduleIdle(5000);
    }, ms);
  }

  return {
    mount(el) { root = el; build(); scheduleIdle(5000); },
    refresh() { fill(); },
    add(p) {
      if (!grid || !grid.children.length) return fill();
      const col = grid.children[Math.floor(Math.random() * grid.children.length)];
      const track = col.querySelector('.car-track');
      if (!track.children.length) return fill();
      const node = document.createElement('div'); node.innerHTML = tileHtml(p, 'in'); const tile = node.firstElementChild;
      const twin = tile.cloneNode(true);
      track.insertBefore(tile, track.children[0]);
      track.insertBefore(twin, track.children[per] || null);
      emptyState();
      // a new photo resets the idle pop-up clock; the photo itself just slides in, no pop-up
      scheduleIdle(5000);
    },
    remove(id) { grid && grid.querySelectorAll(`.car-tile[data-id="${id}"]`).forEach((t) => t.remove()); emptyState(); },
    pin(pin) {
      if (!pin) {
        pinnedId = null;
        clearTimeout(popTimer); busy = false;
        const pop = root.querySelector('.car-pop'); if (pop) pop.classList.remove('on');
        hideTag();
        grid && grid.querySelectorAll('.car-track').forEach((t) => t.classList.remove('paused'));
        scheduleIdle(5000);
        return;
      }
      pinnedId = pin.id || null;
      clearTimeout(idleTimer); clearTimeout(popTimer);
      const pop = root.querySelector('.car-pop'); if (pop) pop.classList.remove('on');
      busy = false;
      grid && grid.querySelectorAll('.car-track').forEach((t) => t.classList.add('paused'));
      const p = ctx.photoById(pin.id); if (!p) return;
      // pinned photo: same pop-up style, but it stays until released
      const im = root.querySelector('.car-pop img'); const popEl2 = root.querySelector('.car-pop');
      if (!im || !popEl2) return;
      const tile = grid.querySelector(`.car-tile[data-id="${p.id}"]`);
      const r0 = tile ? tile.getBoundingClientRect() : { left: W()*.3, top: H()*.3, width: W()*.4, height: H()*.4 };
      im.src = img(p); im.style.transition = 'none'; im.style.transform = 'none'; im.style.clipPath = 'none';
      popEl2.classList.add('on'); showTag(p);
      const [fx, fy] = focusOf(p);
      im.style.objectFit = 'cover';
      im.style.clipPath = `inset(${r0.top}px ${W() - r0.left - r0.width}px ${H() - r0.top - r0.height}px ${r0.left}px)`;
      void im.offsetWidth;
      im.style.transition = 'clip-path .55s cubic-bezier(.2,.8,.2,1)';
      im.style.clipPath = 'inset(0 0 0 0)';
      setTimeout(() => { im.style.transition = 'transform 6s cubic-bezier(.25,.6,.3,1)'; im.style.transformOrigin = `${Math.round(fx*100)}% ${Math.round(fy*100)}%`; im.style.transform = `scale(${reduce ? 1 : 1.3})`; }, 600);
    },
    destroy() {
      clearTimeout(idleTimer); clearTimeout(popTimer); hideTag();
      if (popEl) { try { popEl.remove(); } catch { /* ignore */ } }
      if (root) root.innerHTML = '';
      grid = null;
    },
  };
}
