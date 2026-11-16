// ppv tables (SQLite, shared database with ccam). All tables start with ppv_. Additive only.
// initPpv(db) is called from db.openDb(); everything else uses h() to get the handle.
let handle;
export const h = () => handle;
const q = (sql) => handle.prepare(sql);
const now = () => Date.now();

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ppv_orgs (
  organizer_id TEXT PRIMARY KEY,                -- organizers.id ('' for the platform itself)
  parent_id    TEXT NOT NULL DEFAULT '',        -- provider that owns this client ('' = Rafi directly)
  kind         TEXT NOT NULL DEFAULT 'client' CHECK (kind IN ('platform','provider','client')),
  name         TEXT NOT NULL DEFAULT '',
  fee_fixed    INTEGER NOT NULL DEFAULT 0,      -- cents per event
  fee_pct      REAL NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ppv_members (
  id           INTEGER PRIMARY KEY,
  email        TEXT NOT NULL,
  organizer_id TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('admin','director')),
  created_at   INTEGER NOT NULL,
  UNIQUE (email, organizer_id)
);
CREATE TABLE IF NOT EXISTS ppv_events (
  id            TEXT PRIMARY KEY,
  organizer_id  TEXT NOT NULL DEFAULT '',
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'other',
  description   TEXT NOT NULL DEFAULT '',
  poster        TEXT NOT NULL DEFAULT '',
  waiting_image TEXT NOT NULL DEFAULT '',
  starts_at     INTEGER,
  ends_at       INTEGER,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','live','ended','cancelled')),
  price_cents   INTEGER NOT NULL DEFAULT 0,
  ticket_limit  INTEGER NOT NULL DEFAULT 0,      -- 0 = no limit
  provider      TEXT NOT NULL DEFAULT 'hls',     -- 'hls' (MediaMTX) | 'cfstream'
  provider_ref  TEXT NOT NULL DEFAULT '',        -- HLS base URL or Stream live input uid
  whitelist     INTEGER NOT NULL DEFAULT 0,      -- 1 = only whitelisted emails get a ticket
  ticker_text   TEXT NOT NULL DEFAULT '',
  replay_days   INTEGER NOT NULL DEFAULT 7,
  replay_ref    TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  deleted_at    INTEGER
);
CREATE INDEX IF NOT EXISTS ppv_events_org ON ppv_events(organizer_id);
CREATE TABLE IF NOT EXISTS ppv_splits (
  event_id TEXT NOT NULL REFERENCES ppv_events(id) ON DELETE CASCADE,
  party    TEXT NOT NULL,                        -- organizer_id or 'platform'
  pct      REAL NOT NULL,
  PRIMARY KEY (event_id, party)
);
CREATE TABLE IF NOT EXISTS ppv_whitelist (
  event_id TEXT NOT NULL REFERENCES ppv_events(id) ON DELETE CASCADE,
  email    TEXT NOT NULL,
  PRIMARY KEY (event_id, email)
);
CREATE TABLE IF NOT EXISTS ppv_tickets (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES ppv_events(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'sale' CHECK (source IN ('sale','whitelist','comp')),
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','refunded')),
  switches   INTEGER NOT NULL DEFAULT 0,
  switch_day TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  revoked_by TEXT NOT NULL DEFAULT '',
  UNIQUE (event_id, email)
);
CREATE TABLE IF NOT EXISTS ppv_accounts (        -- viewer login sessions (after OTP)
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ppv_otps (
  email      TEXT PRIMARY KEY,
  code_hash  TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  tries      INTEGER NOT NULL DEFAULT 0,
  sent_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ppv_otp_sends (       -- rate limit log
  key TEXT NOT NULL, at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ppv_otp_sends_key ON ppv_otp_sends(key, at);
CREATE TABLE IF NOT EXISTS ppv_sessions (        -- one active viewing session per ticket
  id             INTEGER PRIMARY KEY,
  ticket_id      TEXT NOT NULL REFERENCES ppv_tickets(id) ON DELETE CASCADE,
  device_hash    TEXT NOT NULL,
  started_at     INTEGER NOT NULL,
  last_heartbeat INTEGER NOT NULL,
  ended_at       INTEGER,
  ended_reason   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ppv_sessions_ticket ON ppv_sessions(ticket_id, ended_at);
CREATE TABLE IF NOT EXISTS ppv_leak_codes (
  id         INTEGER PRIMARY KEY,
  event_id   TEXT NOT NULL,
  code       TEXT NOT NULL,
  ticket_id  TEXT NOT NULL,
  session_id INTEGER NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('box','ticker')),
  show_at    INTEGER NOT NULL,
  ack_at     INTEGER,
  UNIQUE (event_id, code)
);
CREATE TABLE IF NOT EXISTS ppv_payments (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL,
  email       TEXT NOT NULL,
  gateway     TEXT NOT NULL DEFAULT 'manual',
  ref         TEXT NOT NULL DEFAULT '',
  gross_cents INTEGER NOT NULL,
  fee_cents   INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','refunded')),
  ticket_id   TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  paid_at     INTEGER
);
CREATE TABLE IF NOT EXISTS ppv_settlements (
  id       INTEGER PRIMARY KEY,
  event_id TEXT NOT NULL,
  party    TEXT NOT NULL,
  cents    INTEGER NOT NULL,
  paid_at  INTEGER,
  ref      TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS ppv_discounts (
  id          INTEGER PRIMARY KEY,
  event_id    TEXT NOT NULL,
  pct         REAL NOT NULL,
  valid_until INTEGER NOT NULL,
  created_by  TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ppv_discount_grants (
  discount_id INTEGER NOT NULL REFERENCES ppv_discounts(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  used_at     INTEGER,
  PRIMARY KEY (discount_id, email)
);
`;

export function initPpv(db) { handle = db; db.exec(SCHEMA); }

// ---------------- events ----------------
export const getEvent = (id) => q('SELECT * FROM ppv_events WHERE id=? AND deleted_at IS NULL').get(id);
export const getEventBySlug = (slug) => q('SELECT * FROM ppv_events WHERE slug=? AND deleted_at IS NULL').get(slug);
export const listEvents = ({ organizerId, publicOnly } = {}) => {
  if (organizerId !== undefined) return q('SELECT * FROM ppv_events WHERE deleted_at IS NULL AND organizer_id=? ORDER BY starts_at DESC').all(organizerId);
  if (publicOnly) return q("SELECT * FROM ppv_events WHERE deleted_at IS NULL AND status IN ('scheduled','live','ended') ORDER BY starts_at DESC").all();
  return q('SELECT * FROM ppv_events WHERE deleted_at IS NULL ORDER BY starts_at DESC').all();
};
const EVENT_FIELDS = ['organizer_id', 'slug', 'title', 'category', 'description', 'poster', 'waiting_image', 'starts_at', 'ends_at',
  'status', 'price_cents', 'ticket_limit', 'provider', 'provider_ref', 'whitelist', 'ticker_text', 'replay_days', 'replay_ref'];
export function insertEvent(e) {
  const f = { organizer_id: '', category: 'other', description: '', poster: '', waiting_image: '', starts_at: null, ends_at: null, status: 'draft',
    price_cents: 0, ticket_limit: 0, provider: 'hls', provider_ref: '', whitelist: 0, ticker_text: '', replay_days: 7, replay_ref: '', ...e };
  q(`INSERT INTO ppv_events(id,${EVENT_FIELDS.join(',')},created_at) VALUES(?,${EVENT_FIELDS.map(() => '?').join(',')},?)`)
    .run(f.id, ...EVENT_FIELDS.map((k) => f[k] ?? null), now());
  return getEvent(f.id);
}
export function updateEvent(id, fields) {
  const keys = Object.keys(fields).filter((k) => EVENT_FIELDS.includes(k));
  if (!keys.length) return getEvent(id);
  q(`UPDATE ppv_events SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`).run(...keys.map((k) => fields[k]), id);
  return getEvent(id);
}
export const deleteEvent = (id) => q('UPDATE ppv_events SET deleted_at=? WHERE id=?').run(now(), id);

// ---------------- splits ----------------
export const getSplits = (eventId) => q('SELECT party, pct FROM ppv_splits WHERE event_id=?').all(eventId);
export function setSplits(eventId, shares) {
  const total = shares.reduce((a, s) => a + Number(s.pct), 0);
  if (Math.abs(total - 100) > 1e-9) throw new Error('shares must total 100');
  q('DELETE FROM ppv_splits WHERE event_id=?').run(eventId);
  const ins = q('INSERT INTO ppv_splits(event_id,party,pct) VALUES(?,?,?)');
  for (const s of shares) ins.run(eventId, String(s.party), Number(s.pct));
}

// ---------------- whitelist ----------------
export const whitelistHas = (eventId, email) => !!q('SELECT 1 FROM ppv_whitelist WHERE event_id=? AND email=?').get(eventId, email);
export const whitelistCount = (eventId) => q('SELECT COUNT(*) n FROM ppv_whitelist WHERE event_id=?').get(eventId).n;
export function whitelistAdd(eventId, emails) {
  const ins = q('INSERT OR IGNORE INTO ppv_whitelist(event_id,email) VALUES(?,?)');
  let n = 0; for (const e of emails) n += Number(ins.run(eventId, e).changes);
  return n;
}
export const whitelistList = (eventId) => q('SELECT email FROM ppv_whitelist WHERE event_id=? ORDER BY email').all(eventId).map((r) => r.email);

// ---------------- tickets ----------------
export const getTicket = (id) => q('SELECT * FROM ppv_tickets WHERE id=?').get(id);
export const ticketFor = (eventId, email) => q('SELECT * FROM ppv_tickets WHERE event_id=? AND email=?').get(eventId, email);
export const ticketsOf = (eventId) => q('SELECT * FROM ppv_tickets WHERE event_id=? ORDER BY created_at').all(eventId);
export const ticketsOfEmail = (email) => q(`SELECT t.*, e.slug, e.title FROM ppv_tickets t JOIN ppv_events e ON e.id=t.event_id WHERE t.email=? AND t.status='active' ORDER BY e.starts_at DESC`).all(email);
export const ticketCount = (eventId) => q("SELECT COUNT(*) n FROM ppv_tickets WHERE event_id=? AND status<>'refunded'").get(eventId).n;
export function insertTicket({ id, eventId, email, source = 'sale' }) {
  q('INSERT INTO ppv_tickets(id,event_id,email,source,created_at) VALUES(?,?,?,?,?)').run(id, eventId, email, source, now());
  return getTicket(id);
}
export const revokeTicket = (id, by) => q("UPDATE ppv_tickets SET status='revoked', revoked_at=?, revoked_by=? WHERE id=?").run(now(), by, id);
export const reinstateTicket = (id) => q("UPDATE ppv_tickets SET status='active', revoked_at=NULL, revoked_by='' WHERE id=?").run(id);
export function bumpSwitch(id, day) {
  const t = getTicket(id);
  const n = t.switch_day === day ? t.switches + 1 : 1;
  q('UPDATE ppv_tickets SET switches=?, switch_day=? WHERE id=?').run(n, day, id);
  return n;
}

// ---------------- viewer accounts and OTP ----------------
export const createAccount = (tokenHash, email, ttlMs) => q('INSERT INTO ppv_accounts(token_hash,email,created_at,expires_at) VALUES(?,?,?,?)').run(tokenHash, email, now(), now() + ttlMs);
export const accountByHash = (hash) => q('SELECT * FROM ppv_accounts WHERE token_hash=? AND expires_at>?').get(hash, now());
export const dropAccount = (hash) => q('DELETE FROM ppv_accounts WHERE token_hash=?').run(hash);
export const putOtp = (email, codeHash, ttlMs) => q('INSERT OR REPLACE INTO ppv_otps(email,code_hash,expires_at,tries,sent_at) VALUES(?,?,?,0,?)').run(email, codeHash, now() + ttlMs, now());
export const getOtp = (email) => q('SELECT * FROM ppv_otps WHERE email=?').get(email);
export const otpTry = (email) => q('UPDATE ppv_otps SET tries=tries+1 WHERE email=?').run(email);
export const dropOtp = (email) => q('DELETE FROM ppv_otps WHERE email=?').run(email);
export function otpRateOk(key, max, windowMs) {
  const t = now();
  q('DELETE FROM ppv_otp_sends WHERE at<?').run(t - 24 * 3600e3);
  const n = q('SELECT COUNT(*) n FROM ppv_otp_sends WHERE key=? AND at>?').get(key, t - windowMs).n;
  if (n >= max) return false;
  q('INSERT INTO ppv_otp_sends(key,at) VALUES(?,?)').run(key, t);
  return true;
}

// ---------------- viewing sessions ----------------
export const activeSession = (ticketId) => q('SELECT * FROM ppv_sessions WHERE ticket_id=? AND ended_at IS NULL ORDER BY id DESC LIMIT 1').get(ticketId);
export const getSession = (id) => q('SELECT * FROM ppv_sessions WHERE id=?').get(id);
export function startSession(ticketId, deviceHash) {
  const r = q('INSERT INTO ppv_sessions(ticket_id,device_hash,started_at,last_heartbeat) VALUES(?,?,?,?)').run(ticketId, deviceHash, now(), now());
  return getSession(Number(r.lastInsertRowid));
}
export const endSessions = (ticketId, reason) => q('UPDATE ppv_sessions SET ended_at=?, ended_reason=? WHERE ticket_id=? AND ended_at IS NULL').run(now(), reason, ticketId);
export const endSession = (id, reason) => q('UPDATE ppv_sessions SET ended_at=?, ended_reason=? WHERE id=? AND ended_at IS NULL').run(now(), reason, id);
export const touchSession = (id) => q('UPDATE ppv_sessions SET last_heartbeat=? WHERE id=?').run(now(), id);
export const liveViewerCount = (eventId, sinceMs) => q(`SELECT COUNT(*) n FROM ppv_sessions s JOIN ppv_tickets t ON t.id=s.ticket_id WHERE t.event_id=? AND s.ended_at IS NULL AND s.last_heartbeat>?`).get(eventId, sinceMs).n;

// ---------------- leak codes ----------------
export const leakCodesUsed = (eventId) => new Set(q('SELECT code FROM ppv_leak_codes WHERE event_id=?').all(eventId).map((r) => r.code));
export function insertLeak({ eventId, code, ticketId, sessionId, kind, showAt }) {
  const r = q('INSERT INTO ppv_leak_codes(event_id,code,ticket_id,session_id,kind,show_at) VALUES(?,?,?,?,?,?)').run(eventId, code, ticketId, sessionId, kind, showAt);
  return Number(r.lastInsertRowid);
}
export const ackLeak = (id, sessionId) => q('UPDATE ppv_leak_codes SET ack_at=? WHERE id=? AND session_id=? AND ack_at IS NULL').run(now(), id, sessionId);
export const leakByCode = (code) => q(`SELECT l.*, t.email, t.status AS ticket_status, e.title, e.slug, s.device_hash
  FROM ppv_leak_codes l JOIN ppv_tickets t ON t.id=l.ticket_id JOIN ppv_events e ON e.id=l.event_id LEFT JOIN ppv_sessions s ON s.id=l.session_id
  WHERE l.code=? ORDER BY l.show_at DESC`).all(code);
export const dueLeaks = (sessionId, upTo) => q('SELECT id, show_at AS at, ack_at FROM ppv_leak_codes WHERE session_id=? AND show_at<=?').all(sessionId, upTo);
export const pendingLeaks = (sessionId, from) => q('SELECT id, code, kind, show_at FROM ppv_leak_codes WHERE session_id=? AND show_at>=? AND ack_at IS NULL ORDER BY show_at').all(sessionId, from);

// ---------------- payments ----------------
export const getPayment = (id) => q('SELECT * FROM ppv_payments WHERE id=?').get(id);
export function insertPayment(p) {
  q('INSERT INTO ppv_payments(id,event_id,email,gateway,ref,gross_cents,fee_cents,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(p.id, p.eventId, p.email, p.gateway || 'manual', p.ref || '', p.grossCents, p.feeCents || 0, 'pending', now());
  return getPayment(p.id);
}
export const markPaid = (id, ticketId, feeCents = 0) => q("UPDATE ppv_payments SET status='paid', paid_at=?, ticket_id=?, fee_cents=? WHERE id=?").run(now(), ticketId, feeCents, id);
export const paymentsOf = (eventId) => q('SELECT * FROM ppv_payments WHERE event_id=? ORDER BY created_at DESC').all(eventId);
export const paidTotals = (eventId) => q("SELECT COALESCE(SUM(gross_cents),0) gross, COALESCE(SUM(fee_cents),0) fee, COUNT(*) n FROM ppv_payments WHERE event_id=? AND status='paid'").get(eventId);

// ---------------- orgs, members ----------------
export const getOrg = (organizerId) => q('SELECT * FROM ppv_orgs WHERE organizer_id=?').get(organizerId);
export const listOrgs = () => q('SELECT * FROM ppv_orgs ORDER BY created_at').all();
export function upsertOrg(o) {
  q(`INSERT INTO ppv_orgs(organizer_id,parent_id,kind,name,fee_fixed,fee_pct,created_at) VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(organizer_id) DO UPDATE SET parent_id=excluded.parent_id, kind=excluded.kind, name=excluded.name, fee_fixed=excluded.fee_fixed, fee_pct=excluded.fee_pct`)
    .run(o.organizerId, o.parentId || '', o.kind || 'client', o.name || '', o.feeFixed || 0, o.feePct || 0, now());
  return getOrg(o.organizerId);
}
export const addMember = (email, organizerId, role) => q('INSERT OR REPLACE INTO ppv_members(email,organizer_id,role,created_at) VALUES(?,?,?,?)').run(email, organizerId, role, now());
export const membershipsOf = (email) => q('SELECT * FROM ppv_members WHERE email=?').all(email);
export const memberRole = (email, organizerId) => q('SELECT role FROM ppv_members WHERE email=? AND organizer_id=?').get(email, organizerId)?.role || null;
export const membersOf = (organizerId) => q('SELECT * FROM ppv_members WHERE organizer_id=? ORDER BY email').all(organizerId);

// ---------------- settlements, discounts ----------------
export const settlementsOf = (eventId) => q('SELECT * FROM ppv_settlements WHERE event_id=?').all(eventId);
export function ensureSettlements(eventId, shares) {
  q('DELETE FROM ppv_settlements WHERE event_id=? AND paid_at IS NULL').run(eventId);
  const ins = q('INSERT INTO ppv_settlements(event_id,party,cents) VALUES(?,?,?)');
  const paid = new Set(settlementsOf(eventId).map((s) => s.party));
  for (const s of shares) if (!paid.has(s.id)) ins.run(eventId, s.id, s.cents);
}
export const markSettlementPaid = (id, ref) => q('UPDATE ppv_settlements SET paid_at=?, ref=? WHERE id=?').run(now(), ref || '', id);
export function createDiscount(eventId, pct, validUntil, by) {
  const r = q('INSERT INTO ppv_discounts(event_id,pct,valid_until,created_by,created_at) VALUES(?,?,?,?,?)').run(eventId, pct, validUntil, by, now());
  const id = Number(r.lastInsertRowid);
  q('INSERT OR IGNORE INTO ppv_discount_grants(discount_id,email) SELECT ?, email FROM ppv_tickets WHERE event_id=?').run(id, eventId);
  return id;
}
export const discountFor = (email) => q(`SELECT d.id, d.pct, d.valid_until FROM ppv_discount_grants g JOIN ppv_discounts d ON d.id=g.discount_id
  WHERE g.email=? AND g.used_at IS NULL AND d.valid_until>? ORDER BY d.pct DESC LIMIT 1`).get(email, now());
export const useDiscount = (discountId, email) => q('UPDATE ppv_discount_grants SET used_at=? WHERE discount_id=? AND email=?').run(now(), discountId, email);
