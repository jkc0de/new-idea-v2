'use strict';
const crypto = require('node:crypto');

const SESSION_DAYS = 30;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function createSession(db, businessId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_DAYS * 86400000;
  db.prepare('INSERT INTO sessions (token, business_id, expires_at) VALUES (?, ?, ?)').run(token, businessId, expires);
  return { token, maxAge: SESSION_DAYS * 86400 };
}

function businessForToken(db, token) {
  if (!token) return null;
  const row = db.prepare(
    'SELECT b.* FROM sessions s JOIN businesses b ON b.id = s.business_id WHERE s.token = ? AND s.expires_at > ?',
  ).get(token, Date.now());
  return row || null;
}

function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/** Short, unambiguous booking reference, e.g. "K7QM-29XD". */
function bookingRef() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[bytes[i] % alphabet.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

function randomToken() {
  return crypto.randomBytes(18).toString('hex');
}

module.exports = { hashPassword, verifyPassword, createSession, businessForToken, destroySession, bookingRef, randomToken };
