'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { openDb } = require('../lib/db');
const { createApp } = require('../lib/app');
const { stretchWith, workingMinutes } = require('../lib/scheduler');

// Fixed clock: Sunday 2026-11-01 08:00 UTC. Test day is Monday 2026-11-02.
const NOW = new Date('2026-11-01T08:00:00Z');
const MON = '2026-11-02';

async function setup(t) {
  const db = openDb(':memory:');
  const server = http.createServer(createApp(db, { now: () => NOW }));
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  let token = null;
  const call = async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: method !== 'GET' ? JSON.stringify(body || {}) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  const signup = await call('/api/auth/signup', { method: 'POST', body: { businessName: 'Studio', email: 'o@example.com', password: 'password1', timezone: 'UTC' } });
  token = signup.body.token;
  await call('/api/business', { method: 'PUT', body: { leadTimeMin: 0, cancelCutoffHours: 0 } });
  const svc = (await call('/api/services', { method: 'POST', body: { name: 'Massage 60', durationMin: 60, priceCents: 10000, bufferMin: 15 } })).body.service;
  const hours = [{ weekday: 1, startMin: 540, endMin: 1020 }]; // Mon 9–17
  const ann = (await call('/api/therapists', { method: 'POST', body: { name: 'Ann', serviceIds: [svc.id], hours } })).body.therapist;
  const ben = (await call('/api/therapists', { method: 'POST', body: { name: 'Ben', serviceIds: [svc.id], hours } })).body.therapist;
  const book = (extra) => call('/api/appointments', { method: 'POST', body: { serviceId: svc.id, date: MON, name: 'C', email: `c${Math.random()}@x.com`, ...extra } });
  const slots = async (q = '') => (await call(`/api/public/studio/slots?serviceId=${svc.id}&date=${MON}${q}`)).body.slots;
  return { db, call, svc, ann, ben, book, slots };
}

test('stretchWith measures near-continuous work including the candidate', () => {
  const appts = [{ start: 600, end: 660 }, { start: 675, end: 735 }];
  assert.equal(stretchWith(appts, 750, 810, 30), 210); // 10:00 → 13:30
  assert.equal(stretchWith(appts, 800, 860, 30), 60);  // after a 65-min gap: its own stretch
});

test('workingMinutes subtracts time off', () => {
  assert.equal(workingMinutes([{ start: 540, end: 1020 }], [{ start: 720, end: 780 }]), 420);
  assert.equal(workingMinutes([{ start: 540, end: 1020 }], [{ start: 0, end: 1440 }]), 0);
});

test('rooms are inventory: no room, no booking', async (t) => {
  const { call, svc, ann, ben, book, slots } = await setup(t);
  const room = (await call('/api/rooms', { method: 'POST', body: { name: 'Room A' } })).body.room;
  // One room, two therapists: 10:00 can only be sold once.
  let r = await book({ therapistId: ann.id, startMin: 600 });
  assert.equal(r.status, 201);
  assert.equal(r.body.appointment.roomId, room.id);
  assert.equal(r.body.appointment.roomName, 'Room A');
  r = await book({ therapistId: ben.id, startMin: 600 });
  assert.equal(r.status, 409);
  assert.equal(r.body.issues[0].code, 'no_room');
  assert.equal(r.body.canOverride, false);
  assert.ok(!(await slots()).some((s) => s.startMin === 600), 'public slots hide times with no room');
  // Add a second room → the slot reopens for Ben.
  await call('/api/rooms', { method: 'POST', body: { name: 'Room B' } });
  assert.deepEqual((await slots()).find((s) => s.startMin === 600).therapistIds, [ben.id]);
  void svc;
});

test('special rooms are kept free for services that need them', async (t) => {
  const { call, svc, ann, ben, book } = await setup(t);
  const general = (await call('/api/rooms', { method: 'POST', body: { name: 'General' } })).body.room;
  const stone = (await call('/api/rooms', { method: 'POST', body: { name: 'Stone room' } })).body.room;
  const hot = (await call('/api/services', { method: 'POST', body: { name: 'Hot stone', durationMin: 60, roomIds: [stone.id] } })).body.service;
  assert.deepEqual(hot.roomIds, [stone.id]);
  await call(`/api/therapists/${ben.id}`, { method: 'PUT', body: { serviceIds: [svc.id, hot.id] } });
  // A regular massage should land in the general room, leaving the stone room for hot stone.
  const r1 = await book({ therapistId: ann.id, startMin: 600 });
  assert.equal(r1.body.appointment.roomId, general.id);
  const r2 = await call('/api/appointments', { method: 'POST', body: { serviceId: hot.id, therapistId: ben.id, date: MON, startMin: 600, name: 'H', email: 'h@x.com' } });
  assert.equal(r2.status, 201);
  assert.equal(r2.body.appointment.roomId, stone.id);
});

