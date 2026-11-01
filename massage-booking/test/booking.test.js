'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { openDb } = require('../lib/db');
const { createApp } = require('../lib/app');
const { computeSlots } = require('../lib/availability');

// ---------- pure slot logic ----------
test('computeSlots respects windows, duration, buffer and busy blocks', () => {
  const slots = computeSlots({
    windows: [{ start: 540, end: 780 }],             // 9:00–13:00
    busy: [{ start: 600, end: 660 }],                // 10:00–11:00 taken
    duration: 60, buffer: 15, step: 15,
  });
  // 9:00 would run to 10:00 + 15 min buffer, clashing with 10:00. Nothing fits before.
  // After 11:00, sessions must finish by 13:00 → last start 12:00.
  assert.deepEqual(slots, [660, 675, 690, 705, 720]);
});

test('computeSlots lets the buffer spill past closing time but not the session', () => {
  const slots = computeSlots({ windows: [{ start: 540, end: 600 }], busy: [], duration: 60, buffer: 15, step: 15 });
  assert.deepEqual(slots, [540]);
});

// ---------- API flow ----------
// Fixed clock: Monday 2026-11-02 08:00 UTC.
const NOW = new Date('2026-11-02T08:00:00Z');

function startServer() {
  const db = openDb(':memory:');
  const server = http.createServer(createApp(db, { now: () => NOW }));
  return new Promise((resolve) => server.listen(0, () => resolve({ db, server, base: `http://127.0.0.1:${server.address().port}` })));
}

function client(base) {
  let cookie = '';
  return async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: method !== 'GET' ? JSON.stringify(body || {}) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}

