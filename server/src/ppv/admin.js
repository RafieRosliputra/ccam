// Admin routes. Platform admin: /api/admin/ppv/* (behind Cloudflare Access). Organisation staff: /api/ppv/org/* (email login).
import * as p from './db.js';
import * as core from './core.js';
import { account, eventJson } from './viewer.js';
import { cleanEmail, validEmail } from './otp.js';
import * as auth from '../auth.js';
import { fail, sendJson, readJson, uuid } from '../http.js';

const slugOk = (s) => /^[a-z0-9][a-z0-9-]{1,62}$/.test(s);
const MIN_PRICE = 500;   // RM5, in cents
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

function eventFields(b, cur = {}) {
  const f = {};
  for (const k of ['title', 'category', 'description', 'poster', 'waiting_image', 'provider', 'provider_ref', 'ticker_text', 'replay_ref', 'organizer_id'])
    if (b[k] !== undefined) f[k] = String(b[k]).slice(0, 2000);
  if (b.slug !== undefined) { if (!slugOk(b.slug)) fail(400, 'Slug: a-z, 0-9 and dashes only'); f.slug = b.slug; }
  for (const k of ['starts_at', 'ends_at']) if (b[k] !== undefined) f[k] = b[k] === null ? null : num(b[k]);
  for (const k of ['price_cents', 'ticket_limit', 'replay_days']) if (b[k] !== undefined) f[k] = Math.max(0, Math.round(num(b[k])));
  if (b.whitelist !== undefined) f.whitelist = b.whitelist ? 1 : 0;
  if (b.status !== undefined) {
    if (!['draft', 'scheduled', 'live', 'ended', 'cancelled'].includes(b.status)) fail(400, 'Bad status');
    f.status = b.status;
  }
  if (f.provider && !['hls', 'cfstream'].includes(f.provider)) fail(400, 'Bad provider');
  const price = f.price_cents ?? cur.price_cents ?? 0;
  const wl = f.whitelist ?? cur.whitelist ?? 0;
  if (!wl && price > 0 && price < MIN_PRICE) fail(400, 'Minimum ticket price is RM5');
  return f;
}

function money(ev) {
  const t = p.paidTotals(ev.id);
  const splits = p.getSplits(ev.id);
  let plan = null;
  if (splits.length && Math.abs(splits.reduce((a, s) => a + s.pct, 0) - 100) < 1e-9)
    plan = core.splitMoney(t.gross, t.fee, splits.map((s) => ({ id: s.party, pct: s.pct })));
  return { gross: t.gross, fee: t.fee, sold: t.n, splits, plan, settlements: p.settlementsOf(ev.id) };
}

function adminEventJson(ev) {
  return { ...eventJson(ev), providerRef: ev.provider_ref, provider: ev.provider, replayRef: ev.replay_ref, tickerText: ev.ticker_text,
    ticketLimit: ev.ticket_limit, sold: p.ticketCount(ev.id), live: p.liveViewerCount(ev.id, Date.now() - 60e3) };
}

