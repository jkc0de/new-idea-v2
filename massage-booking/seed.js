'use strict';
// Creates a demo business with therapists, services, hours and a few bookings.
// Login: demo@serenity.test / demo1234   Booking page: /b/serenity
const path = require('node:path');
const { openDb } = require('./lib/db');
const { hashPassword } = require('./lib/auth');
const { nowInZone, addDays } = require('./lib/time');

const db = openDb(process.env.DB_FILE || path.join(__dirname, 'data', 'booking.db'));
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

if (db.prepare("SELECT 1 FROM businesses WHERE slug = 'serenity'").get()) {
  console.log('Demo business already exists. Delete data/booking.db to reseed.');
  process.exit(0);
}

const bid = Number(db.prepare(`INSERT INTO businesses (name, slug, email, password_hash, phone, address, timezone)
  VALUES (?, ?, ?, ?, ?, ?, ?)`).run('Serenity Massage Studio', 'serenity', 'demo@serenity.test', hashPassword('demo1234'),
  '(555) 010-2030', '12 Willow Lane, Springfield', tz).lastInsertRowid);

const svc = (name, description, dur, price, buffer) => Number(db.prepare(
  'INSERT INTO services (business_id, name, description, duration_min, price_cents, buffer_min) VALUES (?, ?, ?, ?, ?, ?)',
).run(bid, name, description, dur, price, buffer).lastInsertRowid);

const swedish60 = svc('Swedish Massage – 60 min', 'Long, flowing strokes to relax the whole body.', 60, 9000, 15);
const swedish90 = svc('Swedish Massage – 90 min', 'Extended full-body relaxation session.', 90, 12500, 15);
const deep60 = svc('Deep Tissue – 60 min', 'Firm pressure targeting knots and chronic tension.', 60, 10500, 15);
const sports = svc('Sports Massage – 45 min', 'Focused work for recovery and mobility.', 45, 8000, 15);
const prenatal = svc('Prenatal Massage – 60 min', 'Gentle, supported massage for expecting mothers.', 60, 9500, 15);
const hotstone = svc('Hot Stone – 75 min', 'Heated basalt stones melt away deep tension.', 75, 13000, 20);

const therapist = (name, bio, services, hours) => {
  const id = Number(db.prepare('INSERT INTO therapists (business_id, name, bio) VALUES (?, ?, ?)').run(bid, name, bio).lastInsertRowid);
  for (const s of services) db.prepare('INSERT INTO therapist_services VALUES (?, ?)').run(id, s);
  for (const [days, start, end] of hours) {
    for (const d of days) db.prepare('INSERT INTO availability (therapist_id, weekday, start_min, end_min) VALUES (?, ?, ?, ?)').run(id, d, start * 60, end * 60);
  }
  return id;
};

const maya = therapist('Maya Chen', 'Licensed for 9 years. Specialises in deep tissue and sports recovery.',
  [swedish60, swedish90, deep60, sports], [[[1, 2, 3, 4, 5], 9, 17]]);
const jordan = therapist('Jordan Ellis', 'Calm, intuitive touch. Certified prenatal and hot stone therapist.',
  [swedish60, swedish90, prenatal, hotstone], [[[2, 3, 4, 5], 11, 19], [[6], 10, 16]]);
const sam = therapist('Sam Rivera', 'Former athletic trainer with a focus on mobility and injury prevention.',
  [deep60, sports, swedish60], [[[1, 3, 5], 12, 20], [[6, 0], 9, 14]]);

const client = (name, email, phone) => Number(db.prepare('INSERT INTO clients (business_id, name, email, phone) VALUES (?, ?, ?, ?)').run(bid, name, email, phone).lastInsertRowid);
const c1 = client('Alex Morgan', 'alex@example.com', '555-0101');
const c2 = client('Priya Patel', 'priya@example.com', '555-0102');
const c3 = client('Chris Wong', 'chris@example.com', '555-0103');

const today = nowInZone(tz).date;
let n = 0;
const book = (t, s, c, dayOffset, hour, status = 'booked') => {
  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(s);
  const start = hour * 60;
  n++;
  db.prepare(`INSERT INTO appointments (business_id, therapist_id, service_id, client_id, date, start_min, end_min, block_end_min,
    status, price_cents, ref, manage_token, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    bid, t, s, c, addDays(today, dayOffset), start, start + service.duration_min, start + service.duration_min + service.buffer_min,
    status, service.price_cents, `DEMO-000${n}`, `demo-token-${n}`, 'staff');
};
book(maya, deep60, c1, -7, 10, 'completed');
book(jordan, hotstone, c2, -3, 13, 'completed');
book(maya, swedish60, c3, 1, 10);
book(jordan, prenatal, c2, 2, 14);
book(sam, sports, c1, 3, 13);

console.log('Demo data created.');
console.log('  Login:        demo@serenity.test / demo1234');
console.log('  Booking page: /b/serenity');
