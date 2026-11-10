
// CCAM big-screen module: carousel
// A full-screen grid of columns that scroll upwards (alternating directions). A new photo flies in
// from a random edge, oversized, drops into its tile; a pinned photo pops up full screen.
// Contract: export default create(ctx) -> { mount, refresh, add, remove, pin, destroy }.
export default function create(ctx) {
  const { photos, img, pick, R, reduce } = ctx;
  const W = () => innerWidth, H = () => innerHeight;
  let root, grid, per = 4, pinnedId = null, ovFrom = null;

  function injectCss() {
    if (document.getElementById('mod-carousel-css')) return;
    const st = document.createElement('style'); st.id = 'mod-carousel-css';
    st.textContent = `
      .car-grid { position:absolute; inset:0; display:flex; gap:.7vw; padding:.7vw; }
      .car-col { flex:1 1 0; min-width:0; overflow:hidden; border-radius:.6vw; }
      .car-track { display:flex; flex-direction:column; gap:.7vw; animation:carUp var(--speed,50s) linear infinite; }
      .car-col:nth-child(even) .car-track { animation-direction:reverse; }
      @keyframes carUp { from { transform: translateY(0); } to { transform: translateY(-50%); } }
      .car-track.paused { animation-play-state:paused; }
      .car-tile { position:relative; flex:none; aspect-ratio:4/3; overflow:hidden; border-radius:.5vw; background:#1a2125; }
      .car-tile img { width:100%; height:100%; object-fit:cover; display:block; }
      .car-tile.pinned { outline:3px solid #6cc4b9; outline-offset:-3px; }
      .car-fly { position:absolute; z-index:8; overflow:hidden; border-radius:.8vw; pointer-events:none; box-shadow:0 2vw 7vw rgba(0,0,0,.65); background:#1a2125; }
      .car-fly img { width:100%; height:100%; object-fit:cover; display:block; }
      .car-empty { position:absolute; inset:0; display:grid; place-items:center; color:#9fb0b2; font-size:max(16px,1.6vw); z-index:2; }
    `;
    document.head.appendChild(st);
  }
  function tileHtml(p) { return `<div class="car-tile" data-id="${p.id}"><img src="${img(p,480)}" alt="" loading="lazy"></div>`; }
  function emptyState() { const el = root && root.querySelector('.car-empty'); if (el) el.style.display = photos().length ? 'none' : ''; }

  function fill() {
    if (!grid) return;
    const list = photos();
    const cols = grid.children.length || 5;
    per = Math.max(4, Math.ceil((list.length || 1) * 2 / cols));
    [...grid.children].forEach((col, c) => {
      const track = col.querySelector('.car-track');
      const items = [];
      for (let i = 0; i < per; i++) { if (!list.length) break; items.push(tileHtml(list[(c * 2 + i) % list.length])); }
      track.innerHTML = items.join('') + items.join('');
    });
    emptyState();
  }
  function build() {
    injectCss();
    const cols = innerHeight > innerWidth ? 3 : 5;
    grid = document.createElement('div'); grid.className = 'car-grid';
    for (let c = 0; c < cols; c++) {
      const col = document.createElement('div'); col.className = 'car-col';
      const track = document.createElement('div'); track.className = 'car-track';
      track.style.setProperty('--speed', (36 + c * 9) + 's');
      col.appendChild(track); grid.appendChild(col);
    }
    root.appendChild(grid);
    const empty = document.createElement('div'); empty.className = 'car-empty'; empty.textContent = 'Photos will appear here'; root.appendChild(empty);
    fill();
  }
  function fly(p, tile, big) {
    const r = tile.getBoundingClientRect();
    tile.style.visibility = 'hidden';
    const f = document.createElement('div'); f.className = 'car-fly';
    f.innerHTML = `<img src="${img(p)}" alt="">`;
    const w = W(), h = H();
    const from = pick([{ x: -.55 * w, y: R(.1,.8)*h }, { x: 1.55*w, y: R(.1,.8)*h }, { x: R(.1,.8)*w, y: -.55*h }, { x: R(.1,.8)*w, y: 1.55*h }]);
    f.style.cssText = `left:${from.x}px;top:${from.y}px;width:${w*.5}px;height:${h*.5}px`;
    root.appendChild(f);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      f.style.transition = 'left 1.05s cubic-bezier(.2,.8,.2,1), top 1.05s cubic-bezier(.2,.8,.2,1), width 1.05s cubic-bezier(.2,.8,.2,1), height 1.05s cubic-bezier(.2,.8,.2,1), border-radius .5s';
      f.style.left = r.left+'px'; f.style.top = r.top+'px'; f.style.width = r.width+'px'; f.style.height = r.height+'px';
    }));
    setTimeout(() => { f.remove(); tile.style.visibility = ''; }, reduce ? 200 : 1150);
  }
  function popup(p) {
    const ov = document.getElementById('modOverlay'), im = document.getElementById('modOverlayImg');
    if (!ov || !im) return;
    const tile = grid.querySelector(`.car-tile[data-id="${p.id}"]`);
    const R0 = tile ? tile.getBoundingClientRect() : { left: W()*.35, top: H()*.35, width: W()*.3, height: H()*.3 };
    ovFrom = { left: R0.left, top: R0.top, width: R0.width, height: R0.height };
    im.src = img(p);
    Object.assign(im.style, { transition:'none', left:ovFrom.left+'px', top:ovFrom.top+'px', width:ovFrom.width+'px', height:ovFrom.height+'px', objectFit:'cover' });
    ov.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      im.style.transition = 'left .55s cubic-bezier(.2,.8,.2,1), top .55s cubic-bezier(.2,.8,.2,1), width .55s cubic-bezier(.2,.8,.2,1), height .55s cubic-bezier(.2,.8,.2,1)';
      Object.assign(im.style, { left:'0px', top:'0px', width:W()+'px', height:H()+'px', objectFit:'contain' });
    }));
    if (tile) { tile.classList.add('pinned'); setTimeout(() => tile.classList.remove('pinned'), 900); }
  }
  return {
    mount(el) { root = el; build(); },
    refresh() { fill(); },
    add(p) {
      if (!grid || !grid.children.length) return fill();
      const col = grid.children[Math.floor(Math.random() * grid.children.length)];
      const track = col.querySelector('.car-track');
      if (!track.children.length) return fill();
      const node = document.createElement('div'); node.innerHTML = tileHtml(p); const tile = node.firstElementChild;
      const twin = tile.cloneNode(true);
      track.insertBefore(tile, track.children[0]);
      track.insertBefore(twin, track.children[per] || null);
      emptyState();
      fly(p, tile);
    },
    remove(id) { grid && grid.querySelectorAll(`.car-tile[data-id="${id}"]`).forEach((t) => t.remove()); emptyState(); },
    pin(pin) {
      if (!pin) { ctx.closeOverlay(); grid && grid.querySelectorAll('.car-track').forEach((t) => t.classList.remove('paused')); return; }
      grid && grid.querySelectorAll('.car-track').forEach((t) => t.classList.add('paused'));
      const p = ctx.photoById(pin.id); if (p) popup(p);
    },
    destroy() { if (root) root.innerHTML = ''; grid = null; },
  };
}
