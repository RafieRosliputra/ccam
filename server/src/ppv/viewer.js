// Viewer routes: login (email + OTP), event pages, tickets, watching (start / heartbeat / end).
import * as p from './db.js';
import * as core from './core.js';
import { sendOtp, verifyOtp, accountOf, cleanEmail, validEmail, ACCOUNT_TTL_MS } from './otp.js';
import { playbackUrl } from './video.js';
import { config } from '../config.js';
import { HttpError, fail, sendJson, readJson, clientIp, cookie, parseCookies, sha256, uuid } from '../http.js';

export const ACCOUNT_COOKIE = 'ppv_a';
const SECRET = () => process.env.PPV_SECRET || 'dev-only-secret-change-me';
export const MAX_SWITCHES_PER_DAY = 3;
const AHEAD_WINDOWS = 4;                 // keep about one hour of codes scheduled ahead
const dayKey = () => new Date().toISOString().slice(0, 10);

export function account(req) {
  return accountOf(parseCookies(req)[ACCOUNT_COOKIE]);
}
function needAccount(req) { return account(req) || fail(401, 'Log in with your email first'); }

/** Public shape of an event (never the stream reference). */
export function eventJson(ev, extra = {}) {
  return { id: ev.id, slug: ev.slug, title: ev.title, category: ev.category, description: ev.description, poster: ev.poster,
    waitingImage: ev.waiting_image, startsAt: ev.starts_at, endsAt: ev.ends_at, status: ev.status, priceCents: ev.price_cents,
    whitelist: !!ev.whitelist, replayDays: ev.replay_days, organizerId: ev.organizer_id, ...extra };
}

/** May this ticket watch right now? Live window, or replay for replay_days after the event ended. */
export function canWatch(ev, now = Date.now()) {
  if (ev.status === 'cancelled' || ev.status === 'draft') return { ok: false, reason: 'not_available' };
  if (ev.status === 'live') return { ok: true, mode: 'live' };
  if (ev.status === 'ended') {
    const until = (ev.ends_at || ev.starts_at || 0) + ev.replay_days * 86400e3;
    return now <= until && ev.replay_ref ? { ok: true, mode: 'replay' } : { ok: false, reason: 'replay_over' };
  }
  return { ok: false, reason: 'not_started' };
}

/** Discount-adjusted price for this email. */
function priceFor(ev, email) {
  const d = email ? p.discountFor(email) : null;
  return d ? { cents: Math.round(ev.price_cents * (100 - d.pct) / 100), discountId: d.id, pct: d.pct } : { cents: ev.price_cents };
}

function issueSchedule(ev, ticket, sessionId, fromMs) {
  const used = p.leakCodesUsed(ev.id);
  const out = [];
  const have = p.pendingLeaks(sessionId, fromMs).filter((l) => l.kind === 'box').length;
  if (have >= AHEAD_WINDOWS) return out;
  const lastAt = p.pendingLeaks(sessionId, fromMs).filter((l) => l.kind === 'box').at(-1)?.show_at || fromMs;
  for (const s of core.leakSchedule(lastAt + (have ? core.WINDOW_MS : 0), AHEAD_WINDOWS - have)) {
    const code = core.uniqueLeakCode(used);
    const id = p.insertLeak({ eventId: ev.id, code, ticketId: ticket.id, sessionId, kind: 'box', showAt: s.at });
    out.push({ id, code, at: s.at, ms: s.ms, x: s.x, y: s.y });
  }
  return out;
}

function tickerFor(ev, ticket, sessionId) {
  if (!ev.ticker_text) return null;
  const used = p.leakCodesUsed(ev.id);
  const code = core.uniqueLeakCode(used);
  p.insertLeak({ eventId: ev.id, code, ticketId: ticket.id, sessionId, kind: 'ticker', showAt: Date.now() });
  return { text: core.tickerText(ev.ticker_text, code), code };
}

function tokenFor(ev, ticket, sess) {
  const expMs = Date.now() + core.TOKEN_TTL_MS;
  const token = core.signToken({ sid: sess.id, tid: ticket.id, eid: ev.id, exp: expMs }, SECRET());
  return { token, expMs, url: playbackUrl(ev, { token, expMs }) };
}