test('daily session limit and break rules', async (t) => {
  const { call, ann, book } = await setup(t);
  await call(`/api/therapists/${ann.id}`, { method: 'PUT', body: { maxConsecutiveMin: 150, minBreakMin: 30 } });
  assert.equal((await book({ therapistId: ann.id, startMin: 540 })).status, 201);  // 9:00–10:00
  assert.equal((await book({ therapistId: ann.id, startMin: 615 })).status, 201);  // 10:15–11:15 (stretch 135)
  let r = await book({ therapistId: ann.id, startMin: 690 });                      // 11:30 → stretch 210 > 150
  assert.equal(r.status, 409);
  assert.equal(r.body.issues[0].code, 'needs_break');
  assert.equal((await book({ therapistId: ann.id, startMin: 705 })).status, 201);  // 11:45 after a 30-min break
  await call(`/api/therapists/${ann.id}`, { method: 'PUT', body: { maxSessionsPerDay: 3, maxConsecutiveMin: null } });
  r = await book({ therapistId: ann.id, startMin: 900 });
  assert.equal(r.status, 409);
  assert.equal(r.body.issues[0].code, 'daily_limit');
  r = await book({ therapistId: ann.id, startMin: 900, override: true });
  assert.equal(r.status, 201, 'staff can knowingly go over the limit');
  const detail = await call(`/api/appointments/${r.body.appointment.id}`);
  assert.deepEqual(detail.body.events[0].detail.override, ['daily_limit'], 'overrides are recorded in history');
});

test('date overrides replace weekly hours', async (t) => {
  const { call, ann, slots } = await setup(t);
  await call(`/api/therapists/${ann.id}/overrides/${MON}`, { method: 'PUT', body: { blocks: [{ startMin: 1080, endMin: 1260 }], note: 'Late shift' } });
  const annSlots = (await slots(`&therapistId=${ann.id}`)).map((s) => s.startMin);
  assert.equal(annSlots[0], 1080);
  assert.ok(!annSlots.includes(600));
  const list = (await call(`/api/therapists/${ann.id}/overrides`)).body.overrides;
  assert.equal(list[0].note, 'Late shift');
  await call(`/api/therapists/${ann.id}/overrides/${MON}`, { method: 'PUT', body: { blocks: [] } });
  assert.equal((await slots(`&therapistId=${ann.id}`))[0].startMin, 540);
});

