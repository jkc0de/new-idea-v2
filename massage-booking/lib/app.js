'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { tx } = require('./db');
const auth = require('./auth');
const sched = require('./scheduler');
const { isValidDate, addDays, nowInZone, isValidTimeZone, minutesBetween, parseTime } = require('./time');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,40}[a-z0-9])?$/;

class HttpError extends Error {
  constructor(status, message, data = null) { super(message); this.status = status; this.data = data; }
}
const bad = (msg) => new HttpError(400, msg);
const notFound = (msg = 'Not found') => new HttpError(404, msg);

// ---------- small helpers ----------
function str(v, max = 500) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
function int(v, { min = -Infinity, max = Infinity, name = 'value' } = {}) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`Invalid ${name}`);
  return n;
}
function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'spa';
}
function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) { reject(new HttpError(413, 'Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(bad('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}
// The API allows any origin but never credentials (cookies) cross-origin, so CSRF isn't possible:
// cross-origin callers (the mobile app) must send an explicit Bearer token.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Max-Age': '600',
};
function send(res, status, body, headers = {}) {
  const data = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS, ...headers });
  res.end(data);
}
function serveFile(res, file) {
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, { error: 'Not found' });
  fs.readFile(full, (err, data) => {
    if (err) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    });
    res.end(data);
  });
}

// ---------- serializers ----------
function publicBusiness(b) {
  return {
    name: b.name, slug: b.slug, phone: b.phone, address: b.address, timezone: b.timezone, currency: b.currency,
    leadTimeMin: b.lead_time_min, bookingWindowDays: b.booking_window_days, cancelCutoffHours: b.cancel_cutoff_hours,
  };
}
function ownerBusiness(b) {
  return { ...publicBusiness(b), id: b.id, email: b.email, slotStepMin: b.slot_step_min };
}
function serviceOut(s) {
  return {
    id: s.id, name: s.name, description: s.description, durationMin: s.duration_min,
    priceCents: s.price_cents, bufferMin: s.buffer_min, active: !!s.active,
  };
}
const APPT_SELECT = `
  SELECT a.*, t.name AS therapist_name, s.name AS service_name, c.name AS client_name, c.email AS client_email, c.phone AS client_phone,
    rm.name AS room_name
  FROM appointments a
  JOIN therapists t ON t.id = a.therapist_id
  JOIN services s ON s.id = a.service_id
  JOIN clients c ON c.id = a.client_id
  LEFT JOIN rooms rm ON rm.id = a.room_id`;
function apptOut(a, { includePrivate = true } = {}) {
  const out = {
    id: a.id, ref: a.ref, date: a.date, startMin: a.start_min, endMin: a.end_min, status: a.status,
    priceCents: a.price_cents, therapistId: a.therapist_id, therapistName: a.therapist_name,
    serviceId: a.service_id, serviceName: a.service_name, clientNotes: a.client_notes,
    clientName: a.client_name, roomId: a.room_id ?? null, roomName: a.room_name ?? null,
  };
  if (includePrivate) {
    Object.assign(out, {
      clientId: a.client_id, clientEmail: a.client_email, clientPhone: a.client_phone,
      internalNotes: a.internal_notes, source: a.source, createdAt: a.created_at, updatedAt: a.updated_at ?? null,
    });
  }
  return out;
}

// ---------- router ----------
function createRouter() {
  const routes = [];
  const add = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, handler, opts });
  };
  const match = (method, pathname) => {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(pathname);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { route: r, params };
      }
    }
    return null;
  };
  return { add, match };
}

