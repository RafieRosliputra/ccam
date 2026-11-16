import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../src/ppv/core.js';

test('leak code: 6 chars, no look-alikes', () => {
  for (let i = 0; i < 2000; i++) {
    const code = c.makeLeakCode();
    assert.equal(code.length, 6);
    assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$/);
    assert.doesNotMatch(code, /[01OIL]/);
  }
});

test('unique codes per event', () => {
  const used = new Set();
  for (let i = 0; i < 500; i++) c.uniqueLeakCode(used);
  assert.equal(used.size, 500);
});

test('schedule: one box per 15 minute window, 2 seconds, inside the frame', () => {
  const from = Date.UTC(2026, 10, 20, 12, 3, 0);
  const s = c.leakSchedule(from, 4);
  assert.ok(s.length >= 3 && s.length <= 4);
  for (const e of s) {
    assert.equal(e.ms, 2000);
    assert.ok(e.x >= 0.1 && e.x <= 0.8 && e.y >= 0.1 && e.y <= 0.8);
  }
  const windows = new Set(s.map((e) => Math.floor(e.at / c.WINDOW_MS)));
  assert.equal(windows.size, s.length);
});

test('ticker has the viewer code at the end', () => {
  assert.equal(c.tickerText('Selamat datang  semua', 'AB3D5F'), 'Selamat datang semua AB3D5F');
  assert.equal(c.tickerText('', 'AB3D5F'), '');
});

test('token: sign, verify, tamper, expiry', () => {
  const now = 1_000_000;
  const t = c.signToken({ sid: 7, exp: now + 1000 }, 'secret');
  assert.equal(c.verifyToken(t, 'secret', now).sid, 7);
  assert.equal(c.verifyToken(t, 'other', now), null);
  assert.equal(c.verifyToken(t, 'secret', now + 2000), null);
  const [b, m] = t.split('.');
  assert.equal(c.verifyToken(`${Buffer.from('{"sid":8,"exp":9999999}').toString('base64url')}.${m}`, 'secret', now), null);
  assert.equal(c.verifyToken('x', 'secret', now), null);
});

test('renew only while the overlay codes are acknowledged', () => {
  const due = [{ id: 1, at: 1000 }, { id: 2, at: 2000 }, { id: 3, at: 3000 }];
  const now = 100000;
  assert.equal(c.renewDecision({ now, due, acked: new Set([1, 2, 3]) }).renew, true);
  assert.equal(c.renewDecision({ now, due, acked: new Set([1, 2]) }).renew, true);   // one missed allowed
  const r = c.renewDecision({ now, due, acked: new Set() });
  assert.equal(r.renew, false);
  assert.equal(r.reason, 'overlay_missing');
});

test('money split totals the net', () => {
  const r = c.splitMoney(10000, 125, [{ id: 'rafi', pct: 20 }, { id: 'provider', pct: 30 }, { id: 'client', pct: 50 }]);
  assert.equal(r.net, 9875);
  assert.equal(r.shares.reduce((a, s) => a + s.cents, 0), 9875);
  assert.throws(() => c.splitMoney(100, 0, [{ id: 'a', pct: 60 }]));
});