function bodyOf(req) { return readJson(req); }

export function registerViewer(r) {
  // ---- login ----
  r('POST', '/api/ppv/auth/otp', async (req, res) => {
    const b = await bodyOf(req);
    sendJson(res, 200, await sendOtp(b.email, clientIp(req)));
  });
  r('POST', '/api/ppv/auth/verify', async (req, res) => {
    const b = await bodyOf(req);
    const { token, email } = verifyOtp(b.email, b.code);
    sendJson(res, 200, { email }, { 'set-cookie': cookie(ACCOUNT_COOKIE, token, { maxAge: ACCOUNT_TTL_MS / 1000, secure: config.cookieSecure }) });
  });
  r('POST', '/api/ppv/auth/logout', async (req, res) => {
    const t = parseCookies(req)[ACCOUNT_COOKIE];
    if (t) p.dropAccount(sha256(t));
    sendJson(res, 200, { ok: true }, { 'set-cookie': cookie(ACCOUNT_COOKIE, '', { maxAge: 0, secure: config.cookieSecure }) });
  });
  r('GET', '/api/ppv/me', (req, res) => {
    const a = account(req);
    if (!a) return sendJson(res, 200, { email: null });
    sendJson(res, 200, { email: a.email, tickets: p.ticketsOfEmail(a.email).map((t) => ({ id: t.id, slug: t.slug, title: t.title })),
      memberships: p.membershipsOf(a.email).map((m) => ({ organizerId: m.organizer_id, role: m.role })) });
  });

  // ---- events ----
  r('GET', '/api/ppv/events', (req, res) => {
    sendJson(res, 200, { events: p.listEvents({ publicOnly: true }).map((e) => eventJson(e)) });
  });
  r('GET', '/api/ppv/events/:slug', (req, res, { params }) => {
    const ev = p.getEventBySlug(params.slug);
    if (!ev || ev.status === 'draft') fail(404, 'Event not found');
    const a = account(req);
    const ticket = a ? p.ticketFor(ev.id, a.email) : null;
    const left = ev.ticket_limit ? Math.max(0, ev.ticket_limit - p.ticketCount(ev.id)) : null;
    const price = priceFor(ev, a?.email);
    sendJson(res, 200, { event: eventJson(ev, { ticketsLeft: left, yourPriceCents: price.cents, discountPct: price.pct || 0 }),
      ticket: ticket ? { id: ticket.id, status: ticket.status } : null, watch: canWatch(ev) });
  });

  // ---- get a ticket: free, whitelist, or start a payment ----
  r('POST', '/api/ppv/events/:slug/checkout', async (req, res, { params }) => {
    const a = needAccount(req);
    const ev = p.getEventBySlug(params.slug);
    if (!ev || ev.status === 'draft' || ev.status === 'cancelled' || ev.status === 'ended') fail(404, 'Event not available');
    const existing = p.ticketFor(ev.id, a.email);
    if (existing && existing.status === 'active') return sendJson(res, 200, { ticket: { id: existing.id }, already: true });
    if (existing) fail(403, 'This ticket was cancelled. Contact the organiser.');
    if (ev.ticket_limit && p.ticketCount(ev.id) >= ev.ticket_limit) fail(409, 'Sold out');
    if (ev.whitelist) {
      if (!p.whitelistHas(ev.id, a.email)) fail(403, 'This email is not on the guest list for this event');
      const t = p.insertTicket({ id: uuid(), eventId: ev.id, email: a.email, source: 'whitelist' });
      return sendJson(res, 200, { ticket: { id: t.id } });
    }
    const price = priceFor(ev, a.email);
    if (price.cents <= 0) {
      const t = p.insertTicket({ id: uuid(), eventId: ev.id, email: a.email, source: 'comp' });
      if (price.discountId) p.useDiscount(price.discountId, a.email);
      return sendJson(res, 200, { ticket: { id: t.id } });
    }
    const pay = p.insertPayment({ id: uuid(), eventId: ev.id, email: a.email, gateway: process.env.PPV_GATEWAY || 'manual', grossCents: price.cents });
    // Gateways (HitPay / Billplz) plug in here; until keys exist the admin marks the payment as paid.
    sendJson(res, 200, { payment: { id: pay.id, status: 'pending', amountCents: price.cents, gateway: pay.gateway,
      note: pay.gateway === 'manual' ? 'Transfer to the organiser and send the payment id. The ticket opens once the payment is confirmed.' : '' } });
  });

  // ---- watching ----
  r('POST', '/api/ppv/watch/:slug/start', async (req, res, { params }) => {
    const a = needAccount(req);
    const ev = p.getEventBySlug(params.slug);
    if (!ev) fail(404, 'Event not found');
    const ticket = p.ticketFor(ev.id, a.email);
    if (!ticket) fail(403, 'No ticket for this event');
    if (ticket.status !== 'active') fail(403, 'This ticket is not active');
    const w = canWatch(ev);
    if (!w.ok) fail(409, w.reason, { reason: w.reason });
    const b = await bodyOf(req);
    const dev = core.deviceHash(String(req.headers['user-agent'] || ''), String(b.hint || '').slice(0, 64));
    const prev = p.activeSession(ticket.id);
    if (prev && prev.device_hash !== dev) {
      if (p.bumpSwitch(ticket.id, dayKey()) > MAX_SWITCHES_PER_DAY) fail(429, 'Too many device changes today');
    }
    p.endSessions(ticket.id, prev && prev.device_hash !== dev ? 'switched' : 'restarted');
    const sess = p.startSession(ticket.id, dev);
    const tk = tokenFor(ev, ticket, sess);
    if (!tk.url) fail(503, 'The stream is not ready yet');
    const schedule = issueSchedule(ev, ticket, sess.id, Date.now());
    sendJson(res, 200, { sessionId: sess.id, token: tk.token, url: tk.url, expMs: tk.expMs, mode: w.mode, schedule,
      ticker: tickerFor(ev, ticket, sess.id), heartbeatSec: 20 });
  });

  r('POST', '/api/ppv/watch/:slug/heartbeat', async (req, res, { params }) => {
    const a = needAccount(req);
    const ev = p.getEventBySlug(params.slug);
    if (!ev) fail(404, 'Event not found');
    const b = await bodyOf(req);
    const claims = core.verifyToken(b.token, SECRET(), Date.now() - core.GRACE_MS);   // allow a little lateness
    if (!claims || claims.eid !== ev.id) fail(401, 'Session expired', { reason: 'token' });
    const sess = p.getSession(claims.sid);
    const ticket = sess && p.getTicket(sess.ticket_id);
    if (!sess || !ticket || ticket.email !== a.email) fail(401, 'Session expired', { reason: 'session' });
    if (sess.ended_at) fail(409, 'You started watching on another device', { reason: sess.ended_reason || 'ended' });
    if (ticket.status !== 'active') { p.endSession(sess.id, 'revoked'); fail(403, 'This ticket was cancelled', { reason: 'revoked' }); }
    const w = canWatch(ev);
    if (!w.ok) fail(409, w.reason, { reason: w.reason });
    // acknowledgements of codes the player showed
    for (const id of (Array.isArray(b.acks) ? b.acks : []).slice(0, 20)) p.ackLeak(Number(id), sess.id);
    const now = Date.now();
    const due = p.dueLeaks(sess.id, now).filter((d) => d.show_at === undefined || true);
    const decision = core.renewDecision({ now, due: due.map((d) => ({ id: d.id, at: d.at })), acked: new Set(due.filter((d) => d.ack_at).map((d) => d.id)) });
    if (!decision.renew) { p.endSession(sess.id, decision.reason); fail(403, 'Overlay missing, playback stopped', { reason: decision.reason }); }
    p.touchSession(sess.id);
    const tk = tokenFor(ev, ticket, sess);
    sendJson(res, 200, { token: tk.token, url: tk.url, expMs: tk.expMs, mode: w.mode, schedule: issueSchedule(ev, ticket, sess.id, now),
      ticker: tickerFor(ev, ticket, sess.id) });
  });

  r('POST', '/api/ppv/watch/:slug/end', async (req, res, { params }) => {
    const a = needAccount(req);
    const ev = p.getEventBySlug(params.slug);
    const t = ev && p.ticketFor(ev.id, a.email);
    if (t) p.endSessions(t.id, 'left');
    sendJson(res, 200, { ok: true });
  });
}