test('owner sets up a business and clients book online', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  const owner = client(base);
  const anon = client(base);

  let r = await owner('/api/auth/signup', { method: 'POST', body: { businessName: 'Calm Hands Spa', email: 'Owner@Example.com', password: 'secret123', timezone: 'UTC' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.business.slug, 'calm-hands-spa');

  r = await anon('/api/services');
  assert.equal(r.status, 401, 'owner endpoints need a login');

  r = await owner('/api/services', { method: 'POST', body: { name: 'Swedish 60', durationMin: 60, priceCents: 9000, bufferMin: 15 } });
  assert.equal(r.status, 201);
  const svc = r.body.service;

  // Two therapists, both Monday 9–12.
  const hours = [{ weekday: 1, startMin: 540, endMin: 720 }];
  const a = (await owner('/api/therapists', { method: 'POST', body: { name: 'Ann', serviceIds: [svc.id], hours } })).body.therapist;
  const b = (await owner('/api/therapists', { method: 'POST', body: { name: 'Ben', serviceIds: [svc.id], hours } })).body.therapist;
  assert.deepEqual(a.hours, hours);

  // Public info
  r = await anon('/api/public/calm-hands-spa');
  assert.equal(r.status, 200);
  assert.equal(r.body.services.length, 1);
  assert.equal(r.body.therapists.length, 2);

  // Lead time is 60 min and "now" is 08:00, so 9:00 is the first slot. Last start: 11:00 (session must end by 12:00).
  r = await anon(`/api/public/calm-hands-spa/slots?serviceId=${svc.id}&date=2026-11-02`);
  assert.equal(r.status, 200);
  const times = r.body.slots.map((s) => s.startMin);
  assert.equal(times[0], 540);
  assert.equal(times.at(-1), 660);
  assert.deepEqual(r.body.slots[0].therapistIds.sort(), [a.id, b.id].sort());

  // Book "any therapist" at 9:00 twice: both therapists get one.
  const booking = { serviceId: svc.id, date: '2026-11-02', startMin: 540, name: 'Cara', email: 'cara@example.com', phone: '555' };
  const b1 = await anon('/api/public/calm-hands-spa/book', { method: 'POST', body: booking });
  assert.equal(b1.status, 201);
  const b2 = await anon('/api/public/calm-hands-spa/book', { method: 'POST', body: { ...booking, name: 'Dev', email: 'dev@example.com' } });
  assert.equal(b2.status, 201);
  assert.notEqual(b1.body.appointment.therapistId, b2.body.appointment.therapistId);

  // A third booking at 9:00 is refused — no double booking.
  const b3 = await anon('/api/public/calm-hands-spa/book', { method: 'POST', body: { ...booking, email: 'eve@example.com' } });
  assert.equal(b3.status, 409);

  // 9:00 is gone and so is 10:00 (session 9–10 + 15 min buffer blocks until 10:15).
  r = await anon(`/api/public/calm-hands-spa/slots?serviceId=${svc.id}&date=2026-11-02`);
  const after = r.body.slots.map((s) => s.startMin);
  assert.ok(!after.includes(540));
  assert.ok(!after.includes(600));
  assert.ok(after.includes(615));

  // Public responses don't leak client contact details.
  assert.equal(b1.body.appointment.clientEmail, undefined);

  // Client looks up and cancels (appointment is 1h away, cutoff is 24h → refused).
  const ref = b1.body.appointment.ref;
  r = await anon(`/api/public/booking/${ref}?token=wrong`);
  assert.equal(r.status, 404);
  r = await anon(`/api/public/booking/${ref}?token=${b1.body.manageToken}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.canCancel, false);
  r = await anon(`/api/public/booking/${ref}/cancel`, { method: 'POST', body: { token: b1.body.manageToken } });
  assert.equal(r.status, 409);

  // Owner relaxes the cutoff; now the client can cancel and the slot reopens.
  await owner('/api/business', { method: 'PUT', body: { cancelCutoffHours: 0 } });
  r = await anon(`/api/public/booking/${ref}/cancel`, { method: 'POST', body: { token: b1.body.manageToken } });
  assert.equal(r.status, 200);
  r = await anon(`/api/public/calm-hands-spa/slots?serviceId=${svc.id}&date=2026-11-02`);
  assert.ok(r.body.slots.some((s) => s.startMin === 540));

  // Owner sees the schedule and clients.
  r = await owner('/api/schedule?date=2026-11-02');
  assert.equal(r.body.appointments.length, 2);
  assert.ok(r.body.appointments.every((x) => x.clientEmail));
  r = await owner('/api/clients');
  assert.equal(r.body.clients.length, 2);

  // Time off blocks availability.
  await owner(`/api/therapists/${a.id}/time-off`, { method: 'POST', body: { date: '2026-11-09' } });
  r = await anon(`/api/public/calm-hands-spa/slots?serviceId=${svc.id}&date=2026-11-09`);
  assert.ok(r.body.slots.every((s) => !s.therapistIds.includes(a.id)));
  assert.ok(r.body.slots.length > 0);

  // Staff booking outside working hours is allowed but still can't overlap.
  r = await owner('/api/appointments', { method: 'POST', body: { serviceId: svc.id, therapistId: b.id, date: '2026-11-02', time: '18:00', name: 'Late', email: 'late@example.com' } });
  assert.equal(r.status, 201);
  r = await owner('/api/appointments', { method: 'POST', body: { serviceId: svc.id, therapistId: b.id, date: '2026-11-02', time: '18:30', name: 'Late2', email: 'late2@example.com' } });
  assert.equal(r.status, 409);
});

test('businesses cannot see each other\'s data', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  const one = client(base);
  const two = client(base);
  await one('/api/auth/signup', { method: 'POST', body: { businessName: 'One', email: 'one@example.com', password: 'password1' } });
  await two('/api/auth/signup', { method: 'POST', body: { businessName: 'Two', email: 'two@example.com', password: 'password2' } });
  const svc = (await one('/api/services', { method: 'POST', body: { name: 'S', durationMin: 30 } })).body.service;
  const r = await two(`/api/services/${svc.id}`, { method: 'PUT', body: { name: 'hijack' } });
  assert.equal(r.status, 404);
  assert.equal((await two('/api/services')).body.services.length, 0);
});

test('past dates and dates beyond the booking window have no slots', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  const owner = client(base);
  await owner('/api/auth/signup', { method: 'POST', body: { businessName: 'W', email: 'w@example.com', password: 'password1', timezone: 'UTC' } });
  const svc = (await owner('/api/services', { method: 'POST', body: { name: 'S', durationMin: 60 } })).body.service;
  const hours = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ weekday: d, startMin: 540, endMin: 1020 }));
  await owner('/api/therapists', { method: 'POST', body: { name: 'T', serviceIds: [svc.id], hours } });
  const slots = async (date) => (await owner(`/api/public/w/slots?serviceId=${svc.id}&date=${date}`)).body.slots.length;
  assert.equal(await slots('2026-11-01'), 0);
  assert.ok(await slots('2026-11-03') > 0);
  assert.equal(await slots('2027-03-01'), 0); // > 60 days out
});

test('mobile apps can authenticate with a Bearer token', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  const signup = await fetch(base + '/api/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessName: 'Mobile', email: 'm@example.com', password: 'password1' }),
  }).then((r) => r.json());
  assert.ok(signup.token);
  const me = await fetch(base + '/api/me', { headers: { Authorization: `Bearer ${signup.token}` } });
  assert.equal(me.status, 200);
  assert.equal(me.headers.get('access-control-allow-origin'), '*');
  const pre = await fetch(base + '/api/me', { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
  await fetch(base + '/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signup.token}` }, body: '{}' });
  const after = await fetch(base + '/api/me', { headers: { Authorization: `Bearer ${signup.token}` } });
  assert.equal(after.status, 401);
});
