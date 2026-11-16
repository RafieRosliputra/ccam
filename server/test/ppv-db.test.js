import test from 'node:test';
import assert from 'node:assert/strict';
import * as ccamDb from '../src/db.js';
import * as p from '../src/ppv/db.js';

test('ppv tables are created next to ccam tables', () => {
  ccamDb.openDb(':memory:');
  const tables = p.h().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ppv_%'").all().map((r) => r.name);
  for (const t of ['ppv_events', 'ppv_tickets', 'ppv_sessions', 'ppv_leak_codes', 'ppv_payments']) assert.ok(tables.includes(t), t);
  assert.ok(p.h().prepare("SELECT 1 FROM sqlite_master WHERE name='events'").get(), 'ccam events table still there');
});

test('event, ticket, one active session, leak codes, discount', () => {
  ccamDb.openDb(':memory:');
  p.insertEvent({ id: 'e1', slug: 'tinju-1', title: 'Tinju 1', price_cents: 1500 });
  const t = p.insertTicket({ id: 't1', eventId: 'e1', email: 'a@x.com' });
  assert.throws(() => p.insertTicket({ id: 't2', eventId: 'e1', email: 'a@x.com' }));   // one ticket per email per event
  const s = p.startSession(t.id, 'dev1');
  assert.equal(p.activeSession(t.id).id, s.id);
  p.endSessions(t.id, 'switched');
  assert.equal(p.activeSession(t.id), undefined);
  const id = p.insertLeak({ eventId: 'e1', code: 'ABC234', ticketId: t.id, sessionId: s.id, kind: 'box', showAt: 1000 });
  assert.throws(() => p.insertLeak({ eventId: 'e1', code: 'ABC234', ticketId: t.id, sessionId: s.id, kind: 'box', showAt: 2000 }));
  assert.equal(p.leakByCode('ABC234')[0].email, 'a@x.com');
  p.ackLeak(id, s.id);
  assert.ok(p.dueLeaks(s.id, 5000)[0].ack_at);
  const d = p.createDiscount('e1', 20, Date.now() + 1e6, 'admin');
  assert.equal(p.discountFor('a@x.com').pct, 20);
  p.useDiscount(d, 'a@x.com');
  assert.equal(p.discountFor('a@x.com'), undefined);
  p.setSplits('e1', [{ party: 'platform', pct: 20 }, { party: 'org1', pct: 80 }]);
  assert.throws(() => p.setSplits('e1', [{ party: 'platform', pct: 50 }]));
});