function createApp(db, { now = () => new Date(), secureCookies = false } = {}) {
  const r = createRouter();
  const cookieFlags = `HttpOnly; SameSite=Lax; Path=/${secureCookies ? '; Secure' : ''}`;

  // ----- lookups scoped to a business (prevents cross-tenant access) -----
  const getService = (bid, id) => db.prepare('SELECT * FROM services WHERE id = ? AND business_id = ?').get(id, bid);
  const getTherapist = (bid, id) => db.prepare('SELECT * FROM therapists WHERE id = ? AND business_id = ?').get(id, bid);
  const getBySlug = (slug) => db.prepare('SELECT * FROM businesses WHERE slug = ?').get(slug);

  function therapistOut(t, { withHours = true } = {}) {
    const serviceIds = db.prepare('SELECT service_id FROM therapist_services WHERE therapist_id = ?').all(t.id).map((x) => x.service_id);
    const out = {
      id: t.id, name: t.name, bio: t.bio, active: !!t.active, serviceIds,
      maxSessionsPerDay: t.max_sessions_per_day ?? null, maxConsecutiveMin: t.max_consecutive_min ?? null, minBreakMin: t.min_break_min ?? 30,
    };
    if (withHours) {
      out.hours = db.prepare('SELECT weekday, start_min AS startMin, end_min AS endMin FROM availability WHERE therapist_id = ? ORDER BY weekday, start_min')
        .all(t.id).map((h) => ({ ...h }));
    }
    return out;
  }

  function upsertClient(bid, { name, email, phone }) {
    const existing = db.prepare('SELECT * FROM clients WHERE business_id = ? AND email = ?').get(bid, email);
    if (existing) {
      db.prepare('UPDATE clients SET name = ?, phone = COALESCE(NULLIF(?, \'\'), phone) WHERE id = ?').run(name, phone, existing.id);
      return existing.id;
    }
    return Number(db.prepare('INSERT INTO clients (business_id, name, email, phone) VALUES (?, ?, ?, ?)').run(bid, name, email, phone).lastInsertRowid);
  }

  function readClient(body) {
    const name = str(body.name, 120);
    const email = str(body.email, 200).toLowerCase();
    const phone = str(body.phone, 40);
    if (!name) throw bad('Name is required');
    if (!EMAIL_RE.test(email)) throw bad('A valid email is required');
    return { name, email, phone };
  }

  function logEvent(appointmentId, actor, type, detail = {}) {
    db.prepare('INSERT INTO appointment_events (appointment_id, actor, type, detail) VALUES (?, ?, ?, ?)')
      .run(appointmentId, actor, type, JSON.stringify(detail));
  }

  function eventsFor(appointmentId) {
    return db.prepare('SELECT id, at, actor, type, detail FROM appointment_events WHERE appointment_id = ? ORDER BY id')
      .all(appointmentId).map((e) => ({ id: e.id, at: e.at, actor: e.actor, type: e.type, detail: JSON.parse(e.detail || '{}') }));
  }

  function insertAppointment({ business, therapistId, roomId = null, service, date, start, client, clientNotes, source, override = [] }) {
    const clientId = upsertClient(business.id, client);
    let ref;
    do { ref = auth.bookingRef(); } while (db.prepare('SELECT 1 FROM appointments WHERE ref = ?').get(ref));
    const info = db.prepare(
      `INSERT INTO appointments (business_id, therapist_id, room_id, service_id, client_id, date, start_min, end_min, block_end_min,
         price_cents, client_notes, ref, manage_token, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(business.id, therapistId, roomId, service.id, clientId, date, start, start + service.duration_min,
      start + service.duration_min + service.buffer_min, service.price_cents, clientNotes, ref, auth.randomToken(), source);
    const id = Number(info.lastInsertRowid);
    logEvent(id, source === 'online' ? 'client' : 'staff', 'created', { date, startMin: start, therapistId, roomId, serviceId: service.id, ...(override.length ? { override } : {}) });
    return db.prepare(`${APPT_SELECT} WHERE a.id = ?`).get(id);
  }

  /** Throws a 409 that explains exactly why a booking can't happen. Staff can pass `override` to accept soft issues. */
  function assertBookable(ctx, therapistId, verdict, { allowSoft }) {
    if (verdict.hard.length) {
      const issues = sched.describe(ctx, therapistId, verdict.hard);
      throw new HttpError(409, issues[0].message, { issues, canOverride: false });
    }
    if (verdict.soft.length && !allowSoft) {
      const issues = sched.describe(ctx, therapistId, verdict.soft);
      throw new HttpError(409, issues.map((i) => i.message).join('. '), { issues, canOverride: true });
    }
  }

  // ===================== AUTH =====================
  r.add('POST', '/api/auth/signup', async ({ body }) => {
    const name = str(body.businessName, 120);
    const email = str(body.email, 200).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const timezone = isValidTimeZone(body.timezone) ? body.timezone : 'UTC';
    if (!name) throw bad('Business name is required');
    if (!EMAIL_RE.test(email)) throw bad('A valid email is required');
    if (password.length < 8) throw bad('Password must be at least 8 characters');
    if (db.prepare('SELECT 1 FROM businesses WHERE email = ?').get(email)) throw new HttpError(409, 'An account with that email already exists');

    let base = slugify(name);
    let slug = base;
    for (let i = 2; db.prepare('SELECT 1 FROM businesses WHERE slug = ?').get(slug); i++) slug = `${base}-${i}`;

    const id = Number(db.prepare('INSERT INTO businesses (name, slug, email, password_hash, timezone) VALUES (?, ?, ?, ?, ?)')
      .run(name, slug, email, auth.hashPassword(password), timezone).lastInsertRowid);
    const s = auth.createSession(db, id);
    return { status: 201, body: { business: ownerBusiness(getBySlug(slug)), token: s.token }, headers: { 'Set-Cookie': `sid=${s.token}; Max-Age=${s.maxAge}; ${cookieFlags}` } };
  });

  r.add('POST', '/api/auth/login', async ({ body }) => {
    const email = str(body.email, 200).toLowerCase();
    const b = db.prepare('SELECT * FROM businesses WHERE email = ?').get(email);
    if (!b || !auth.verifyPassword(String(body.password || ''), b.password_hash)) throw new HttpError(401, 'Wrong email or password');
    const s = auth.createSession(db, b.id);
    return { body: { business: ownerBusiness(b), token: s.token }, headers: { 'Set-Cookie': `sid=${s.token}; Max-Age=${s.maxAge}; ${cookieFlags}` } };
  });

  r.add('POST', '/api/auth/logout', async ({ sessionToken }) => {
    auth.destroySession(db, sessionToken);
    return { body: { ok: true }, headers: { 'Set-Cookie': `sid=; Max-Age=0; ${cookieFlags}` } };
  });

  // ===================== OWNER: BUSINESS =====================
  r.add('GET', '/api/me', async ({ business }) => ({ body: { business: ownerBusiness(business) } }), { auth: true });

  r.add('PUT', '/api/business', async ({ business, body }) => {
    const b = business;
    const name = body.name !== undefined ? str(body.name, 120) : b.name;
    if (!name) throw bad('Business name is required');
    let slug = b.slug;
    if (body.slug !== undefined && body.slug !== b.slug) {
      slug = str(body.slug, 42).toLowerCase();
      if (!SLUG_RE.test(slug)) throw bad('Booking link must be 3–42 lowercase letters, numbers or dashes');
      if (getBySlug(slug)) throw new HttpError(409, 'That booking link is taken');
    }
    const timezone = body.timezone !== undefined ? body.timezone : b.timezone;
    if (!isValidTimeZone(timezone)) throw bad('Unknown time zone');
    const currency = body.currency !== undefined ? str(body.currency, 3).toUpperCase() : b.currency;
    try { new Intl.NumberFormat('en', { style: 'currency', currency }); } catch { throw bad('Unknown currency code'); }
    db.prepare(`UPDATE businesses SET name = ?, slug = ?, phone = ?, address = ?, timezone = ?, currency = ?,
      lead_time_min = ?, booking_window_days = ?, cancel_cutoff_hours = ?, slot_step_min = ? WHERE id = ?`).run(
      name, slug,
      body.phone !== undefined ? str(body.phone, 40) : b.phone,
      body.address !== undefined ? str(body.address, 300) : b.address,
      timezone, currency,
      body.leadTimeMin !== undefined ? int(body.leadTimeMin, { min: 0, max: 60 * 24 * 14, name: 'lead time' }) : b.lead_time_min,
      body.bookingWindowDays !== undefined ? int(body.bookingWindowDays, { min: 1, max: 365, name: 'booking window' }) : b.booking_window_days,
      body.cancelCutoffHours !== undefined ? int(body.cancelCutoffHours, { min: 0, max: 24 * 14, name: 'cancellation cutoff' }) : b.cancel_cutoff_hours,
      body.slotStepMin !== undefined ? int(body.slotStepMin, { min: 5, max: 120, name: 'slot interval' }) : b.slot_step_min,
      b.id,
    );
    return { body: { business: ownerBusiness(getBySlug(slug)) } };
  }, { auth: true });

  r.add('GET', '/api/stats', async ({ business }) => {
    const today = nowInZone(business.timezone, now()).date;
    const weekEnd = addDays(today, 6);
    const q = (sql, ...args) => db.prepare(sql).get(business.id, ...args);
    return {
      body: {
        today,
        todayCount: q(`SELECT COUNT(*) n FROM appointments WHERE business_id = ? AND date = ? AND status IN ('booked','completed')`, today).n,
        next7Count: q(`SELECT COUNT(*) n FROM appointments WHERE business_id = ? AND date BETWEEN ? AND ? AND status = 'booked'`, today, weekEnd).n,
        next7RevenueCents: q(`SELECT COALESCE(SUM(price_cents),0) n FROM appointments WHERE business_id = ? AND date BETWEEN ? AND ? AND status = 'booked'`, today, weekEnd).n,
        last30RevenueCents: q(`SELECT COALESCE(SUM(price_cents),0) n FROM appointments WHERE business_id = ? AND date BETWEEN ? AND ? AND status = 'completed'`, addDays(today, -30), today).n,
        clientCount: q('SELECT COUNT(*) n FROM clients WHERE business_id = ?').n,
      },
    };
  }, { auth: true });

  // ===================== OWNER: SERVICES =====================
  function readService(body, existing = {}) {
    const name = body.name !== undefined ? str(body.name, 120) : existing.name;
    if (!name) throw bad('Service name is required');
    return {
      name,
      description: body.description !== undefined ? str(body.description, 1000) : (existing.description || ''),
      duration: body.durationMin !== undefined ? int(body.durationMin, { min: 5, max: 600, name: 'duration' }) : existing.duration_min,
      price: body.priceCents !== undefined ? int(body.priceCents, { min: 0, max: 10_000_000, name: 'price' }) : (existing.price_cents ?? 0),
      buffer: body.bufferMin !== undefined ? int(body.bufferMin, { min: 0, max: 240, name: 'buffer' }) : (existing.buffer_min ?? 0),
      active: body.active !== undefined ? (body.active ? 1 : 0) : (existing.active ?? 1),
    };
  }
  const getRoom = (bid, id) => db.prepare('SELECT * FROM rooms WHERE id = ? AND business_id = ?').get(id, bid);
  function serviceFull(s) {
    return { ...serviceOut(s), roomIds: db.prepare('SELECT room_id FROM service_rooms WHERE service_id = ? ORDER BY room_id').all(s.id).map((x) => x.room_id) };
  }
  function saveServiceRooms(bid, serviceId, roomIds) {
    if (!Array.isArray(roomIds)) return;
    db.prepare('DELETE FROM service_rooms WHERE service_id = ?').run(serviceId);
    const ins = db.prepare('INSERT OR IGNORE INTO service_rooms (service_id, room_id) VALUES (?, ?)');
    for (const rid of roomIds) {
      if (!getRoom(bid, rid)) throw bad('Unknown room');
      ins.run(serviceId, Number(rid));
    }
  }

  r.add('GET', '/api/services', async ({ business }) => ({
    body: { services: db.prepare('SELECT * FROM services WHERE business_id = ? ORDER BY active DESC, name').all(business.id).map(serviceFull) },
  }), { auth: true });

  r.add('POST', '/api/services', async ({ business, body }) => {
    if (body.durationMin === undefined) throw bad('Duration is required');
    const s = readService(body);
    const id = tx(db, () => {
      const newId = Number(db.prepare('INSERT INTO services (business_id, name, description, duration_min, price_cents, buffer_min, active) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(business.id, s.name, s.description, s.duration, s.price, s.buffer, s.active).lastInsertRowid);
      saveServiceRooms(business.id, newId, body.roomIds);
      return newId;
    });
    return { status: 201, body: { service: serviceFull(getService(business.id, id)) } };
  }, { auth: true });

  r.add('PUT', '/api/services/:id', async ({ business, body, params }) => {
    const existing = getService(business.id, params.id);
    if (!existing) throw notFound('Service not found');
    const s = readService(body, existing);
    tx(db, () => {
      db.prepare('UPDATE services SET name = ?, description = ?, duration_min = ?, price_cents = ?, buffer_min = ?, active = ? WHERE id = ?')
        .run(s.name, s.description, s.duration, s.price, s.buffer, s.active, existing.id);
      saveServiceRooms(business.id, existing.id, body.roomIds);
    });
    return { body: { service: serviceFull(getService(business.id, existing.id)) } };
  }, { auth: true });

  r.add('DELETE', '/api/services/:id', async ({ business, params }) => {
    const existing = getService(business.id, params.id);
    if (!existing) throw notFound('Service not found');
    const used = db.prepare('SELECT 1 FROM appointments WHERE service_id = ? LIMIT 1').get(existing.id);
    if (used) {
      db.prepare('UPDATE services SET active = 0 WHERE id = ?').run(existing.id);
      return { body: { archived: true } };
    }
    db.prepare('DELETE FROM services WHERE id = ?').run(existing.id);
    return { body: { deleted: true } };
  }, { auth: true });

  // ===================== OWNER: ROOMS =====================
  const roomOut = (rm) => ({
    id: rm.id, name: rm.name, active: !!rm.active, sort: rm.sort,
    serviceIds: db.prepare('SELECT service_id FROM service_rooms WHERE room_id = ? ORDER BY service_id').all(rm.id).map((x) => x.service_id),
  });

  r.add('GET', '/api/rooms', async ({ business }) => ({
    body: { rooms: db.prepare('SELECT * FROM rooms WHERE business_id = ? ORDER BY active DESC, sort, id').all(business.id).map(roomOut) },
  }), { auth: true });

  r.add('POST', '/api/rooms', async ({ business, body }) => {
    const name = str(body.name, 80);
    if (!name) throw bad('Room name is required');
    const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM rooms WHERE business_id = ?').get(business.id).n;
    const id = Number(db.prepare('INSERT INTO rooms (business_id, name, sort) VALUES (?, ?, ?)').run(business.id, name, sort).lastInsertRowid);
    return { status: 201, body: { room: roomOut(getRoom(business.id, id)) } };
  }, { auth: true });

  r.add('PUT', '/api/rooms/:id', async ({ business, body, params }) => {
    const rm = getRoom(business.id, params.id);
    if (!rm) throw notFound('Room not found');
    const name = body.name !== undefined ? str(body.name, 80) : rm.name;
    if (!name) throw bad('Room name is required');
    db.prepare('UPDATE rooms SET name = ?, active = ?, sort = ? WHERE id = ?').run(
      name, body.active !== undefined ? (body.active ? 1 : 0) : rm.active,
      body.sort !== undefined ? int(body.sort, { min: 0, max: 1000, name: 'order' }) : rm.sort, rm.id);
    return { body: { room: roomOut(getRoom(business.id, rm.id)) } };
  }, { auth: true });

  r.add('DELETE', '/api/rooms/:id', async ({ business, params }) => {
    const rm = getRoom(business.id, params.id);
    if (!rm) throw notFound('Room not found');
    if (db.prepare('SELECT 1 FROM appointments WHERE room_id = ? LIMIT 1').get(rm.id)) {
      db.prepare('UPDATE rooms SET active = 0 WHERE id = ?').run(rm.id);
      return { body: { archived: true } };
    }
    db.prepare('DELETE FROM rooms WHERE id = ?').run(rm.id);
    return { body: { deleted: true } };
  }, { auth: true });

  // ===================== OWNER: THERAPISTS =====================
  function readBlocks(list, label = 'Working hours') {
    const blocks = list.map((h) => {
      const startMin = int(h.startMin, { min: 0, max: 1440, name: 'start time' });
      const endMin = int(h.endMin, { min: 0, max: 1440, name: 'end time' });
      if (endMin <= startMin) throw bad(`${label} must end after they start`);
      return { ...h, startMin, endMin };
    }).sort((a, b) => a.startMin - b.startMin);
    return blocks;
  }

  function saveTherapistExtras(bid, therapistId, body) {
    if (Array.isArray(body.serviceIds)) {
      db.prepare('DELETE FROM therapist_services WHERE therapist_id = ?').run(therapistId);
      const ins = db.prepare('INSERT OR IGNORE INTO therapist_services (therapist_id, service_id) VALUES (?, ?)');
      for (const sid of body.serviceIds) {
        if (!getService(bid, sid)) throw bad('Unknown service');
        ins.run(therapistId, Number(sid));
      }
    }
    if (Array.isArray(body.hours)) {
      const hours = readBlocks(body.hours).map((h) => ({ ...h, weekday: int(h.weekday, { min: 0, max: 6, name: 'weekday' }) }));
      for (let d = 0; d < 7; d++) {
        const day = hours.filter((h) => h.weekday === d);
        for (let i = 1; i < day.length; i++) if (day[i].startMin < day[i - 1].endMin) throw bad('Working hours overlap on the same day');
      }
      db.prepare('DELETE FROM availability WHERE therapist_id = ?').run(therapistId);
      const ins = db.prepare('INSERT INTO availability (therapist_id, weekday, start_min, end_min) VALUES (?, ?, ?, ?)');
      for (const h of hours) ins.run(therapistId, h.weekday, h.startMin, h.endMin);
    }
    const limit = (v, name, max) => (v === null || v === '' || v === 0 ? null : int(v, { min: 1, max, name }));
    const t = getTherapist(bid, therapistId);
    db.prepare('UPDATE therapists SET max_sessions_per_day = ?, max_consecutive_min = ?, min_break_min = ? WHERE id = ?').run(
      body.maxSessionsPerDay !== undefined ? limit(body.maxSessionsPerDay, 'daily session limit', 30) : t.max_sessions_per_day,
      body.maxConsecutiveMin !== undefined ? limit(body.maxConsecutiveMin, 'continuous work limit', 720) : t.max_consecutive_min,
      body.minBreakMin !== undefined ? int(body.minBreakMin, { min: 5, max: 180, name: 'break length' }) : t.min_break_min,
      therapistId,
    );
  }

  r.add('GET', '/api/therapists', async ({ business }) => ({
    body: { therapists: db.prepare('SELECT * FROM therapists WHERE business_id = ? ORDER BY active DESC, name').all(business.id).map((t) => therapistOut(t)) },
  }), { auth: true });

  r.add('POST', '/api/therapists', async ({ business, body }) => {
    const name = str(body.name, 120);
    if (!name) throw bad('Therapist name is required');
    const t = tx(db, () => {
      const id = Number(db.prepare('INSERT INTO therapists (business_id, name, bio) VALUES (?, ?, ?)').run(business.id, name, str(body.bio, 1000)).lastInsertRowid);
      saveTherapistExtras(business.id, id, body);
      return getTherapist(business.id, id);
    });
    return { status: 201, body: { therapist: therapistOut(t) } };
  }, { auth: true });

  r.add('PUT', '/api/therapists/:id', async ({ business, body, params }) => {
    const existing = getTherapist(business.id, params.id);
    if (!existing) throw notFound('Therapist not found');
    const t = tx(db, () => {
      const name = body.name !== undefined ? str(body.name, 120) : existing.name;
      if (!name) throw bad('Therapist name is required');
      db.prepare('UPDATE therapists SET name = ?, bio = ?, active = ? WHERE id = ?').run(
        name,
        body.bio !== undefined ? str(body.bio, 1000) : existing.bio,
        body.active !== undefined ? (body.active ? 1 : 0) : existing.active,
        existing.id,
      );
      saveTherapistExtras(business.id, existing.id, body);
      return getTherapist(business.id, existing.id);
    });
    return { body: { therapist: therapistOut(t), conflicts: futureConflicts(business, { therapistId: t.id }) } };
  }, { auth: true });

  r.add('DELETE', '/api/therapists/:id', async ({ business, params }) => {
    const existing = getTherapist(business.id, params.id);
    if (!existing) throw notFound('Therapist not found');
    if (db.prepare('SELECT 1 FROM appointments WHERE therapist_id = ? LIMIT 1').get(existing.id)) {
      db.prepare('UPDATE therapists SET active = 0 WHERE id = ?').run(existing.id);
      return { body: { archived: true, conflicts: futureConflicts(business, { therapistId: existing.id }) } };
    }
    db.prepare('DELETE FROM therapists WHERE id = ?').run(existing.id);
    return { body: { deleted: true } };
  }, { auth: true });

  r.add('GET', '/api/therapists/:id/time-off', async ({ business, params }) => {
    const t = getTherapist(business.id, params.id);
    if (!t) throw notFound('Therapist not found');
    const today = nowInZone(business.timezone, now()).date;
    return {
      body: {
        timeOff: db.prepare('SELECT id, date, start_min AS startMin, end_min AS endMin, reason FROM time_off WHERE therapist_id = ? AND date >= ? ORDER BY date, start_min')
          .all(t.id, today).map((x) => ({ ...x })),
      },
    };
  }, { auth: true });

  r.add('POST', '/api/therapists/:id/time-off', async ({ business, params, body }) => {
    const t = getTherapist(business.id, params.id);
    if (!t) throw notFound('Therapist not found');
    if (!isValidDate(body.date)) throw bad('Invalid date');
    const endDate = body.endDate ? body.endDate : body.date;
    if (!isValidDate(endDate) || endDate < body.date) throw bad('Invalid end date');
    const startMin = body.startMin === undefined ? 0 : int(body.startMin, { min: 0, max: 1440, name: 'start time' });
    const endMin = body.endMin === undefined ? 1440 : int(body.endMin, { min: 0, max: 1440, name: 'end time' });
    if (endMin <= startMin) throw bad('Time off must end after it starts');
    const ins = db.prepare('INSERT INTO time_off (therapist_id, date, start_min, end_min, reason) VALUES (?, ?, ?, ?, ?)');
    let count = 0;
    tx(db, () => {
      for (let d = body.date; d <= endDate && count < 120; d = addDays(d, 1), count++) ins.run(t.id, d, startMin, endMin, str(body.reason, 200));
    });
    // Bookings that now clash with the time off — the app asks the owner to move them.
    return { status: 201, body: { created: count, conflicts: futureConflicts(business, { therapistId: t.id, from: body.date, to: endDate }) } };
  }, { auth: true });

  r.add('DELETE', '/api/time-off/:id', async ({ business, params }) => {
    const row = db.prepare('SELECT o.id FROM time_off o JOIN therapists t ON t.id = o.therapist_id WHERE o.id = ? AND t.business_id = ?').get(params.id, business.id);
    if (!row) throw notFound();
    db.prepare('DELETE FROM time_off WHERE id = ?').run(row.id);
    return { body: { deleted: true } };
  }, { auth: true });

  /** Custom hours for specific dates (e.g. covering a late shift, or a short day). */
  r.add('GET', '/api/therapists/:id/overrides', async ({ business, params }) => {
    const t = getTherapist(business.id, params.id);
    if (!t) throw notFound('Therapist not found');
    const today = nowInZone(business.timezone, now()).date;
    const rows = db.prepare('SELECT id, date, start_min AS startMin, end_min AS endMin, note FROM schedule_overrides WHERE therapist_id = ? AND date >= ? ORDER BY date, start_min').all(t.id, today);
    const byDate = new Map();
    for (const x of rows) {
      if (!byDate.has(x.date)) byDate.set(x.date, { date: x.date, note: x.note, blocks: [] });
      byDate.get(x.date).blocks.push({ startMin: x.startMin, endMin: x.endMin });
    }
    return { body: { overrides: [...byDate.values()] } };
  }, { auth: true });

  /** Replace the custom hours for one date. Send blocks: [] to go back to the weekly hours. */
  r.add('PUT', '/api/therapists/:id/overrides/:date', async ({ business, params, body }) => {
    const t = getTherapist(business.id, params.id);
    if (!t) throw notFound('Therapist not found');
    if (!isValidDate(params.date)) throw bad('Invalid date');
    const blocks = readBlocks(Array.isArray(body.blocks) ? body.blocks : []);
    for (let i = 1; i < blocks.length; i++) if (blocks[i].startMin < blocks[i - 1].endMin) throw bad('Hours overlap');
    tx(db, () => {
      db.prepare('DELETE FROM schedule_overrides WHERE therapist_id = ? AND date = ?').run(t.id, params.date);
      const ins = db.prepare('INSERT INTO schedule_overrides (therapist_id, date, start_min, end_min, note) VALUES (?, ?, ?, ?, ?)');
      for (const bl of blocks) ins.run(t.id, params.date, bl.startMin, bl.endMin, str(body.note, 200));
    });
    return { body: { ok: true, conflicts: futureConflicts(business, { therapistId: t.id, from: params.date, to: params.date }) } };
  }, { auth: true });

  // ===================== OWNER: SCHEDULE & INVENTORY =====================
  const loadDay = (business, date, opts) => sched.loadDay(db, business.id, date, opts);

  /** Booked appointments that no longer fit their therapist's schedule. */
  function futureConflicts(business, { therapistId = null, from = null, to = null } = {}) {
    const today = nowInZone(business.timezone, now()).date;
    const start = from && from > today ? from : today;
    const end = to || addDays(today, 180);
    const where = ["a.business_id = ?", "a.status = 'booked'", 'a.date BETWEEN ? AND ?'];
    const args = [business.id, start, end];
    if (therapistId) { where.push('a.therapist_id = ?'); args.push(therapistId); }
    const rows = db.prepare(`${APPT_SELECT} WHERE ${where.join(' AND ')} ORDER BY a.date, a.start_min`).all(...args);
    const ctxByDate = new Map();
    const out = [];
    for (const a of rows) {
      if (!ctxByDate.has(a.date)) ctxByDate.set(a.date, loadDay(business, a.date));
      const ctx = ctxByDate.get(a.date);
      const codes = sched.scheduleIssues(ctx, a);
      if (codes.length) out.push({ ...apptOut(a), issues: sched.describe(ctx, a.therapist_id, codes) });
    }
    return out;
  }

  r.add('GET', '/api/conflicts', async ({ business }) => ({ body: { conflicts: futureConflicts(business) } }), { auth: true });

  function inventoryRange(business, from, days) {
    const therapists = db.prepare('SELECT id, name, active FROM therapists WHERE business_id = ? ORDER BY name').all(business.id);
    const rooms = db.prepare('SELECT id, name FROM rooms WHERE business_id = ? AND active = 1 ORDER BY sort, id').all(business.id);
    const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
    const rows = new Map(therapists.map((t) => [t.id, { id: t.id, name: t.name, active: !!t.active, days: [] }]));
    const totals = [];
    for (const date of dates) {
      const ctx = loadDay(business, date);
      const inv = new Map(sched.dayInventory(ctx).map((x) => [x.therapistId, x]));
      let available = 0; let booked = 0; let sessions = 0;
      for (const t of therapists) {
        const x = inv.get(t.id) || { availableMin: 0, bookedMin: 0, freeMin: 0, sessions: 0, utilization: 0, working: false, overridden: false, hasTimeOff: false, maxSessions: null };
        rows.get(t.id).days.push({ date, ...x, therapistId: undefined });
        available += x.availableMin; booked += x.bookedMin; sessions += x.sessions;
      }
      const roomUse = rooms.map((rm) => ({ roomId: rm.id, bookedMin: (ctx.roomAppts.get(rm.id) || []).reduce((n, a) => n + (a.end - a.start), 0) }));
      totals.push({ date, availableMin: available, bookedMin: booked, freeMin: Math.max(0, available - booked), sessions, utilization: available ? Math.min(1, booked / available) : 0, rooms: roomUse });
    }
    return { from, days: dates, therapists: [...rows.values()].filter((t) => t.active || t.days.some((d) => d.sessions)), rooms, totals };
  }

  /** Capacity vs. booked time per therapist per day — the studio's "inventory". */
  r.add('GET', '/api/inventory', async ({ business, query }) => {
    const today = nowInZone(business.timezone, now()).date;
    const from = isValidDate(query.get('from')) ? query.get('from') : today;
    const days = Math.min(Math.max(Number(query.get('days')) || 7, 1), 31);
    return { body: { today, ...inventoryRange(business, from, days) } };
  }, { auth: true });

  /** Everything the day view needs in one call. */
  r.add('GET', '/api/schedule', async ({ business, query }) => {
    const today = nowInZone(business.timezone, now()).date;
    const date = isValidDate(query.get('date')) ? query.get('date') : today;
    const ctx = loadDay(business, date);
    const inv = new Map(sched.dayInventory(ctx).map((x) => [x.therapistId, x]));
    const therapists = [...ctx.therapists.values()].filter((d) => d.t.active || d.appts.length).sort((a, b) => a.t.name.localeCompare(b.t.name)).map((d) => ({
      id: d.t.id,
      name: d.t.name,
      active: !!d.t.active,
      hours: d.windows.map((w) => ({ startMin: w.start, endMin: w.end })),
      overridden: d.overridden,
      timeOff: d.timeOff.map((o) => ({ id: o.id, startMin: o.start, endMin: o.end, reason: o.reason })),
      maxSessionsPerDay: d.t.max_sessions_per_day ?? null,
      inventory: inv.get(d.t.id) || null,
    }));
    const appts = db.prepare(`${APPT_SELECT} WHERE a.business_id = ? AND a.date = ? ORDER BY a.start_min`).all(business.id, date);
    const appointments = appts.map((a) => {
      const out = apptOut(a);
      if (a.status === 'booked') {
        const codes = sched.scheduleIssues(ctx, a);
        if (codes.length) out.issues = sched.describe(ctx, a.therapist_id, codes);
      }
      return out;
    });
    return {
      body: {
        date, today, therapists, appointments,
        rooms: ctx.rooms.map((rm) => ({ id: rm.id, name: rm.name })),
      },
    };
  }, { auth: true });

  /** Open start times for staff (respects every rule, ignores online lead time). Pass excludeId when moving a booking. */
  function staffSlots(business, query, date) {
    const service = getService(business.id, query.get('serviceId'));
    if (!service) throw bad('Choose a service');
    const excludeId = query.get('excludeId') ? Number(query.get('excludeId')) : null;
    let ids = sched.therapistsFor(db, business.id, service.id);
    if (query.get('therapistId')) {
      const t = getTherapist(business.id, query.get('therapistId'));
      if (!t) throw bad('Unknown therapist');
      ids = [t.id];
    }
    const ctx = loadDay(business, date, { excludeId });
    return sched.slots(ctx, business, service, ids, sched.staffRule(business, date, now()));
  }

  r.add('GET', '/api/staff/slots', async ({ business, query }) => {
    const date = query.get('date');
    if (!isValidDate(date)) throw bad('Invalid date');
    return { body: { date, slots: staffSlots(business, query, date) } };
  }, { auth: true });

  r.add('GET', '/api/staff/days', async ({ business, query }) => {
    const today = nowInZone(business.timezone, now()).date;
    const from = isValidDate(query.get('from')) && query.get('from') >= today ? query.get('from') : today;
    const count = Math.min(Number(query.get('count')) || 14, 31);
    const days = [];
    for (let i = 0; i < count; i++) {
      const date = addDays(from, i);
      days.push({ date, available: staffSlots(business, query, date).length });
    }
    return { body: { days } };
  }, { auth: true });

  /** Check a specific booking before saving it, so the app can warn early. */
  r.add('GET', '/api/staff/check', async ({ business, query }) => {
    const service = getService(business.id, query.get('serviceId'));
    if (!service) throw bad('Choose a service');
    const date = query.get('date');
    if (!isValidDate(date)) throw bad('Invalid date');
    const tid = Number(query.get('therapistId'));
    const ctx = loadDay(business, date, { excludeId: query.get('excludeId') ? Number(query.get('excludeId')) : null });
    const v = sched.evaluate(ctx, { therapistId: tid, service, start: Number(query.get('startMin')), roomId: query.get('roomId') ? Number(query.get('roomId')) : null });
    return { body: { ok: !v.hard.length && !v.soft.length, roomId: v.roomId, hard: sched.describe(ctx, tid, v.hard), soft: sched.describe(ctx, tid, v.soft) } };
  }, { auth: true });

  // ===================== OWNER: APPOINTMENTS =====================
  r.add('GET', '/api/appointments', async ({ business, query }) => {
    const today = nowInZone(business.timezone, now()).date;
    const q = str(query.get('q') || '', 100);
    const from = isValidDate(query.get('from')) ? query.get('from') : (q ? '0000-01-01' : today);
    const to = isValidDate(query.get('to')) ? query.get('to') : (q ? '9999-12-31' : addDays(from, 30));
    const where = ['a.business_id = ?', 'a.date BETWEEN ? AND ?'];
    const args = [business.id, from, to];
    if (query.get('therapistId')) { where.push('a.therapist_id = ?'); args.push(Number(query.get('therapistId'))); }
    if (query.get('status')) {
      const statuses = query.get('status').split(',').filter((x) => ['booked', 'completed', 'cancelled', 'no_show'].includes(x));
      if (statuses.length) { where.push(`a.status IN (${statuses.map(() => '?').join(',')})`); args.push(...statuses); }
    }
    if (query.get('clientId')) { where.push('a.client_id = ?'); args.push(Number(query.get('clientId'))); }
    if (query.get('serviceId')) { where.push('a.service_id = ?'); args.push(Number(query.get('serviceId'))); }
    if (q) { where.push('(c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ? OR a.ref LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
    const order = query.get('order') === 'desc' ? 'DESC' : 'ASC';
    const limit = Math.min(Number(query.get('limit')) || 200, 1000);
    const offset = Math.max(Number(query.get('offset')) || 0, 0);
    const rows = db.prepare(`${APPT_SELECT} WHERE ${where.join(' AND ')} ORDER BY a.date ${order}, a.start_min ${order} LIMIT ? OFFSET ?`).all(...args, limit + 1, offset);
    return { body: { appointments: rows.slice(0, limit).map((a) => apptOut(a)), hasMore: rows.length > limit } };
  }, { auth: true });

  r.add('POST', '/api/appointments', async ({ business, body }) => {
    const service = getService(business.id, body.serviceId);
    if (!service) throw bad('Choose a service');
    const therapist = getTherapist(business.id, body.therapistId);
    if (!therapist) throw bad('Choose a therapist');
    if (!isValidDate(body.date)) throw bad('Invalid date');
    const start = typeof body.startMin === 'number' ? body.startMin : parseTime(body.time);
    if (!Number.isInteger(start) || start < 0 || start + service.duration_min > 1440) throw bad('Invalid start time');
    if (body.roomId && !getRoom(business.id, body.roomId)) throw bad('Unknown room');
    const client = readClient(body);
    const appt = tx(db, () => {
      const ctx = loadDay(business, body.date);
      const v = sched.evaluate(ctx, { therapistId: therapist.id, service, start, roomId: body.roomId || null });
      assertBookable(ctx, therapist.id, v, { allowSoft: !!body.override });
      return insertAppointment({
        business, therapistId: therapist.id, roomId: v.roomId, service, date: body.date, start, client,
        clientNotes: str(body.notes, 1000), source: 'staff', override: body.override ? v.soft : [],
      });
    });
    return { status: 201, body: { appointment: apptOut(appt) } };
  }, { auth: true });

  r.add('GET', '/api/appointments/:id', async ({ business, params }) => {
    const a = db.prepare(`${APPT_SELECT} WHERE a.id = ? AND a.business_id = ?`).get(params.id, business.id);
    if (!a) throw notFound('Appointment not found');
    const out = apptOut(a);
    if (a.status === 'booked') {
      const ctx = loadDay(business, a.date);
      const codes = sched.scheduleIssues(ctx, a);
      if (codes.length) out.issues = sched.describe(ctx, a.therapist_id, codes);
    }
    return { body: { appointment: out, events: eventsFor(a.id) } };
  }, { auth: true });

  /**
   * Update a booking: status, notes, or move it (date / time / therapist / service / room).
   * Moves are checked like new bookings; staff can pass override: true for soft issues.
   */
  r.add('PATCH', '/api/appointments/:id', async ({ business, params, body }) => {
    const a = db.prepare('SELECT * FROM appointments WHERE id = ? AND business_id = ?').get(params.id, business.id);
    if (!a) throw notFound('Appointment not found');
    const status = body.status !== undefined ? body.status : a.status;
    if (!['booked', 'completed', 'cancelled', 'no_show'].includes(status)) throw bad('Invalid status');

    const date = body.date !== undefined ? body.date : a.date;
    if (!isValidDate(date)) throw bad('Invalid date');
    const start = body.startMin !== undefined ? int(body.startMin, { min: 0, max: 1439, name: 'start time' }) : a.start_min;
    const therapistId = body.therapistId !== undefined ? Number(body.therapistId) : a.therapist_id;
    if (!getTherapist(business.id, therapistId)) throw bad('Unknown therapist');
    const service = getService(business.id, body.serviceId !== undefined ? body.serviceId : a.service_id);
    if (!service) throw bad('Unknown service');
    let roomId = body.roomId !== undefined ? (body.roomId ? Number(body.roomId) : null) : a.room_id;
    if (roomId && !getRoom(business.id, roomId)) throw bad('Unknown room');

    const moved = date !== a.date || start !== a.start_min || therapistId !== a.therapist_id || service.id !== a.service_id || roomId !== a.room_id;
    const reactivated = a.status === 'cancelled' && status === 'booked';

    tx(db, () => {
      let override = [];
      if (moved || reactivated) {
        const ctx = loadDay(business, date, { excludeId: a.id });
        // When the therapist or time changes and the room wasn't chosen explicitly, let the engine pick a room again.
        const keepRoom = body.roomId !== undefined ? roomId : (date === a.date && start === a.start_min && service.id === a.service_id ? a.room_id : null);
        let v = sched.evaluate(ctx, { therapistId, service, start, roomId: keepRoom });
        if (keepRoom && v.hard.includes('room_busy') && body.roomId === undefined) v = sched.evaluate(ctx, { therapistId, service, start });
        assertBookable(ctx, therapistId, v, { allowSoft: !!body.override || (reactivated && !moved) });
        roomId = v.roomId;
        override = body.override ? v.soft : [];
      }
      const serviceChanged = service.id !== a.service_id;
      db.prepare(`UPDATE appointments SET status = ?, internal_notes = ?, date = ?, start_min = ?, end_min = ?, block_end_min = ?,
          therapist_id = ?, service_id = ?, room_id = ?, price_cents = ?, updated_at = datetime('now') WHERE id = ?`).run(
        status,
        body.internalNotes !== undefined ? str(body.internalNotes, 2000) : a.internal_notes,
        date, start, start + service.duration_min, start + service.duration_min + service.buffer_min,
        therapistId, service.id, roomId,
        serviceChanged ? service.price_cents : (body.priceCents !== undefined ? int(body.priceCents, { min: 0, max: 10_000_000, name: 'price' }) : a.price_cents),
        a.id,
      );
      if (moved) {
        logEvent(a.id, 'staff', 'rescheduled', {
          from: { date: a.date, startMin: a.start_min, therapistId: a.therapist_id, serviceId: a.service_id, roomId: a.room_id },
          to: { date, startMin: start, therapistId, serviceId: service.id, roomId },
          ...(override.length ? { override } : {}),
          ...(body.reason ? { reason: str(body.reason, 200) } : {}),
        });
      }
      if (status !== a.status) logEvent(a.id, 'staff', 'status', { from: a.status, to: status, ...(body.reason ? { reason: str(body.reason, 200) } : {}) });
      if (body.internalNotes !== undefined && str(body.internalNotes, 2000) !== (a.internal_notes || '')) logEvent(a.id, 'staff', 'notes', {});
    });
    return { body: { appointment: apptOut(db.prepare(`${APPT_SELECT} WHERE a.id = ?`).get(a.id)), events: eventsFor(a.id) } };
  }, { auth: true });

  // ===================== OWNER: REPORTS =====================
  r.add('GET', '/api/reports', async ({ business, query }) => {
    const today = nowInZone(business.timezone, now()).date;
    const to = isValidDate(query.get('to')) ? query.get('to') : today;
    const from = isValidDate(query.get('from')) ? query.get('from') : addDays(to, -29);
    const span = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
    if (span < 1 || span > 366) throw bad('Pick a range of up to a year');

    const appts = db.prepare(`${APPT_SELECT} WHERE a.business_id = ? AND a.date BETWEEN ? AND ?`).all(business.id, from, to);
    const count = (st) => appts.filter((a) => a.status === st).length;
    const completed = appts.filter((a) => a.status === 'completed');
    const revenueCents = completed.reduce((n, a) => n + a.price_cents, 0);
    const expectedCents = appts.filter((a) => a.status === 'booked').reduce((n, a) => n + a.price_cents, 0);
    const attended = completed.length + count('no_show');

    // Daily series + utilization from the same inventory math as the capacity view.
    const inv = inventoryRange(business, from, span);
    const daily = inv.days.map((date, i) => ({
      date,
      revenueCents: completed.filter((a) => a.date === date).reduce((n, a) => n + a.price_cents, 0),
      sessions: appts.filter((a) => a.date === date && a.status !== 'cancelled').length,
      utilization: inv.totals[i].utilization,
    }));
    const byTherapist = inv.therapists.map((t) => {
      const mine = appts.filter((a) => a.therapist_id === t.id);
      const availableMin = t.days.reduce((n, d) => n + d.availableMin, 0);
      const bookedMin = t.days.reduce((n, d) => n + d.bookedMin, 0);
      return {
        id: t.id, name: t.name,
        sessions: mine.filter((a) => a.status !== 'cancelled').length,
        completed: mine.filter((a) => a.status === 'completed').length,
        noShows: mine.filter((a) => a.status === 'no_show').length,
        revenueCents: mine.filter((a) => a.status === 'completed').reduce((n, a) => n + a.price_cents, 0),
        availableMin, bookedMin, utilization: availableMin ? Math.min(1, bookedMin / availableMin) : 0,
      };
    });
    const services = new Map();
    for (const a of appts.filter((x) => x.status !== 'cancelled')) {
      const s = services.get(a.service_id) || { id: a.service_id, name: a.service_name, count: 0, revenueCents: 0 };
      s.count++;
      if (a.status === 'completed') s.revenueCents += a.price_cents;
      services.set(a.service_id, s);
    }
    const byWeekday = Array.from({ length: 7 }, (_, d) => ({ weekday: d, sessions: 0 }));
    const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, sessions: 0 }));
    for (const a of appts.filter((x) => x.status !== 'cancelled')) {
      byWeekday[new Date(a.date + 'T00:00:00Z').getUTCDay()].sessions++;
      byHour[Math.floor(a.start_min / 60)].sessions++;
    }
    // New vs returning: a client is new if their first ever non-cancelled booking falls in the range.
    const firsts = new Map(db.prepare(`SELECT client_id, MIN(date) AS first FROM appointments WHERE business_id = ? AND status != 'cancelled' GROUP BY client_id`).all(business.id).map((x) => [x.client_id, x.first]));
    const clientIds = [...new Set(appts.filter((a) => a.status !== 'cancelled').map((a) => a.client_id))];
    const newClients = clientIds.filter((id) => firsts.get(id) >= from).length;
    const availableMin = inv.totals.reduce((n, d) => n + d.availableMin, 0);
    const bookedMin = inv.totals.reduce((n, d) => n + d.bookedMin, 0);

    return {
      body: {
        from, to,
        revenueCents, expectedCents,
        bookings: appts.length,
        completed: completed.length,
        cancelled: count('cancelled'),
        noShows: count('no_show'),
        upcoming: count('booked'),
        noShowRate: attended ? count('no_show') / attended : 0,
        cancellationRate: appts.length ? count('cancelled') / appts.length : 0,
        avgTicketCents: completed.length ? Math.round(revenueCents / completed.length) : 0,
        utilization: availableMin ? Math.min(1, bookedMin / availableMin) : 0,
        availableMin, bookedMin,
        clients: { total: clientIds.length, new: newClients, returning: clientIds.length - newClients },
        daily, byTherapist,
        byService: [...services.values()].sort((a, b) => b.count - a.count),
        byWeekday, byHour: byHour.filter((h) => h.sessions || (h.hour >= 7 && h.hour <= 21)),
      },
    };
  }, { auth: true });

  // ===================== OWNER: CLIENTS =====================
  r.add('GET', '/api/clients', async ({ business, query }) => {
    const q = `%${str(query.get('q') || '', 100)}%`;
    const rows = db.prepare(`
      SELECT c.*, COUNT(a.id) FILTER (WHERE a.status IN ('booked','completed')) AS visits,
        MAX(a.date) FILTER (WHERE a.status IN ('booked','completed')) AS last_visit
      FROM clients c LEFT JOIN appointments a ON a.client_id = c.id
      WHERE c.business_id = ? AND (c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?)
      GROUP BY c.id ORDER BY c.name LIMIT 500`).all(business.id, q, q, q);
    return {
      body: {
        clients: rows.map((c) => ({
          id: c.id, name: c.name, email: c.email, phone: c.phone, notes: c.notes, visits: c.visits, lastVisit: c.last_visit,
        })),
      },
    };
  }, { auth: true });

  r.add('GET', '/api/clients/:id', async ({ business, params }) => {
    const c = db.prepare('SELECT * FROM clients WHERE id = ? AND business_id = ?').get(params.id, business.id);
    if (!c) throw notFound('Client not found');
    const history = db.prepare(`${APPT_SELECT} WHERE a.client_id = ? ORDER BY a.date DESC, a.start_min DESC LIMIT 500`).all(c.id);
    const done = history.filter((a) => a.status === 'completed');
    const tally = (key, name) => {
      const m = new Map();
      for (const a of done) { const x = m.get(a[key]) || { id: a[key], name: a[name], count: 0 }; x.count++; m.set(a[key], x); }
      return [...m.values()].sort((x, y) => y.count - x.count)[0] || null;
    };
    const dates = done.map((a) => a.date).sort();
    let avgGapDays = null;
    if (dates.length > 1) avgGapDays = Math.round((Date.parse(dates.at(-1)) - Date.parse(dates[0])) / 86400000 / (dates.length - 1));
    const last = done[0] || null;
    return {
      body: {
        client: { id: c.id, name: c.name, email: c.email, phone: c.phone, notes: c.notes, createdAt: c.created_at },
        appointments: history.map((a) => apptOut(a)),
        stats: {
          visits: done.length,
          spentCents: done.reduce((n, a) => n + a.price_cents, 0),
          noShows: history.filter((a) => a.status === 'no_show').length,
          cancellations: history.filter((a) => a.status === 'cancelled').length,
          firstVisit: dates[0] || null,
          lastVisit: dates.at(-1) || null,
          avgGapDays,
          favoriteTherapist: tally('therapist_id', 'therapist_name'),
          favoriteService: tally('service_id', 'service_name'),
          // What to pre-fill for "book again".
          rebook: last ? { serviceId: last.service_id, therapistId: last.therapist_id, serviceName: last.service_name, therapistName: last.therapist_name } : null,
        },
      },
    };
  }, { auth: true });

  r.add('PUT', '/api/clients/:id', async ({ business, params, body }) => {
    const c = db.prepare('SELECT * FROM clients WHERE id = ? AND business_id = ?').get(params.id, business.id);
    if (!c) throw notFound('Client not found');
    const name = body.name !== undefined ? str(body.name, 120) : c.name;
    if (!name) throw bad('Name is required');
    db.prepare('UPDATE clients SET name = ?, phone = ?, notes = ? WHERE id = ?').run(
      name, body.phone !== undefined ? str(body.phone, 40) : c.phone, body.notes !== undefined ? str(body.notes, 4000) : c.notes, c.id);
    return { body: { ok: true } };
  }, { auth: true });

  // ===================== PUBLIC BOOKING =====================
  function publicCtx(slug) {
    const b = getBySlug(slug);
    if (!b) throw notFound('Business not found');
    return b;
  }

  function bookableServices(b) {
    return db.prepare(`SELECT DISTINCT s.* FROM services s
      JOIN therapist_services ts ON ts.service_id = s.id JOIN therapists t ON t.id = ts.therapist_id
      WHERE s.business_id = ? AND s.active = 1 AND t.active = 1 ORDER BY s.duration_min, s.name`).all(b.id);
  }

  r.add('GET', '/api/public/:slug', async ({ params }) => {
    const b = publicCtx(params.slug);
    const therapists = db.prepare('SELECT * FROM therapists WHERE business_id = ? AND active = 1 ORDER BY name').all(b.id)
      .map((t) => { const x = therapistOut(t, { withHours: false }); return { id: x.id, name: x.name, bio: x.bio, active: x.active, serviceIds: x.serviceIds }; });
    return { body: { business: publicBusiness(b), services: bookableServices(b).map(serviceOut), therapists, today: nowInZone(b.timezone, now()).date } };
  });

  /** Reads service/therapist and, when a client is moving their own booking, which booking to ignore. */
  function readSlotQuery(b, query) {
    const service = getService(b.id, query.get('serviceId'));
    if (!service || !service.active) throw bad('Choose a service');
    let ids = sched.therapistsFor(db, b.id, service.id);
    if (query.get('therapistId')) {
      const t = getTherapist(b.id, query.get('therapistId'));
      if (!t || !t.active) throw bad('Unknown therapist');
      ids = ids.filter((id) => id === t.id);
    }
    let excludeId = null;
    if (query.get('ref')) {
      const a = bookingForClient(query.get('ref'), query.get('token'));
      if (a.business_id !== b.id) throw notFound('Booking not found');
      excludeId = a.id;
    }
    return { service, ids, excludeId };
  }

  function publicSlots(b, q, date) {
    const ctx = loadDay(b, date, { excludeId: q.excludeId });
    return sched.slots(ctx, b, q.service, q.ids, sched.onlineRule(b, date, now()));
  }

  r.add('GET', '/api/public/:slug/slots', async ({ params, query }) => {
    const b = publicCtx(params.slug);
    const q = readSlotQuery(b, query);
    const date = query.get('date');
    if (!isValidDate(date)) throw bad('Invalid date');
    return { body: { date, slots: publicSlots(b, q, date) } };
  });

  /** Which upcoming days have any opening — powers the date strip. */
  r.add('GET', '/api/public/:slug/days', async ({ params, query }) => {
    const b = publicCtx(params.slug);
    const q = readSlotQuery(b, query);
    const today = nowInZone(b.timezone, now()).date;
    const from = isValidDate(query.get('from')) && query.get('from') >= today ? query.get('from') : today;
    const count = Math.min(Number(query.get('count')) || 14, 31);
    const days = [];
    for (let i = 0; i < count; i++) {
      const date = addDays(from, i);
      days.push({ date, available: publicSlots(b, q, date).length });
    }
    return { body: { days } };
  });

  /** Pick a therapist for an "any therapist" booking: whoever has the most free time left that day. */
  function pickTherapist(ctx, ids) {
    const inv = new Map(sched.dayInventory(ctx).map((x) => [x.therapistId, x]));
    return [...ids].sort((x, y) => (inv.get(y)?.freeMin ?? 0) - (inv.get(x)?.freeMin ?? 0) || x - y)[0];
  }

  r.add('POST', '/api/public/:slug/book', async ({ params, body }) => {
    const b = publicCtx(params.slug);
    const service = getService(b.id, body.serviceId);
    if (!service || !service.active) throw bad('Choose a service');
    if (!isValidDate(body.date)) throw bad('Invalid date');
    const start = Number(body.startMin);
    if (!Number.isInteger(start)) throw bad('Choose a time');
    const client = readClient(body);
    let ids = sched.therapistsFor(db, b.id, service.id);
    if (body.therapistId) {
      const t = getTherapist(b.id, body.therapistId);
      if (!t || !t.active) throw bad('Unknown therapist');
      ids = ids.filter((id) => id === t.id);
    }

    const appt = tx(db, () => {
      // Re-check inside the write lock so two people can't grab the same slot.
      const ctx = loadDay(b, body.date);
      const slot = sched.slots(ctx, b, service, ids, sched.onlineRule(b, body.date, now())).find((s) => s.startMin === start);
      if (!slot) throw new HttpError(409, 'Sorry, that time was just taken. Please pick another.');
      const therapistId = slot.therapistIds.length > 1 ? pickTherapist(ctx, slot.therapistIds) : slot.therapistIds[0];
      const v = sched.evaluate(ctx, { therapistId, service, start });
      return insertAppointment({ business: b, therapistId, roomId: v.roomId, service, date: body.date, start, client, clientNotes: str(body.notes, 1000), source: 'online' });
    });
    return {
      status: 201,
      body: { appointment: apptOut(appt, { includePrivate: false }), manageToken: appt.manage_token, business: publicBusiness(b) },
    };
  });

  function bookingForClient(ref, token) {
    const a = db.prepare(`${APPT_SELECT} WHERE a.ref = ?`).get(String(ref).toUpperCase());
    if (!a || !token || a.manage_token !== token) throw notFound('Booking not found');
    return a;
  }
  function canClientChange(a, b) {
    if (a.status !== 'booked') return false;
    const n = nowInZone(b.timezone, now());
    return minutesBetween(n.date, n.minutes, a.date, a.start_min) >= b.cancel_cutoff_hours * 60;
  }
  const cutoffMessage = (b) => `Online changes close ${b.cancel_cutoff_hours} hours before your appointment. Please call us${b.phone ? ` at ${b.phone}` : ''}.`;

  r.add('GET', '/api/public/booking/:ref', async ({ params, query }) => {
    const a = bookingForClient(params.ref, query.get('token'));
    const b = db.prepare('SELECT * FROM businesses WHERE id = ?').get(a.business_id);
    const can = canClientChange(a, b);
    return { body: { appointment: apptOut(a, { includePrivate: false }), business: publicBusiness(b), canCancel: can, canReschedule: can, slug: b.slug } };
  });

  r.add('POST', '/api/public/booking/:ref/cancel', async ({ params, body }) => {
    const a = bookingForClient(params.ref, body.token);
    const b = db.prepare('SELECT * FROM businesses WHERE id = ?').get(a.business_id);
    if (!canClientChange(a, b)) throw new HttpError(409, a.status !== 'booked' ? 'This booking can no longer be cancelled' : cutoffMessage(b));
    db.prepare(`UPDATE appointments SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`).run(a.id);
    logEvent(a.id, 'client', 'status', { from: a.status, to: 'cancelled' });
    return { body: { ok: true } };
  });

  /** Client moves their own booking to another open time (same service). */
  r.add('POST', '/api/public/booking/:ref/reschedule', async ({ params, body }) => {
    const a = bookingForClient(params.ref, body.token);
    const b = db.prepare('SELECT * FROM businesses WHERE id = ?').get(a.business_id);
    if (!canClientChange(a, b)) throw new HttpError(409, a.status !== 'booked' ? 'This booking can no longer be changed' : cutoffMessage(b));
    if (!isValidDate(body.date)) throw bad('Invalid date');
    const start = Number(body.startMin);
    if (!Number.isInteger(start)) throw bad('Choose a time');
    const service = getService(b.id, a.service_id);
    let ids = sched.therapistsFor(db, b.id, service.id);
    if (body.therapistId) ids = ids.filter((id) => id === Number(body.therapistId));
    const updated = tx(db, () => {
      const ctx = loadDay(b, body.date, { excludeId: a.id });
      const slot = sched.slots(ctx, b, service, ids, sched.onlineRule(b, body.date, now())).find((s) => s.startMin === start);
      if (!slot) throw new HttpError(409, 'Sorry, that time isn’t available. Please pick another.');
      // Keep the same therapist when possible.
      const therapistId = slot.therapistIds.includes(a.therapist_id) ? a.therapist_id : pickTherapist(ctx, slot.therapistIds);
      const v = sched.evaluate(ctx, { therapistId, service, start });
      db.prepare(`UPDATE appointments SET date = ?, start_min = ?, end_min = ?, block_end_min = ?, therapist_id = ?, room_id = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(body.date, start, start + service.duration_min, start + service.duration_min + service.buffer_min, therapistId, v.roomId, a.id);
      logEvent(a.id, 'client', 'rescheduled', {
        from: { date: a.date, startMin: a.start_min, therapistId: a.therapist_id, roomId: a.room_id },
        to: { date: body.date, startMin: start, therapistId, roomId: v.roomId },
      });
      return db.prepare(`${APPT_SELECT} WHERE a.id = ?`).get(a.id);
    });
    return { body: { appointment: apptOut(updated, { includePrivate: false }) } };
  });

  // ===================== PAGES =====================
  const pages = [
    [/^\/$/, 'index.html'],
    [/^\/admin\/?$/, 'admin.html'],
    [/^\/b\/[^/]+\/?$/, 'book.html'],
    [/^\/b\/[^/]+\/manage\/?$/, 'manage.html'],
  ];

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    try {
      if (req.method === 'GET' && !pathname.startsWith('/api/')) {
        for (const [re, file] of pages) if (re.test(pathname)) return serveFile(res, file);
        if (pathname.startsWith('/static/')) return serveFile(res, pathname.slice('/static/'.length));
        return send(res, 404, { error: 'Not found' });
      }
      if (req.method === 'OPTIONS' && pathname.startsWith('/api/')) {
        res.writeHead(204, CORS);
        return res.end();
      }
      const m = r.match(req.method, pathname);
      if (!m) throw notFound();
      if (req.method !== 'GET' && !/application\/json/.test(req.headers['content-type'] || '')) {
        throw new HttpError(415, 'Send JSON');
      }
      const cookies = parseCookies(req.headers.cookie);
      const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
      const sessionToken = bearer ? bearer[1] : cookies.sid;
      let business = null;
      if (m.route.opts.auth) {
        business = auth.businessForToken(db, sessionToken);
        if (!business) throw new HttpError(401, 'Please log in');
      }
      const body = req.method === 'GET' ? {} : await readBody(req);
      const out = await m.route.handler({ req, body: body && typeof body === 'object' ? body : {}, params: m.params, query: url.searchParams, cookies, sessionToken, business });
      send(res, out.status || 200, out.body, out.headers);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message, ...(err.data || {}) });
      console.error(err);
      send(res, 500, { error: 'Something went wrong' });
    }
  };
}

module.exports = { createApp };
