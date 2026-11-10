
// CCAM big-screen module: cinema
// A huge hero photo with a slowly moving filmstrip underneath. New photos fly in from an edge into
// the strip and then take over the hero; a pinned photo pops up full screen and returns to the strip.
// Contract: export default create(ctx) -> { mount, refresh, add, remove, pin, destroy }.
export default function create(ctx) {
  const { photos, img, pick, R, reduce, settings } = ctx;
  const W = () => innerWidth, H = () => innerHeight;
  let root, heroBox, heroImg, track, cycle = 0, pinnedId = null;

  function injectCss() {
    if (document.getElementById('mod-cinema-css')) return;
    const st = document.createElement('style'); st.id = 'mod-cinema-css';
    st.textContent = `
      .cine-hero { position:absolute; inset:0 0 23vh 0; overflow:hidden; background:#06090b; }
      .cine-hero img { width:100%; height:100%; object-fit:cover; display:block; }
      .cine-hero::after { content:""; position:absolute; inset:0; pointer-events:none; background:linear-gradient(180deg, rgba(0,0,0,.05), rgba(0,0,0,.25) 55%, rgba(6,9,11,.85)); }
      .cine-strip { position:absolute; left:0; right:0; bottom:0; height:23vh; display:flex; align-items:center; padding:1.6vh 0; overflow:hidden; background:rgba(6,9,11,.94); border-top:1px solid rgba(255,255,255,.08); }
      .cine-track { display:flex; gap:.6vw; animation:cineLeft 70s linear infinite; }
      .cine-track.paused { animation-play-state:paused; }
      @keyframes cineLeft { from { transform:translateX(0); } to { transform:translateX(-50%); } }
      .cine-tile { flex:none; height:19vh; aspect-ratio:3/2; overflow:hidden; border-radius:.5vw; opacity:.5; transition:opacity .35s, transform .35s; }
      .cine-tile.on { opacity:1; transform:scale(1.04); }
      .cine-tile img { width:100%; height:100%; object-fit:cover; display:block; }
      .cine-empty { position:absolute; inset:0; display:grid; place-items:center; color:#9fb0b2; font-size:max(16px,1.6vw); z-index:2; }
    `;
    document.head.appendChild(st);
  }
  function tileHtml(p) { return `<div class="cine-tile" data-id="${p.id}"><img src="${img(p,480)}" alt="" loading="lazy"></div>`; }
  function emptyState() { const el = root && root.querySelector('.cine-empty'); if (el) el.style.display = photos().length ? 'none' : ''; }
  function highlight(id) { track && track.querySelectorAll('.cine-tile').forEach((t) => t.classList.toggle('on', t.dataset.id === id)); }
  function show(p) { if (!heroImg || !p) return; heroImg.src = img(p); heroImg.dataset.id = p.id; highlight(p.id); }
  function fill() {
    if (!track) return;
    const list = photos();
    const html = list.map(tileHtml).join('');
    track.innerHTML = html + html;
    if (list.length) show(list[0]);
    emptyState();
    clearInterval(cycle);
    if (list.length > 1) cycle = setInterval(() => {
      if (pinnedId) return;
      const cur = photos(); if (!cur.length) return;
      show(pick(cur));
    }, Math.max(6000, (settings().loopSec || 5) * 1000));
  }
  function fly(p, tile) {
    const r = tile.getBoundingClientRect();
    tile.style.visibility = 'hidden';
    const f = document.createElement('div'); f.className = 'car-fly';
    f.innerHTML = `<img src="${img(p)}" alt="">`;
    const w = W(), h = H();
    const from = pick([{ x: -.4*w, y: h*.3 }, { x: 1.4*w, y: h*.3 }, { x: w*.3, y: -.4*h }, { x: w*.3, y: 1.4*h }]);
    f.style.cssText = `position:absolute;z-index:8;overflow:hidden;border-radius:.8vw;pointer-events:none;box-shadow:0 2vw 7vw rgba(0,0,0,.65);background:#1a2125;left:${from.x}px;top:${from.y}px;width:${w*.45}px;height:${h*.45}px`;
    root.appendChild(f);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      f.style.transition = 'left 1s cubic-bezier(.2,.8,.2,1), top 1s cubic-bezier(.2,.8,.2,1), width 1s cubic-bezier(.2,.8,.2,1), height 1s cubic-bezier(.2,.8,.2,1)';
      f.style.left = r.left+'px'; f.style.top = r.top+'px'; f.style.width = r.width+'px'; f.style.height = r.height+'px';
    }));
    setTimeout(() => { f.remove(); tile.style.visibility = ''; }, reduce ? 200 : 1050);
  }
  function popup(p) {
    const ov = document.getElementById('modOverlay'), im = document.getElementById('modOverlayImg');
    if (!ov || !im) return;
    const tile = track && track.querySelector(`.cine-tile[data-id="${p.id}"]`);
    const R0 = tile ? tile.getBoundingClientRect() : { left: W()*.35, top: H()*.35, width: W()*.3, height: H()*.3 };
    im.src = img(p);
    Object.assign(im.style, { transition:'none', left:R0.left+'px', top:R0.top+'px', width:R0.width+'px', height:R0.height+'px', objectFit:'cover' });
    ov.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      im.style.transition = 'left .55s cubic-bezier(.2,.8,.2,1), top .55s cubic-bezier(.2,.8,.2,1), width .55s cubic-bezier(.2,.8,.2,1), height .55s cubic-bezier(.2,.8,.2,1)';
      Object.assign(im.style, { left:'0px', top:'0px', width:W()+'px', height:H()+'px', objectFit:'contain' });
    }));
  }
  return {
    mount(el) {
      root = el; injectCss();
      heroBox = document.createElement('div'); heroBox.className = 'cine-hero';
      heroImg = document.createElement('img'); heroBox.appendChild(heroImg); root.appendChild(heroBox);
      const strip = document.createElement('div'); strip.className = 'cine-strip';
      track = document.createElement('div'); track.className = 'cine-track';
      strip.appendChild(track); root.appendChild(strip);
      const empty = document.createElement('div'); empty.className = 'cine-empty'; empty.textContent = 'Photos will appear here'; root.appendChild(empty);
    },
    refresh() { fill(); },
    add(p) {
      if (!track) return;
      const wrap = document.createElement('div'); wrap.innerHTML = tileHtml(p);
      const node = wrap.firstElementChild; const twin = node.cloneNode(true);
      track.insertBefore(node, track.firstChild);
      track.insertBefore(twin, track.children[Math.ceil(track.children.length / 2)] || null);
      emptyState();
      fly(p, node);
      setTimeout(() => { if (pinnedId) return; show(p); }, reduce ? 200 : 1050);
      setTimeout(() => { if (pinnedId) return; const list = photos(); if (list.length) show(pick(list)); }, Math.max(6000, (settings().newSec || 3) * 1000));
    },
    remove(id) { track && track.querySelectorAll(`.cine-tile[data-id="${id}"]`).forEach((t) => t.remove()); emptyState(); },
    pin(pin) {
      if (!pin) { pinnedId = null; ctx.closeOverlay(); track && track.classList.remove('paused'); return; }
      pinnedId = pin.id || null;
      track && track.classList.add('paused');
      const p = ctx.photoById(pin.id); if (p) { show(p); popup(p); }
    },
    destroy() { clearInterval(cycle); if (root) root.innerHTML = ''; }
  };
}
