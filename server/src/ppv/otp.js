// Email + OTP login for viewers and organisation members.
// 6 digits, valid 10 minutes, 5 wrong tries, resend limits per email and per IP.
import crypto from 'node:crypto';
import * as p from './db.js';
import { mailer } from './mail.js';
import { HttpError, randomToken, sha256 } from '../http.js';

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_TRIES = 5;
export const ACCOUNT_TTL_MS = 30 * 24 * 3600 * 1000;
const EMAIL_RE = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[A-Za-z]{2,}$/;

export const cleanEmail = (s) => String(s || '').trim().toLowerCase().slice(0, 254);
export const validEmail = (s) => EMAIL_RE.test(s);
const otpHash = (email, code) => sha256(`${email}:${code}:${process.env.PPV_SECRET || 'dev'}`);

/** Test mode: PPV_TEST_EMAILS=a@x.com,b@y.com gets its OTP back in the response (never for other emails). */
const testEmails = () => new Set(String(process.env.PPV_TEST_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean));

export async function sendOtp(emailRaw, ip) {
  const email = cleanEmail(emailRaw);
  if (!validEmail(email)) throw new HttpError(400, 'Enter a valid email');
  if (!p.otpRateOk(`e:${email}`, 5, 3600e3) || !p.otpRateOk(`i:${ip}`, 30, 3600e3)) throw new HttpError(429, 'Too many codes requested. Try again later.');
  const code = String(crypto.randomInt(1_000_000)).padStart(6, '0');
  p.putOtp(email, otpHash(email, code), OTP_TTL_MS);
  await mailer.send({ to: email, subject: `Kod log masuk ccam: ${code}`,
    text: `Kod log masuk anda: ${code}\nSah selama 10 minit. Jangan kongsi kod ini.` });
  return testEmails().has(email) ? { sent: true, testCode: code } : { sent: true };
}

/** Returns a new account token (cookie value) after a correct code. */
export function verifyOtp(emailRaw, codeRaw) {
  const email = cleanEmail(emailRaw), code = String(codeRaw || '').trim();
  const row = p.getOtp(email);
  if (!row || row.expires_at < Date.now()) throw new HttpError(401, 'Code expired. Ask for a new one.');
  if (row.tries >= OTP_MAX_TRIES) { p.dropOtp(email); throw new HttpError(429, 'Too many wrong codes. Ask for a new one.'); }
  const ok = row.code_hash.length === otpHash(email, code).length
    && crypto.timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(otpHash(email, code)));
  if (!ok) { p.otpTry(email); throw new HttpError(401, 'Wrong code'); }
  p.dropOtp(email);
  const token = randomToken();
  p.createAccount(sha256(token), email, ACCOUNT_TTL_MS);
  return { token, email };
}

export function accountOf(token) {
  if (!token) return null;
  const a = p.accountByHash(sha256(token));
  return a ? { email: a.email } : null;
}
