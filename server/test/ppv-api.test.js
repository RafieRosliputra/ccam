// ppv end to end: login (OTP), ticket, watch, heartbeat, leak codes, admin. Run: cd server && node --test test/ppv-api.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppv-'));
Object.assign(process.env, {
  DATA_DIR: path.join(tmp, 'data'), PHOTOS_DIR: path.join(tmp, 'photos'), COOKIE_SECURE: '0', PUBLIC_URL: 'http://localhost',
  SCAN_INTERVAL: '3600', DEV_ADMIN: 'admin@test.my', PPV_SECRET: 'test-secret', PPV_MAIL: 'console',
  PPV_TEST_EMAILS: 'a@test.my,b@test.my,staff@test.my,dir@test.my',
});
const { handler } = await import('../src/server.js');
const db = await import('../src/db.js');
const storage = await import('../src/storage.js');
const p = await import('../src/ppv/db.js');

let base, server;
before(() => new Promise((ok) => {
  db.openDb(); storage.ensureStorage();
  server = http.createServer(handler);
  server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; ok(); });
}));
after(() => { server.closeAllConnections(); server.close(); db.closeDb(); fs.rmSync(tmp, { recursive: true, force: true }); });

function device(ip = '10.0.0.1') {
  const jar = {};
  return async (method, url, body) => {
    const h = { 'x-forwarded-for': ip, 'user-agent': 'ua-' + ip, 'content-type': 'application/json' };
    const ck = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (ck) h.cookie = ck;
    const r = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, v] = kv.split('='); if (v) jar[k] = v; else delete jar[k]; }
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
}
async function login(call, email) {
  const o = await call('POST', '/api/ppv/auth/otp', { email });
  assert.equal(o.status, 200); assert.ok(o.body.testCode, 'test mode returns the code');
  const v = await call('POST', '/api/ppv/auth/verify', { email, code: o.body.testCode });
  assert.equal(v.status, 200);
}

const admin = device('9.9.9.9');
const devA = device('2.2.2.2');   // OTP is rate limited to 5/hour per email, so devices are reused
let ev;

test('admin creates an event; price below RM5 is refused', async () => {
  const bad = await admin('POST', '/api/admin/ppv/events', { title: 'X', slug: 'x-event', price_cents: 300 });
  assert.equal(bad.status, 400);
  const ok = await admin('POST', '/api/admin/ppv/events', { title: 'Boxing Night', slug: 'boxing-night', price_cents: 1500, provider: 'hls',
    provider_ref: 'https://stream.example/live/boxing/index.m3u8', status: 'live', starts_at: Date.now() - 1000, ticker_text: 'ccam.my' });
  assert.equal(ok.status, 200);
  ev = ok.body.event;
});

test('public list hides the stream reference', async () => {
  const c = device('1.1.1.1');
  const l = await c('GET', '/api/ppv/events');
  assert.equal(l.body.events.length, 1);
  assert.ok(!JSON.stringify(l.body).includes('stream.example'));
});

test('no ticket, no watching; manual payment then admin marks paid', async () => {
  const a = devA;
  await login(a, 'a@test.my');
  assert.equal((await a('POST', '/api/ppv/watch/boxing-night/start', {})).status, 403);
  const co = await a('POST', '/api/ppv/events/boxing-night/checkout');
  assert.equal(co.body.payment.status, 'pending');
  const paid = await admin('POST', `/api/admin/ppv/payments/${co.body.payment.id}/paid`, { feeCents: 50 });
  assert.equal(paid.status, 200);
  assert.equal((await a('GET', '/api/ppv/me')).body.tickets.length, 1);
});

let first;
test('watch start gives a signed url, a schedule and a ticker with a code', async () => {
  const a = devA;
  const s = await a('POST', '/api/ppv/watch/boxing-night/start', { hint: 'phone' });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.match(s.body.url, /\?pt=/);
  assert.ok(s.body.schedule.length >= 3);
  assert.match(s.body.ticker.text, /ccam\.my [A-Z0-9]{6}/);
  first = s.body;
  const hb = await a('POST', '/api/ppv/watch/boxing-night/heartbeat', { token: s.body.token, acks: [] });
  assert.equal(hb.status, 200, JSON.stringify(hb.body));
});