test('rescheduling: moves, reassigns, keeps history, and refuses clashes', async (t) => {
  const { call, ann, ben, book } = await setup(t);
  const a = (await book({ therapistId: ann.id, startMin: 600 })).body.appointment;
  await book({ therapistId: ann.id, startMin: 780 });
  // Move onto an existing booking → refused.
  let r = await call(`/api/appointments/${a.id}`, { method: 'PATCH', body: { startMin: 780 } });
  assert.equal(r.status, 409);
  // Moving a little later overlaps itself only → allowed (it's excluded from the check).
  r = await call(`/api/appointments/${a.id}`, { method: 'PATCH', body: { startMin: 630 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.appointment.startMin, 630);
  // Reassign to Ben.
  r = await call(`/api/appointments/${a.id}`, { method: 'PATCH', body: { therapistId: ben.id, reason: 'Ann sick' } });
  assert.equal(r.body.appointment.therapistId, ben.id);
  const types = r.body.events.map((e) => e.type);
  assert.deepEqual(types, ['created', 'rescheduled', 'rescheduled']);
  assert.equal(r.body.events[2].detail.reason, 'Ann sick');
  assert.equal(r.body.events[2].detail.from.therapistId, ann.id);
  // Status changes are logged too.
  r = await call(`/api/appointments/${a.id}`, { method: 'PATCH', body: { status: 'completed' } });
  assert.equal(r.body.events.at(-1).type, 'status');
  // Staff slots exclude the booking being moved.
  const s = (await call(`/api/staff/slots?serviceId=${a.serviceId}&date=${MON}&therapistId=${ben.id}&excludeId=${a.id}`)).body.slots;
  assert.ok(s.some((x) => x.startMin === 630));
});

test('time off flags bookings that now clash', async (t) => {
  const { call, ann, book } = await setup(t);
  const a = (await book({ therapistId: ann.id, startMin: 600 })).body.appointment;
  const r = await call(`/api/therapists/${ann.id}/time-off`, { method: 'POST', body: { date: MON, reason: 'Sick' } });
  assert.equal(r.body.conflicts.length, 1);
  assert.equal(r.body.conflicts[0].id, a.id);
  assert.equal(r.body.conflicts[0].issues[0].code, 'time_off');
  const all = (await call('/api/conflicts')).body.conflicts;
  assert.equal(all.length, 1);
  const day = (await call(`/api/schedule?date=${MON}`)).body;
  assert.equal(day.appointments[0].issues[0].code, 'time_off');
});

test('inventory reports capacity vs booked time', async (t) => {
  const { call, ann, book } = await setup(t);
  await book({ therapistId: ann.id, startMin: 600 });
  await call(`/api/therapists/${ann.id}/time-off`, { method: 'POST', body: { date: MON, startMin: 720, endMin: 780 } });
  const inv = (await call(`/api/inventory?from=${MON}&days=1`)).body;
  const annDay = inv.therapists.find((x) => x.id === ann.id).days[0];
  assert.equal(annDay.availableMin, 420); // 8h minus 1h off
  assert.equal(annDay.bookedMin, 60);
  assert.equal(annDay.sessions, 1);
  assert.equal(inv.totals[0].availableMin, 900); // Ann 420 + Ben 480
});

test('clients can reschedule their own booking within policy', async (t) => {
  const { call, svc, slots } = await setup(t);
  const res = await call('/api/public/studio/book', { method: 'POST', body: { serviceId: svc.id, date: MON, startMin: 600, name: 'Cara', email: 'cara@x.com', phone: '1' } });
  assert.equal(res.status, 201);
  const { ref } = res.body.appointment;
  const token = res.body.manageToken;
  // With the booking excluded, its own time shows as open for the move.
  const mine = await slots(`&ref=${ref}&token=${token}`);
  assert.ok(mine.some((s) => s.startMin === 600 && s.therapistIds.includes(res.body.appointment.therapistId)));
  let r = await call(`/api/public/booking/${ref}/reschedule`, { method: 'POST', body: { token, date: MON, startMin: 840 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.appointment.startMin, 840);
  assert.equal(r.body.appointment.therapistId, res.body.appointment.therapistId, 'keeps the same therapist when free');
  r = await call(`/api/public/booking/${ref}/reschedule`, { method: 'POST', body: { token: 'nope', date: MON, startMin: 900 } });
  assert.equal(r.status, 404);
});

test('history search and reports', async (t) => {
  const { db, call, ann, book } = await setup(t);
  const a = (await book({ therapistId: ann.id, startMin: 600, name: 'Zed Quinn' })).body.appointment;
  await call(`/api/appointments/${a.id}`, { method: 'PATCH', body: { status: 'completed' } });
  const b2 = (await book({ therapistId: ann.id, startMin: 780, name: 'Amy' })).body.appointment;
  await call(`/api/appointments/${b2.id}`, { method: 'PATCH', body: { status: 'no_show' } });
  let r = await call('/api/appointments?q=zed');
  assert.equal(r.body.appointments.length, 1);
  assert.equal(r.body.appointments[0].clientName, 'Zed Quinn');
  r = await call(`/api/reports?from=${MON}&to=${MON}`);
  assert.equal(r.body.revenueCents, 10000);
  assert.equal(r.body.completed, 1);
  assert.equal(r.body.noShows, 1);
  assert.equal(r.body.noShowRate, 0.5);
  assert.equal(r.body.byTherapist.find((x) => x.id === ann.id).sessions, 2);
  assert.equal(r.body.clients.new, 2);
  const c = (await call(`/api/clients/${a.clientId}`)).body;
  assert.equal(c.stats.visits, 1);
  assert.equal(c.stats.rebook.therapistId, ann.id);
  void db;
});
