'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { tx } = require('./db');
const auth = require('./auth');
const avail = require('./availability');
const { isValidDate, addDays, nowInZone, isValidTimeZone, minutesBetween, parseTime } = require('./time');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,40}[a-z0-9])?$/;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
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
  SELECT a.*, t.name AS therapist_name, s.name AS service_name, c.name AS client_name, c.email AS client_email, c.phone AS client_phone
  FROM appointments a
  JOIN therapists t ON t.id = a.therapist_id
  JOIN services s ON s.id = a.service_id
  JOIN clients c ON c.id = a.client_id`;
function apptOut(a, { includePrivate = true } = {}) {
  const out = {
    id: a.id, ref: a.ref, date: a.date, startMin: a.start_min, endMin: a.end_min, status: a.status,
    priceCents: a.price_cents, therapistId: a.therapist_id, therapistName: a.therapist_name,
    serviceId: a.service_id, serviceName: a.service_name, clientNotes: a.client_notes,
    clientName: a.client_name,
  };
  if (includePrivate) {
    Object.assign(out, {
      clientId: a.client_id, clientEmail: a.client_email, clientPhone: a.client_phone,
      internalNotes: a.internal_notes, source: a.source, createdAt: a.created_at,
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
    const out = { id: t.id, name: t.name, bio: t.bio, active: !!t.active, serviceIds };
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

  function insertAppointment({ business, therapistId, service, date, start, client, clientNotes, source }) {
    const clientId = upsertClient(business.id, client);
    let ref;
    do { ref = auth.bookingRef(); } while (db.prepare('SELECT 1 FROM appointments WHERE ref = ?').get(ref));
    const info = db.prepare(
      `INSERT INTO appointments (business_id, therapist_id, service_id, client_id, date, start_min, end_min, block_end_min,
         price_cents, client_notes, ref, manage_token, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(business.id, therapistId, service.id, clientId, date, start, start + service.duration_min,
      start + service.duration_min + service.buffer_min, service.price_cents, clientNotes, ref, auth.randomToken(), source);
    return db.prepare(`${APPT_SELECT} WHERE a.id = ?`).get(Number(info.lastInsertRowid));
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

  r.add('GET', '/api/services', async ({ business }) => ({
    body: { services: db.prepare('SELECT * FROM services WHERE business_id = ? ORDER BY active DESC, name').all(business.id).map(serviceOut) },
  }), { auth: true });

  r.add('POST', '/api/services', async ({ business, body }) => {
    if (body.durationMin === undefined) throw bad('Duration is required');
    const s = readService(body);
    const id = Number(db.prepare('INSERT INTO services (business_id, name, description, duration_min, price_cents, buffer_min, active) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(business.id, s.name, s.description, s.duration, s.price, s.buffer, s.active).lastInsertRowid);
    return { status: 201, body: { service: serviceOut(getService(business.id, id)) } };
  }, { auth: true });

  r.add('PUT', '/api/services/:id', async ({ business, body, params }) => {
    const existing = getService(business.id, params.id);
    if (!existing) throw notFound('Service not found');
    const s = readService(body, existing);
    db.prepare('UPDATE services SET name = ?, description = ?, duration_min = ?, price_cents = ?, buffer_min = ?, active = ? WHERE id = ?')
      .run(s.name, s.description, s.duration, s.price, s.buffer, s.active, existing.id);
    return { body: { service: serviceOut(getService(business.id, existing.id)) } };
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

  // ===================== OWNER: THERAPISTS =====================
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
      const hours = body.hours.map((h) => {
        const weekday = int(h.weekday, { min: 0, max: 6, name: 'weekday' });
        const startMin = int(h.startMin, { min: 0, max: 1440, name: 'start time' });
        const endMin = int(h.endMin, { min: 0, max: 1440, name: 'end time' });
        if (endMin <= startMin) throw bad('Working hours must end after they start');
        return { weekday, startMin, endMin };
      });
      for (let d = 0; d < 7; d++) {
        const day = hours.filter((h) => h.weekday === d).sort((a, b) => a.startMin - b.startMin);
        for (let i = 1; i < day.length; i++) if (day[i].startMin < day[i - 1].endMin) throw bad('Working hours overlap on the same day');
      }
      db.prepare('DELETE FROM availability WHERE therapist_id = ?').run(therapistId);
      const ins = db.prepare('INSERT INTO availability (therapist_id, weekday, start_min, end_min) VALUES (?, ?, ?, ?)');
      for (const h of hours) ins.run(therapistId, h.weekday, h.startMin, h.endMin);
    }
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
    return { body: { therapist: therapistOut(t) } };
  }, { auth: true });

  r.add('DELETE', '/api/therapists/:id', async ({ business, params }) => {
    const existing = getTherapist(business.id, params.id);
    if (!existing) throw notFound('Therapist not found');
    if (db.prepare('SELECT 1 FROM appointments WHERE therapist_id = ? LIMIT 1').get(existing.id)) {
      db.prepare('UPDATE therapists SET active = 0 WHERE id = ?').run(existing.id);
      return { body: { archived: true } };
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
    return { status: 201, body: { created: count } };
  }, { auth: true });

  r.add('DELETE', '/api/time-off/:id', async ({ business, params }) => {
    const row = db.prepare('SELECT o.id FROM time_off o JOIN therapists t ON t.id = o.therapist_id WHERE o.id = ? AND t.business_id = ?').get(params.id, business.id);
    if (!row) throw notFound();
    db.prepare('DELETE FROM time_off WHERE id = ?').run(row.id);
    return { body: { deleted: true } };
  }, { auth: true });

  // ===================== OWNER: APPOINTMENTS =====================
  r.add('GET', '/api/appointments', async ({ business, query }) => {
    const today = nowInZone(business.timezone, now()).date;
    const from = isValidDate(query.get('from')) ? query.get('from') : today;
    const to = isValidDate(query.get('to')) ? query.get('to') : addDays(from, 30);
    const where = ['a.business_id = ?', 'a.date BETWEEN ? AND ?'];
    const args = [business.id, from, to];
    if (query.get('therapistId')) { where.push('a.therapist_id = ?'); args.push(Number(query.get('therapistId'))); }
    if (query.get('status')) { where.push('a.status = ?'); args.push(query.get('status')); }
    if (query.get('clientId')) { where.push('a.client_id = ?'); args.push(Number(query.get('clientId'))); }
    const rows = db.prepare(`${APPT_SELECT} WHERE ${where.join(' AND ')} ORDER BY a.date, a.start_min LIMIT 1000`).all(...args);
    return { body: { appointments: rows.map((a) => apptOut(a)) } };
  }, { auth: true });

  /** Everything the day view needs in one call. */
  r.add('GET', '/api/schedule', async ({ business, query }) => {
    const date = isValidDate(query.get('date')) ? query.get('date') : nowInZone(business.timezone, now()).date;
    const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
    const therapists = db.prepare('SELECT * FROM therapists WHERE business_id = ? AND active = 1 ORDER BY name').all(business.id).map((t) => ({
      id: t.id,
      name: t.name,
      hours: db.prepare('SELECT start_min AS startMin, end_min AS endMin FROM availability WHERE therapist_id = ? AND weekday = ? ORDER BY start_min').all(t.id, weekday).map((x) => ({ ...x })),
      timeOff: db.prepare('SELECT id, start_min AS startMin, end_min AS endMin, reason FROM time_off WHERE therapist_id = ? AND date = ?').all(t.id, date).map((x) => ({ ...x })),
    }));
    const appts = db.prepare(`${APPT_SELECT} WHERE a.business_id = ? AND a.date = ? ORDER BY a.start_min`).all(business.id, date);
    return { body: { date, today: nowInZone(business.timezone, now()).date, therapists, appointments: appts.map((a) => apptOut(a)) } };
  }, { auth: true });

  r.add('POST', '/api/appointments', async ({ business, body }) => {
    const service = getService(business.id, body.serviceId);
    if (!service) throw bad('Choose a service');
    const therapist = getTherapist(business.id, body.therapistId);
    if (!therapist) throw bad('Choose a therapist');
    if (!isValidDate(body.date)) throw bad('Invalid date');
    const start = typeof body.startMin === 'number' ? body.startMin : parseTime(body.time);
    if (!Number.isInteger(start) || start < 0 || start + service.duration_min > 1440) throw bad('Invalid start time');
    const client = readClient(body);
    const appt = tx(db, () => {
      if (avail.staffConflict(db, therapist.id, body.date, start, start + service.duration_min + service.buffer_min)) {
        throw new HttpError(409, `${therapist.name} already has an appointment at that time`);
      }
      return insertAppointment({ business, therapistId: therapist.id, service, date: body.date, start, client, clientNotes: str(body.notes, 1000), source: 'staff' });
    });
    return { status: 201, body: { appointment: apptOut(appt) } };
  }, { auth: true });

  r.add('GET', '/api/appointments/:id', async ({ business, params }) => {
    const a = db.prepare(`${APPT_SELECT} WHERE a.id = ? AND a.business_id = ?`).get(params.id, business.id);
    if (!a) throw notFound('Appointment not found');
    return { body: { appointment: apptOut(a) } };
  }, { auth: true });

  r.add('PATCH', '/api/appointments/:id', async ({ business, params, body }) => {
    const a = db.prepare('SELECT * FROM appointments WHERE id = ? AND business_id = ?').get(params.id, business.id);
    if (!a) throw notFound('Appointment not found');
    const status = body.status !== undefined ? body.status : a.status;
    if (!['booked', 'completed', 'cancelled', 'no_show'].includes(status)) throw bad('Invalid status');
    tx(db, () => {
      if (a.status === 'cancelled' && status === 'booked'
        && avail.staffConflict(db, a.therapist_id, a.date, a.start_min, a.block_end_min, a.id)) {
        throw new HttpError(409, 'That time slot has since been taken');
      }
      db.prepare('UPDATE appointments SET status = ?, internal_notes = ? WHERE id = ?')
        .run(status, body.internalNotes !== undefined ? str(body.internalNotes, 2000) : a.internal_notes, a.id);
    });
    return { body: { appointment: apptOut(db.prepare(`${APPT_SELECT} WHERE a.id = ?`).get(a.id)) } };
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
    const history = db.prepare(`${APPT_SELECT} WHERE a.client_id = ? ORDER BY a.date DESC, a.start_min DESC LIMIT 200`).all(c.id);
    return { body: { client: { id: c.id, name: c.name, email: c.email, phone: c.phone, notes: c.notes }, appointments: history.map((a) => apptOut(a)) } };
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
      .map((t) => therapistOut(t, { withHours: false }));
    return { body: { business: publicBusiness(b), services: bookableServices(b).map(serviceOut), therapists, today: nowInZone(b.timezone, now()).date } };
  });

  function readSlotQuery(b, query) {
    const service = getService(b.id, query.get('serviceId'));
    if (!service || !service.active) throw bad('Choose a service');
    let therapistId = null;
    if (query.get('therapistId')) {
      const t = getTherapist(b.id, query.get('therapistId'));
      if (!t || !t.active) throw bad('Unknown therapist');
      therapistId = t.id;
    }
    return { service, therapistId };
  }

  r.add('GET', '/api/public/:slug/slots', async ({ params, query }) => {
    const b = publicCtx(params.slug);
    const { service, therapistId } = readSlotQuery(b, query);
    const date = query.get('date');
    if (!isValidDate(date)) throw bad('Invalid date');
    const slots = avail.serviceSlots(db, b, service, date, therapistId, now());
    return { body: { date, slots: slots.map((s) => ({ startMin: s.time, therapistIds: s.therapistIds })) } };
  });

  /** Which upcoming days have any opening — powers the date strip. */
  r.add('GET', '/api/public/:slug/days', async ({ params, query }) => {
    const b = publicCtx(params.slug);
    const { service, therapistId } = readSlotQuery(b, query);
    const today = nowInZone(b.timezone, now()).date;
    const from = isValidDate(query.get('from')) && query.get('from') >= today ? query.get('from') : today;
    const count = Math.min(Number(query.get('count')) || 14, 31);
    const days = [];
    for (let i = 0; i < count; i++) {
      const date = addDays(from, i);
      days.push({ date, available: avail.serviceSlots(db, b, service, date, therapistId, now()).length });
    }
    return { body: { days } };
  });

  r.add('POST', '/api/public/:slug/book', async ({ params, body }) => {
    const b = publicCtx(params.slug);
    const service = getService(b.id, body.serviceId);
    if (!service || !service.active) throw bad('Choose a service');
    if (!isValidDate(body.date)) throw bad('Invalid date');
    const start = Number(body.startMin);
    if (!Number.isInteger(start)) throw bad('Choose a time');
    const client = readClient(body);
    let requested = null;
    if (body.therapistId) {
      const t = getTherapist(b.id, body.therapistId);
      if (!t || !t.active) throw bad('Unknown therapist');
      requested = t.id;
    }

    const appt = tx(db, () => {
      // Re-check availability inside the write lock so two people can't grab the same slot.
      const slot = avail.serviceSlots(db, b, service, body.date, requested, now()).find((s) => s.time === start);
      if (!slot) throw new HttpError(409, 'Sorry, that time was just taken. Please pick another.');
      let therapistId = slot.therapistIds[0];
      if (!requested && slot.therapistIds.length > 1) {
        // "Any therapist": give it to whoever has the lightest day.
        const load = db.prepare(`SELECT COUNT(*) n FROM appointments WHERE therapist_id = ? AND date = ? AND status = 'booked'`);
        therapistId = slot.therapistIds
          .map((id) => ({ id, n: load.get(id, body.date).n }))
          .sort((x, y) => x.n - y.n || x.id - y.id)[0].id;
      }
      return insertAppointment({ business: b, therapistId, service, date: body.date, start, client, clientNotes: str(body.notes, 1000), source: 'online' });
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
  function canClientCancel(a, b) {
    if (a.status !== 'booked') return false;
    const n = nowInZone(b.timezone, now());
    return minutesBetween(n.date, n.minutes, a.date, a.start_min) >= b.cancel_cutoff_hours * 60;
  }

  r.add('GET', '/api/public/booking/:ref', async ({ params, query }) => {
    const a = bookingForClient(params.ref, query.get('token'));
    const b = db.prepare('SELECT * FROM businesses WHERE id = ?').get(a.business_id);
    return { body: { appointment: apptOut(a, { includePrivate: false }), business: publicBusiness(b), canCancel: canClientCancel(a, b) } };
  });

  r.add('POST', '/api/public/booking/:ref/cancel', async ({ params, body }) => {
    const a = bookingForClient(params.ref, body.token);
    const b = db.prepare('SELECT * FROM businesses WHERE id = ?').get(a.business_id);
    if (!canClientCancel(a, b)) {
      throw new HttpError(409, a.status !== 'booked'
        ? 'This booking can no longer be cancelled'
        : `Online cancellation closes ${b.cancel_cutoff_hours} hours before your appointment. Please call us${b.phone ? ` at ${b.phone}` : ''}.`);
    }
    db.prepare(`UPDATE appointments SET status = 'cancelled' WHERE id = ?`).run(a.id);
    return { body: { ok: true } };
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
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error(err);
      send(res, 500, { error: 'Something went wrong' });
    }
  };
}

module.exports = { createApp };
