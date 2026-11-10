// CCAM big-screen module: cinema
// Horizontal rows of photos sliding left → right across the screen. A new photo drops in from a random
// edge (top / bottom / left / right), grows big in the middle, then slots into a gap in one of the rows.
// A pinned photo pauses the rows and pops up (original-quality, photo aspect, face-safe zoom).
// Contract: export default create(ctx) -> { mount, refresh, add, remove, pin, destroy }.
export default function create(ctx) {
  const { photos, img, pick, R, reduce, settings } = ctx;
  const W = () => innerWidth, H = () => innerHeight;
  let root, rowsBox, rows = [], tagEl = null, pinHandle = null, popTimer = null, pinnedId = null;

  function injectCss() {
    if (document.getElementById('mod-cinema-css')) return;
    const st = document.createElement('style'); st.id = 'mod-cinema-css';
    st.textContent = `
      .cine-rows { position:absolute; inset:0; display:flex; flex-direction:column; gap:.5vw; padding:.5vw 0; overflow:hidden; }
      .cine-row { flex:1 1 0; min-height:0; overflow:hidden; }
      .cine-track { display:flex; gap:.5vw; height:100%; will-change:transform; }
      .cine-tile { position:relative; flex:none; height:100%; aspect-ratio:4/3; overflow:hidden; border-radius:.5vw; background:#1a2125; }
      .cine-tile img { width:100%; height:100%; object-fit:cover; display:block; }
      .cine-tile.in { animation:cineIn .6s cubic-bezier(.4,0,.2,1); }
      @keyframes cineIn { from { opacity:0; transform:scale(.9); } to { opacity:1; transform:none; } }
      .cine-empty { position:absolute; inset:0; display:grid; place-items:center; color:#9fb0b2; font-size:max(16px,1.6vw); z-index:2; }
      .cine-fly { position:absolute; z-index:8; overflow:hidden; border-radius:.6vw; pointer-events:none;
        box-shadow:0 2vw 8vw rgba(0,0,0,.6); background:#1a2125; will-change:left,top,width,height,transform; }
      .cine-fly img { width:100%; height:100%; object-fit:cover; display:block; }
      .cine-pop { position:absolute; z-index:5; display:none; overflow:hidden; background:transparent;
        box-shadow:0 2vw 8vw rgba(0,0,0,.55); will-change:left,top,width,height; }
      .cine-pop.on { display:block; }
      .cine-pop img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; will-change:transform; }
    `;
    document.head.appendChild(st);
  }
  const list = () => photos();
  const tileHtml = (p, cls = '') => `<div class="cine-tile ${cls}" data-id="${p.id}"><img src="${img(p, 480)}" alt="" loading="lazy" decoding="async"></div>`;
  function emptyState() { const el = root && root.querySelector('.cine-empty'); if (el) el.style.display = list().length ? 'none' : ''; }

  function startRow(track, secs, reverse) {
    const frames = reverse
      ? [{ transform: 'translateX(-50%)' }, { transform: 'translateX(0)' }]
      : [{ transform: 'translateX(0)' }, { transform: 'translateX(-50%)' }];
    const anim = track.animate(frames, { duration: secs * 1000, iterations: Infinity, easing: 'linear' });
    return { track, anim };
  }
  function fill() {
    if (!rowsBox) return;
    const ps = list();
    const n = rows.length || 1;
    [...rowsBox.children].forEach((row, r) => {
      const track = row.querySelector('.cine-track');
      const per = Math.max(3, Math.ceil((ps.length || 1) * 2 / n));
      const items = [];
      for (let i = 0; i < per; i++) { if (!ps.length) break; items.push(tileHtml(ps[(r * 2 + i) % ps.length])); }
      track.innerHTML = items.join('') + items.join('');
    });
    emptyState();
  }
  function build() {
    injectCss();
    rowsBox = document.createElement('div'); rowsBox.className = 'cine-rows';
    const n = innerHeight > innerWidth ? 2 : 3;
    for (let r = 0; r < n; r++) {
      const row = document.createElement('div'); row.className = 'cine-row';
      const track = document.createElement('div'); track.className = 'cine-track';
      row.appendChild(track); rowsBox.appendChild(row);
    }
    root.appendChild(rowsBox);
    const empty = document.createElement('div'); empty.className = 'cine-empty'; empty.textContent = 'Photos will appear here'; root.appendChild(empty);
    const pop = document.createElement('div'); pop.className = 'cine-pop';
    pop.innerHTML = '<img alt="" decoding="async">';
    root.appendChild(pop);
    fill();
    // left → right: all rows drift rightwards (the reversed keyframes move content right)
    rows = [];
    [...rowsBox.children].forEach((row, r) => {
      const track = row.querySelector('.cine-track');
      rows.push(startRow(track, 70 + r * 18, true));
    });
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

  // ---- new photo: drop in from a random edge, grow big, then slot into a gap ----
  function dropIn(p) {
    if (!rowsBox) return;
    const rowIdx = Math.floor(Math.random() * rowsBox.children.length);
    const row = rowsBox.children[rowIdx];
    const track = row.querySelector('.cine-track');
    if (!track || !track.children.length) return fill();
    const kids = [...track.children];
    const half = Math.floor(kids.length / 2);
    const per = Math.max(1, half);
    // only slot into a gap that is currently on screen, so the photo visibly joins the row
    const visible = kids.slice(0, half).filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.left > W() * 0.05 && r.left < W() * 0.85;
    });
    const anchor = visible.length ? pick(visible) : (kids[1 + Math.floor(Math.random() * Math.max(1, per - 1))] || kids[0]);
    const at = Math.max(0, kids.indexOf(anchor));
    const node = document.createElement('div'); node.innerHTML = tileHtml(p, 'in'); const tile = node.firstElementChild;
    tile.style.visibility = 'hidden';
    const twin = tile.cloneNode(true); twin.style.visibility = 'hidden';
    track.insertBefore(tile, anchor || null);
    track.insertBefore(twin, track.children[at + per] || null);
    emptyState();
    showTag(p);
    // flyer starts small at a random edge
    const edge = pick(['top', 'bottom', 'left', 'right']);
    const w0 = 16 * W() / 100, h0 = w0 * 0.75;
    let x0, y0;
    if (edge === 'top') { x0 = R(0.1, 0.8) * W(); y0 = -h0; }
    else if (edge === 'bottom') { x0 = R(0.1, 0.8) * W(); y0 = H(); }
    else if (edge === 'left') { x0 = -w0; y0 = R(0.1, 0.8) * H(); }
    else { x0 = W(); y0 = R(0.1, 0.8) * H(); }
    const fly = document.createElement('div'); fly.className = 'cine-fly';
    fly.innerHTML = `<img src="${img(p, 1600)}" alt="">`;
    Object.assign(fly.style, { left: x0 + 'px', top: y0 + 'px', width: w0 + 'px', height: h0 + 'px', transition: 'none', opacity: '0' });
    root.appendChild(fly);
    // 1) appear at the edge and grow big in the middle
    const bigW = Math.min(W() * 0.5, 900), bigH = bigW * 0.75;
    const bigX = (W() - bigW) / 2, bigY = (H() - bigH) / 2;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      Object.assign(fly.style, { opacity: '1', transition: `left .45s cubic-bezier(.4,0,.2,1), top .45s cubic-bezier(.4,0,.2,1), width .45s cubic-bezier(.4,0,.2,1), height .45s cubic-bezier(.4,0,.2,1), opacity .25s ease-out` });
      Object.assign(fly.style, { left: bigX + 'px', top: bigY + 'px', width: bigW + 'px', height: bigH + 'px' });
    }));
    // 2) then slide into the gap between two photos
    setTimeout(() => {
      const t2 = tile.getBoundingClientRect(); // measure again: the row has moved since the drop started
      Object.assign(fly.style, { transition: `left .75s cubic-bezier(.4,0,.2,1), top .75s cubic-bezier(.4,0,.2,1), width .75s cubic-bezier(.4,0,.2,1), height .75s cubic-bezier(.4,0,.2,1), border-radius .5s` });
      Object.assign(fly.style, { left: t2.left + 'px', top: t2.top + 'px', width: t2.width + 'px', height: t2.height + 'px', borderRadius: '.5vw' });
    }, reduce ? 120 : 520);
    setTimeout(() => {
      fly.remove();
      tile.style.visibility = ''; twin.style.visibility = '';
    }, reduce ? 300 : 1320);
  }

  function faceSafeScale(p, f, desired) {
    let sMax = desired;
    if (p.fc && p.fc.length) {
      const m = 0.02;
      for (const [x0, y0, x1, y1] of p.fc) {
        for (const ux of [x0, x1]) {
          const dx = ux - f[0];
          if (dx > 0.001) sMax = Math.min(sMax, (1 - m - f[0]) / dx);
          else if (dx < -0.001) sMax = Math.min(sMax, (f[0] - m) / (-dx));
        }
        for (const uy of [y0, y1]) {
          const dy = uy - f[1];
          if (dy > 0.001) sMax = Math.min(sMax, (1 - m - f[1]) / dy);
          else if (dy < -0.001) sMax = Math.min(sMax, (f[1] - m) / (-dy));
        }
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
  function popup(p, tile) {
    const pop = root.querySelector('.cine-pop'), im = pop && pop.querySelector('img');
    if (!pop || !im) return null;
    const [fx, fy] = focusOf(p);
    const r0 = tile ? tile.getBoundingClientRect() : { left: W()*.3, top: H()*.3, width: W()*.4, height: H()*.3 };
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
      setTimeout(() => { h.pop.classList.remove('on'); h.im.style.transition='none'; h.im.style.transform='none'; if(done) done(); }, reduce ? 80 : 620);
    }, reduce ? 60 : 700);
  }

  return {
    mount(el) { root = el; build(); },
    refresh() { fill(); },
    add(p) { dropIn(p); },
    remove(id) { rowsBox && rowsBox.querySelectorAll(`.cine-tile[data-id="${id}"]`).forEach((t) => t.remove()); emptyState(); },
    pin(pin) {
      if (!pin) {
        pinnedId = null; clearTimeout(popTimer);
        rows.forEach((r) => { try { r.anim.play(); } catch { /* ignore */ } });
        if (pinHandle) { closePopup(pinHandle, () => { pinHandle = null; }); pinHandle = null; }
        return;
      }
      pinnedId = pin.id || null;
      rows.forEach((r) => { try { r.anim.pause(); } catch { /* ignore */ } });
      const p = ctx.photoById(pin.id); if (!p) return;
      const tile = rowsBox && rowsBox.querySelector(`.cine-tile[data-id="${p.id}"]`);
      pinHandle = popup(p, tile);
    },
    destroy() { clearTimeout(popTimer); hideTag(); rows.forEach((r) => { try { r.anim.cancel(); } catch { /* ignore */ } }); rows = []; if (root) root.innerHTML=''; rowsBox = null; },
  };
}