test('second device kicks the first (1 ticket = 1 session)', async () => {
  const b = device('3.3.3.3');
  await login(b, 'a@test.my');
  assert.equal((await b('POST', '/api/ppv/watch/boxing-night/start', { hint: 'laptop' })).status, 200);
  const hb = await devA('POST', '/api/ppv/watch/boxing-night/heartbeat', { token: first.token, acks: [] });
  assert.equal(hb.status, 409);
});

test('missing overlay acknowledgements stop the token renewal', async () => {
  const c = device('4.4.4.4');
  await login(c, 'a@test.my');
  const s = await c('POST', '/api/ppv/watch/boxing-night/start', { hint: 'tv' });
  const t = p.ticketFor(ev.id, 'a@test.my');
  const sess = p.activeSession(t.id);
  for (let i = 0; i < 3; i++) p.insertLeak({ eventId: ev.id, code: 'ZZZZ' + (i + 2) + 'K', ticketId: t.id, sessionId: sess.id, kind: 'box', showAt: Date.now() - 60e3 - i });
  const hb = await c('POST', '/api/ppv/watch/boxing-night/heartbeat', { token: s.body.token, acks: [] });
  assert.equal(hb.status, 403);
});

test('admin finds a viewer by leak code and revokes the ticket', async () => {
  const t = p.ticketFor(ev.id, 'a@test.my');
  const m = await admin('GET', '/api/admin/ppv/leak/zzzz2k');
  assert.equal(m.body.matches[0].email, 'a@test.my');
  assert.equal((await admin('POST', `/api/admin/ppv/tickets/${t.id}/revoke`)).status, 200);
  const c = devA;
  assert.equal((await c('POST', '/api/ppv/watch/boxing-night/start', {})).status, 403);
});

test('org routes need a login', async () => {
  const c = device('6.6.6.6');
  assert.equal((await c('GET', '/api/ppv/org/events')).status, 401);
});

test('org admin manages own events; director only runs the stream', async () => {
  await admin('PUT', '/api/admin/ppv/orgs/club1', { kind: 'client', name: 'Club One' });
  await admin('PUT', '/api/admin/ppv/orgs/club1/members', { email: 'staff@test.my', role: 'admin' });
  await admin('PUT', '/api/admin/ppv/orgs/club1/members', { email: 'dir@test.my', role: 'director' });
  const s = device('7.7.7.7'); await login(s, 'staff@test.my');
  const mk = await s('POST', '/api/ppv/org/events', { title: 'Club Fight', slug: 'club-fight', price_cents: 1000 });
  assert.equal(mk.status, 200);
  assert.equal(mk.body.event.organizerId, 'club1');
  const d = device('8.8.8.8'); await login(d, 'dir@test.my');
  assert.equal((await d('GET', '/api/ppv/org/events')).status, 200);
  assert.equal((await d('GET', `/api/ppv/org/events/${mk.body.event.id}/tickets`)).status, 403);
  assert.equal((await d('PATCH', `/api/ppv/org/events/${mk.body.event.id}`, { title: 'Hack' })).status, 403);
  assert.equal((await d('POST', `/api/ppv/org/events/${mk.body.event.id}/ops`, { status: 'live' })).status, 200);
  assert.equal((await s('PATCH', `/api/ppv/org/events/${ev.id}`, { title: 'Nope' })).status, 403);
});

test('money split: gross minus gateway fee, then shares', async () => {
  const set = await admin('PUT', `/api/admin/ppv/events/${ev.id}/splits`, { shares: [{ party: 'platform', pct: 20 }, { party: 'club1', pct: 80 }] });
  assert.equal(set.status, 200);
  assert.equal(set.body.plan.net, 1450);
  assert.equal(set.body.plan.shares.reduce((a, s) => a + s.cents, 0), 1450);
  assert.equal((await admin('PUT', `/api/admin/ppv/events/${ev.id}/splits`, { shares: [{ party: 'x', pct: 50 }] })).status, 400);
});

test('ppv pages are served with clean URLs and assets', async () => {
  for (const u of ['/ppv', '/ppv/e/boxing-night', '/ppv/watch/boxing-night', '/ppv/org', '/ppv/ppv.css', '/ppv/ppv.js', '/ppv/vendor/hls.min.js']) {
    const r = await fetch(base + u);
    assert.equal(r.status, 200, u);
  }
  assert.match(await (await fetch(base + '/ppv')).text(), /ccam ppv/);
});
