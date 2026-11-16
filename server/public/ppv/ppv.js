// shared helpers for ppv pages
window.$ = (s, r = document) => r.querySelector(s);
window.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
window.rm = (c) => (c ? 'RM' + (c / 100).toFixed(c % 100 ? 2 : 0) : 'Percuma');
window.when = (ms) => (ms ? new Date(ms).toLocaleString('ms-MY', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Tarikh akan diumumkan');
window.CATS = { boxing: 'Tinju', seminar: 'Seminar', health: 'Senaman', other: 'Lain-lain' };

window.api = async (method, url, body) => {
  const r = await fetch(url, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'Ralat'); e.status = r.status; e.data = j; throw e; }
  return j;
};

// email + 6-digit code login. login() resolves with the email once signed in.
window.login = () => new Promise((ok, no) => {
  let m = $('#loginModal');
  if (!m) {
    m = document.createElement('div'); m.id = 'loginModal'; m.className = 'modal';
    m.innerHTML = `<div class="box"><h2>Log masuk</h2><p class="meta" id="lgHint">Masukkan emel. Kami hantar kod 6 digit.</p>
      <label for="lgEmail">Emel</label><input id="lgEmail" type="email" autocomplete="email" inputmode="email">
      <div id="lgCodeWrap" style="display:none"><label for="lgCode">Kod 6 digit</label><input id="lgCode" class="otp" maxlength="6" inputmode="numeric" autocomplete="one-time-code"></div>
      <div id="lgMsg" class="msg err" style="display:none"></div>
      <div style="display:flex;gap:8px;margin-top:16px"><button class="btn ghost" id="lgCancel">Batal</button><button class="btn" id="lgGo" style="flex:1">Hantar kod</button></div></div>`;
    document.body.appendChild(m);
  }
  const msg = (t) => { const e = $('#lgMsg'); e.textContent = t || ''; e.style.display = t ? '' : 'none'; };
  let step = 1; msg(''); m.classList.add('on'); $('#lgEmail').focus();
  $('#lgCancel').onclick = () => { m.classList.remove('on'); no(new Error('cancel')); };
  $('#lgGo').onclick = async () => {
    const email = $('#lgEmail').value.trim();
    $('#lgGo').disabled = true; msg('');
    try {
      if (step === 1) {
        const r = await api('POST', '/api/ppv/auth/otp', { email });
        step = 2; $('#lgCodeWrap').style.display = ''; $('#lgGo').textContent = 'Sahkan'; $('#lgHint').textContent = 'Kod dihantar ke ' + email + '.'; $('#lgCode').focus();
        if (r.testCode) $('#lgCode').value = r.testCode;
      } else {
        await api('POST', '/api/ppv/auth/verify', { email, code: $('#lgCode').value.trim() });
        m.classList.remove('on'); ok(email);
      }
    } catch (e) { msg(e.message); } finally { $('#lgGo').disabled = false; }
  };
});

window.me = () => api('GET', '/api/ppv/me').catch(() => ({ email: null }));
window.topbar = async (extra = '') => {
  const u = await me();
  document.body.insertAdjacentHTML('afterbegin', `<header class="top"><div class="wrap"><a class="logo" href="/ppv">ccam<b>ppv</b></a><span class="sp"></span>${extra}
    ${u.email ? `<span class="meta" style="font-size:13px">${esc(u.email)}</span><button class="btn ghost" id="tbOut">Keluar</button>` : `<button class="btn" id="tbIn">Log masuk</button>`}</div></header>`);
  $('#tbIn')?.addEventListener('click', async () => { try { await login(); location.reload(); } catch {} });
  $('#tbOut')?.addEventListener('click', async () => { await api('POST', '/api/ppv/auth/logout'); location.reload(); });
  return u;
};