/** Actions shared by platform admin and an org admin (own events only). `by` is who did it. */
function eventActions(r, base, guard) {
  r('GET', `${base}/events`, async (req, res) => {
    const g = await guard(req);
    const list = g.orgId === undefined ? p.listEvents() : p.listEvents({ organizerId: g.orgId });
    sendJson(res, 200, { events: list.map(adminEventJson) });
  });
  r('POST', `${base}/events`, async (req, res) => {
    const g = await guard(req, { write: true });
    const b = await readJson(req);
    if (!b.title || !b.slug) fail(400, 'Title and slug are required');
    const f = eventFields(b);
    if (p.getEventBySlug(f.slug)) fail(409, 'Slug already used');
    const ev = p.insertEvent({ id: uuid(), ...f, organizer_id: g.orgId === undefined ? (f.organizer_id || '') : g.orgId });
    sendJson(res, 200, { event: adminEventJson(ev) });
  });
  r('PATCH', `${base}/events/:id`, async (req, res, { params }) => {
    const ev = p.getEvent(params.id) || fail(404, 'Event not found');
    const g = await guard(req, { write: true, event: ev });
    const b = await readJson(req);
    const f = eventFields(b, ev);
    if (g.orgId !== undefined) delete f.organizer_id;
    if (f.slug && f.slug !== ev.slug && p.getEventBySlug(f.slug)) fail(409, 'Slug already used');
    sendJson(res, 200, { event: adminEventJson(p.updateEvent(ev.id, f)) });
  });
  // Director may only start/stop the stream and set the ticker.
  r('POST', `${base}/events/:id/ops`, async (req, res, { params }) => {
    const ev = p.getEvent(params.id) || fail(404, 'Event not found');
    await guard(req, { event: ev, ops: true });
    const b = await readJson(req);
    const f = {};
    if (b.status !== undefined) {
      if (!['scheduled', 'live', 'ended'].includes(b.status)) fail(400, 'Status not allowed');
      f.status = b.status;
    }
    if (b.ticker_text !== undefined) f.ticker_text = String(b.ticker_text).slice(0, 200);
    sendJson(res, 200, { event: adminEventJson(p.updateEvent(ev.id, f)) });
  });
  r('GET', `${base}/events/:id/tickets`, async (req, res, { params }) => {
    const ev = p.getEvent(params.id) || fail(404, 'Event not found');
    await guard(req, { event: ev });
    sendJson(res, 200, { tickets: p.ticketsOf(ev.id) });
  });
  r('POST', `${base}/events/:id/whitelist`, async (req, res, { params }) => {
    const ev = p.getEvent(params.id) || fail(404, 'Event not found');
    await guard(req, { write: true, event: ev });
    const b = await readJson(req, 512 * 1024);
    const raw = Array.isArray(b.emails) ? b.emails : String(b.emails || '').split(/[\s,;]+/);
    const emails = [...new Set(raw.map(cleanEmail).filter(validEmail))];
    sendJson(res, 200, { added: p.whitelistAdd(ev.id, emails), total: p.whitelistCount(ev.id) });
  });
  r('GET', `${base}/events/:id/money`, async (req, res, { params }) => {
    const ev = p.getEvent(params.id) || fail(404, 'Event not found');
    await guard(req, { write: true, event: ev });
    sendJson(res, 200, money(ev));
  });
}

