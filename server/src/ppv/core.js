// ppv core: pure functions (no DB, no HTTP) so this file can move to a Cloudflare Worker later.
// Leak codes, display schedule, signed viewing tokens, renew decision, ticker text.
import crypto from 'node:crypto';

// 31 characters: no 0 O 1 I L (look-alikes). 31^6 ~ 887 million codes.
export const LEAK_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const LEAK_LEN = 6;
export const WINDOW_MS = 15 * 60 * 1000;   // one code box per 15 minute window
export const SHOW_MS = 2000;               // shown for 2 seconds

const defaultInt = (max) => crypto.randomInt(max);

export function makeLeakCode(randInt = defaultInt) {
  let s = '';
  for (let i = 0; i < LEAK_LEN; i++) s += LEAK_ALPHABET[randInt(LEAK_ALPHABET.length)];
  return s;
}

/** A code that is not in `used` (a Set of codes already issued for the event). */
export function uniqueLeakCode(used, randInt = defaultInt) {
  for (let i = 0; i < 50; i++) {
    const c = makeLeakCode(randInt);
    if (!used.has(c)) { used.add(c); return c; }
  }
  throw new Error('could not find a unique leak code');
}

/**
 * Display schedule for a viewing session: one box per 15 minute window at a random moment
 * and a random position. `from` is epoch ms; returns `count` entries starting at the window of `from`.
 * pos is a fraction of the video (0..1) for the top-left corner, kept inside the frame.
 */
export function leakSchedule(from, count, randInt = defaultInt) {
  const out = [];
  const start = Math.floor(from / WINDOW_MS) * WINDOW_MS;
  for (let i = 0; i < count; i++) {
    const wStart = start + i * WINDOW_MS;
    const at = wStart + randInt(WINDOW_MS - SHOW_MS - 1000) + 500;
    if (at + SHOW_MS < from) continue;                        // already past
    out.push({ at, ms: SHOW_MS, x: 0.1 + randInt(7000) / 10000, y: 0.1 + randInt(7000) / 10000 });
  }
  return out;
}

/** Ticker text with the viewer's own code at the end of every repeat. */
export function tickerText(message, code) {
  const m = String(message || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return m ? `${m} ${code}` : '';
}

// ---------------- signed viewing token (HMAC-SHA256, short lived) ----------------
const b64 = (b) => Buffer.from(b).toString('base64url');

export function signToken(payload, secret) {
  const body = b64(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

/** Returns the payload or null (bad signature, malformed, or expired). `now` in epoch ms. */
export function verifyToken(token, secret, now = Date.now()) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const mac = crypto.createHmac('sha256', secret).update(parts[0]).digest();
  let given;
  try { given = Buffer.from(parts[1], 'base64url'); } catch { return null; }
  if (given.length !== mac.length || !crypto.timingSafeEqual(given, mac)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { return null; }
  if (!p || typeof p.exp !== 'number' || p.exp < now) return null;
  return p;
}

export const TOKEN_TTL_MS = 10 * 60 * 1000;   // 10 minutes
export const GRACE_MS = 60 * 1000;            // extra 60 s if the server cannot answer

/**
 * Renew decision on a heartbeat. The video token is renewed only while the player keeps
 * confirming the codes it was told to show:
 *  - `due`     codes scheduled to be shown before `now` (list of {at, id})
 *  - `acked`   Set of ids the player confirmed
 * Missing acks beyond the allowance mean the overlay is gone: do not renew.
 */
export function renewDecision({ now, due, acked, allowMissing = 1 }) {
  const missing = due.filter((d) => d.at + SHOW_MS + 5000 < now && !acked.has(d.id)).length;
  return missing > allowMissing ? { renew: false, reason: 'overlay_missing' } : { renew: true };
}

/** A device fingerprint hash from user agent + client hint (no raw data stored). */
export function deviceHash(ua, hint = '') {
  return crypto.createHash('sha256').update(`${ua}|${hint}`).digest('hex').slice(0, 32);
}

/** Money split: gross cents minus gateway fee, then pct shares (must total 100). Remainder goes to the first share. */
export function splitMoney(grossCents, gatewayFeeCents, shares) {
  const total = shares.reduce((a, s) => a + s.pct, 0);
  if (Math.abs(total - 100) > 1e-9) throw new Error('shares must total 100');
  const net = grossCents - gatewayFeeCents;
  const out = shares.map((s) => ({ id: s.id, cents: Math.floor((net * s.pct) / 100) }));
  const given = out.reduce((a, s) => a + s.cents, 0);
  out[0].cents += net - given;
  return { net, shares: out };
}
