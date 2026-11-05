'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { openDb } = require('../lib/db');
const { createApp } = require('../lib/app');

const NOW = new Date('2026-11-01T08:00:00Z'); // Sunday
const MON = '2026-11-02';
const TOKEN = 'ExponentPushToken[abc123]';

async function setup(t, { sender } = {}) {
  const db = openDb(':memory:');
  const sent = [];
  const pushSender = sender || (async (messages) => { sent.push(...messages); return messages.map(() => ({ status: 'ok' })); });
  const app = createApp(db, { now: () => NOW, pushSender, log: { error() {} } });
  const server = http.createServer(app);
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
  token = (await call('/api/auth/signup', { method: 'POST', body: { businessName: 'Calm Studio', email: 'o@x.com', password: 'password1', timezone: 'UTC' } })).body.token;
  await call('/api/business', { method: 'PUT', body: { leadTimeMin: 0, cancelCutoffHours: 0 } });
  const svc = (await call('/api/services', { method: 'POST', body: { name: 'Swedish 60', durationMin: 60, priceCents: 9000 } })).body.service;
  await call('/api/therapists', { method: 'POST', body: { name: 'Ann', serviceIds: [svc.id], hours: [{ weekday: 1, startMin: 540, endMin: 1020 }] } });
  const bookOnline = (startMin = 600) => call('/api/public/calm-studio/book', { method: 'POST', body: { serviceId: svc.id, date: MON, startMin, name: 'Cara Diaz', email: 'cara@x.com', phone: '1' } });
  return { db, app, call, sent, svc, bookOnline };
}

test('online bookings, cancellations and moves alert staff phones and the inbox', async (t) => {
  const { app, call, sent, bookOnline } = await setup(t);
  assert.equal((await call('/api/push/devices', { method: 'POST', body: { token: 'nonsense' } })).status, 400);
  assert.equal((await call('/api/push/devices', { method: 'POST', body: { token: TOKEN, platform: 'ios' } })).status, 201);

  const b = await bookOnline();
  await app.flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, TOKEN);
  assert.match(sent[0].title, /^New booking · Mon, Nov 2 at 10:00 AM$/);
  assert.equal(sent[0].body, 'Cara Diaz booked Swedish 60 with Ann.');
  assert.equal(sent[0].data.url, `/appointment/${b.body.appointment.id}`);
  assert.equal(sent[0].badge, 1);

  const { ref } = b.body.appointment;
  const tok = b.body.manageToken;
  await call(`/api/public/booking/${ref}/reschedule`, { method: 'POST', body: { token: tok, date: MON, startMin: 720 } });
  await call(`/api/public/booking/${ref}/cancel`, { method: 'POST', body: { token: tok } });
  await app.flush();
  assert.deepEqual(sent.map((m) => m.title.split(' ')[0]), ['New', 'Moved', 'Cancelled']);

  const inbox = (await call('/api/notifications')).body;
  assert.equal(inbox.unread, 3);
  assert.equal(inbox.notifications[0].type, 'cancelled');
  const read = await call('/api/notifications/read', { method: 'POST', body: { ids: [inbox.notifications[0].id] } });
  assert.equal(read.body.unread, 2);
  assert.equal((await call('/api/notifications/read', { method: 'POST', body: {} })).body.unread, 0);
});

test('staff actions do not notify; preferences silence pushes but keep the inbox', async (t) => {
  const { app, call, sent, bookOnline, svc } = await setup(t);
  await call('/api/push/devices', { method: 'POST', body: { token: TOKEN } });
  const therapists = (await call('/api/therapists')).body.therapists;
  await call('/api/appointments', { method: 'POST', body: { serviceId: svc.id, therapistId: therapists[0].id, date: MON, startMin: 540, name: 'Walk In', email: 'w@x.com' } });
  await app.flush();
  assert.equal(sent.length, 0, 'staff made it themselves');

  const prefs = await call('/api/notifications/prefs', { method: 'PUT', body: { newBooking: false, digestHour: 99 } });
  assert.equal(prefs.body.prefs.newBooking, false);
  assert.equal(prefs.body.prefs.digestHour, 8, 'invalid hour ignored');
  await bookOnline(720);
  await app.flush();
  assert.equal(sent.length, 0);
  assert.equal((await call('/api/notifications')).body.unread, 1, 'still recorded in the inbox');
});

test('phones that uninstalled the app are forgotten', async (t) => {
  let calls = 0;
  const sender = async (messages) => { calls++; return messages.map(() => ({ status: 'error', details: { error: 'DeviceNotRegistered' } })); };
  const { db, app, call, bookOnline } = await setup(t, { sender });
  await call('/api/push/devices', { method: 'POST', body: { token: TOKEN } });
  await bookOnline();
  await app.flush();
  assert.equal(calls, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM push_devices').get().n, 0);
});

test('a failing push service never breaks the booking', async (t) => {
  const sender = async () => { throw new Error('network down'); };
  const { app, bookOnline, call } = await setup(t, { sender });
  await call('/api/push/devices', { method: 'POST', body: { token: TOKEN } });
  const r = await bookOnline();
  await app.flush();
  assert.equal(r.status, 201);
  const test = await call('/api/push/test', { method: 'POST' });
  assert.equal(test.body.error, 'network down');
});

test('morning summary goes out once, at the chosen local hour', async (t) => {
  const { app, call, sent, bookOnline } = await setup(t);
  await call('/api/push/devices', { method: 'POST', body: { token: TOKEN } });
  await bookOnline(600);
  await bookOnline(780);
  await app.flush();
  sent.length = 0;
  await call('/api/notifications/prefs', { method: 'PUT', body: { digestHour: 7 } });
  assert.deepEqual(await app.runDigests(new Date('2026-11-02T06:59:00Z')), [], 'too early');
  assert.equal((await app.runDigests(new Date('2026-11-02T07:01:00Z'))).length, 1);
  assert.deepEqual(await app.runDigests(new Date('2026-11-02T07:30:00Z')), [], 'only once a day');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].title, 'Today at Calm Studio');
  assert.equal(sent[0].body, '2 bookings · first at 10:00 AM · $180 expected.');
  await call('/api/notifications/prefs', { method: 'PUT', body: { digest: false } });
  assert.deepEqual(await app.runDigests(new Date('2026-11-03T07:05:00Z')), []);
});