export function registerAdmin(r) {
  // ---- platform admin (Cloudflare Access) ----
  const adminGuard = async (req) => { const a = await auth.requireAdmin(req); return { email: a.email, orgId: undefined }; };
  eventActions(r, '/api/admin/ppv', adminGuard);

  r('PUT', '/api/admin/ppv/events/:id/splits', async (req, res, { params }) => {
    const a = await adminGuard(req);
    const ev = p.getEvent(params.id) || fail(404, 'Event not found');
    const b = await readJson(req);
    const shares = (b.shares || []).map((s) => ({ party: String(s.party), pct: num(s.pct) }));
    if (!shares.length) fail(400, 'Shares required');
    try { p.setSplits(ev.id, shares); } catch { fail(400, 'Percentages must total 100'); }
    sendJson(res, 200, { ok: true, by: a.email, ...money(ev) });
  });
  r('POST', '/api/admin/ppv/events/:id/settle', async (req, res, { params }) => {
    await adminGuard(req);
    const ev = p.getEvent(params.id) || fail(404, 'Event not found');
    const m = money(ev);
    if (!m.plan) fail(400, 'Set the split first');
    p.ensureSettlements(ev.id, m.plan.shares);
    sendJson(res, 200, money(ev));
  });
  r('POST', '/api/admin/ppv/settlements/:id/paid', async (req, res, { params }) => {
    await adminGuard(req);
    const b = await readJson(req);
    p.markSettlementPaid(Number(params.id), String(b.ref || '').slice(0, 200));
    sendJson(res, 200, { ok: true });
  });
  // mark a pending payment as paid (manual mode) -> opens the ticket
  r('POST', '/api/admin/ppv/payments/:id/paid', async (req, res, { params }) => {
    await adminGuard(req);
    const pay = p.getPayment(params.id) || fail(404, 'Payment not found');
    if (pay.status === 'paid') return sendJson(res, 200, { ok: true, already: true });
    const b = await readJson(req);
    const ev = p.getEvent(pay.event_id);
    let t = p.ticketFor(ev.id, pay.email);
    if (!t) t = p.insertTicket({ id: uuid(), eventId: ev.id, email: pay.email, source: 'sale' });
    p.markPaid(pay.id, t.id, Math.max(0, Math.round(num(b.feeCents))));
    const d = p.discountFor(pay.email);
    if (d) p.useDiscount(d.id, pay.email);
    sendJson(res, 200, { ok: true, ticket: t.id });
  });
  r('GET', '/api/admin/ppv/events/:id/payments', async (req, res, { params }) => {
    await adminGuard(req);
    sendJson(res, 200, { payments: p.paymentsOf(params.id) });
  });
  r('POST', '/api/admin/ppv/tickets/:id/revoke', async (req, res, { params }) => {
    const a = await adminGuard(req);
    const t = p.getTicket(params.id) || fail(404, 'Ticket not found');
    p.revokeTicket(t.id, a.email); p.endSessions(t.id, 'revoked');
    sendJson(res, 200, { ok: true });
  });
  r('POST', '/api/admin/ppv/tickets/:id/reinstate', async (req, res, { params }) => {
    await adminGuard(req);
    p.reinstateTicket(params.id);
    sendJson(res, 200, { ok: true });
  });
  // leak: search by the 6-char code seen in a pirated stream, optionally revoke
  r('GET', '/api/admin/ppv/leak/:code', async (req, res, { params }) => {
    await adminGuard(req);
    const code = String(params.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    sendJson(res, 200, { matches: p.leakByCode(code).map((l) => ({ code: l.code, kind: l.kind, at: l.show_at, email: l.email, ticketId: l.ticket_id,
      ticketStatus: l.ticket_status, event: l.title, slug: l.slug, device: l.device_hash })) });
  });
  r('POST', '/api/admin/ppv/events/:id/discount', async (req, res, { params }) => {
    const a = await adminGuard(req);
    const ev = p.getEvent(params.id) || fail(404, 'Event not found');
    const b = await readJson(req);
    const pct = Math.round(num(b.pct));
    if (pct < 1 || pct > 100) fail(400, 'Percent 1-100');
    const days = Math.min(365, Math.max(1, Math.round(num(b.days, 30))));
    sendJson(res, 200, { id: p.createDiscount(ev.id, pct, Date.now() + days * 86400e3, a.email) });
  });
  r('GET', '/api/admin/ppv/orgs', async (req, res) => {
    await adminGuard(req);
    sendJson(res, 200, { orgs: p.listOrgs().map((o) => ({ ...o, members: p.membersOf(o.organizer_id) })) });
  });
  r('PUT', '/api/admin/ppv/orgs/:id', async (req, res, { params }) => {
    await adminGuard(req);
    const b = await readJson(req);
    const kind = ['platform', 'provider', 'client'].includes(b.kind) ? b.kind : 'client';
    sendJson(res, 200, { org: p.upsertOrg({ organizerId: params.id === '_platform' ? '' : params.id, parentId: String(b.parentId || ''), kind,
      name: String(b.name || '').slice(0, 120), feeFixed: Math.max(0, Math.round(num(b.feeFixed))), feePct: Math.max(0, Math.min(100, num(b.feePct))) }) });
  });
  r('PUT', '/api/admin/ppv/orgs/:id/members', async (req, res, { params }) => {
    await adminGuard(req);
    const b = await readJson(req);
    const email = cleanEmail(b.email);
    if (!validEmail(email) || !['admin', 'director'].includes(b.role)) fail(400, 'Email and role (admin/director) required');
    p.addMember(email, params.id === '_platform' ? '' : params.id, b.role);
    sendJson(res, 200, { ok: true });
  });

  // ---- organisation staff (email login; admin = everything own, director = stream ops + ticker only) ----
  const orgGuard = async (req, o = {}) => {
    const a = account(req) || fail(401, 'Log in with your email first');
    const mine = p.membershipsOf(a.email);
    if (!mine.length) fail(403, 'Not a member of any organisation');
    const ev = o.event;
    const m = ev ? mine.find((x) => x.organizer_id === ev.organizer_id) : mine[0];
    if (!m) fail(403, 'This event belongs to another organisation');
    // director: stream ops + the event list only; no tickets, money or edits
    if (m.role === 'director' && !(o.ops || (!o.event && !o.write))) fail(403, 'Directors can only run the stream');
    if (o.write && m.role !== 'admin') fail(403, 'Admins only');
    return { email: a.email, orgId: m.organizer_id, role: m.role };
  };
  eventActions(r, '/api/ppv/org', orgGuard);
}
