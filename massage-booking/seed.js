'use strict';
// Demo studio with two months of history, rooms, shifts with breaks, limits and a schedule conflict to resolve.
// Login: demo@serenity.test / demo1234   Booking page: /b/serenity
// Bookings are placed through the real scheduling engine, so the demo data obeys every rule.
const path = require('node:path');
const { openDb } = require('./lib/db');
const { hashPassword, bookingRef, randomToken } = require('./lib/auth');
const { nowInZone, addDays } = require('./lib/time');
const sched = require('./lib/scheduler');

const db = openDb(process.env.DB_FILE || path.join(__dirname, 'data', 'booking.db'));
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

if (db.prepare("SELECT 1 FROM businesses WHERE slug = 'serenity'").get()) {
  console.log('Demo business already exists. Delete data/booking.db to reseed.');
  process.exit(0);
}

// Deterministic randomness so the demo looks the same every time.
let seed = 42;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const run = (sql, ...args) => Number(db.prepare(sql).run(...args).lastInsertRowid);

const bid = run(`INSERT INTO businesses (name, slug, email, password_hash, phone, address, timezone, lead_time_min, cancel_cutoff_hours)
  VALUES (?, ?, ?, ?, ?, ?, ?, 60, 24)`, 'Serenity Massage Studio', 'serenity', 'demo@serenity.test', hashPassword('demo1234'),
'(555) 010-2030', '12 Willow Lane, Springfield', tz);
const business = db.prepare('SELECT * FROM businesses WHERE id = ?').get(bid);

// ---------- rooms ----------
const room = (name, sort) => run('INSERT INTO rooms (business_id, name, sort) VALUES (?, ?, ?)', bid, name, sort);
const willow = room('Willow', 1);
const cedar = room('Cedar', 2);
const stoneRoom = room('Stone Room', 3);

// ---------- services ----------
const svc = (name, description, dur, price, buffer, rooms = []) => {
  const id = run('INSERT INTO services (business_id, name, description, duration_min, price_cents, buffer_min) VALUES (?, ?, ?, ?, ?, ?)', bid, name, description, dur, price, buffer);
  for (const r of rooms) run('INSERT INTO service_rooms (service_id, room_id) VALUES (?, ?)', id, r);
  return id;
};
const swedish60 = svc('Swedish Massage – 60 min', 'Long, flowing strokes to relax the whole body.', 60, 9000, 15);
const swedish90 = svc('Swedish Massage – 90 min', 'Extended full-body relaxation session.', 90, 12500, 15);
const deep60 = svc('Deep Tissue – 60 min', 'Firm pressure targeting knots and chronic tension.', 60, 10500, 15);
const sports = svc('Sports Massage – 45 min', 'Focused work for recovery and mobility.', 45, 8000, 15);
const prenatal = svc('Prenatal Massage – 60 min', 'Gentle, supported massage for expecting mothers.', 60, 9500, 15);
const hotstone = svc('Hot Stone – 75 min', 'Heated basalt stones melt away deep tension. Takes place in our Stone Room.', 75, 13000, 20, [stoneRoom]);

// ---------- therapists ----------
const therapist = (name, bio, services, shifts, limits = {}) => {
  const id = run('INSERT INTO therapists (business_id, name, bio, max_sessions_per_day, max_consecutive_min, min_break_min) VALUES (?, ?, ?, ?, ?, ?)',
    bid, name, bio, limits.maxSessions ?? null, limits.maxConsecutive ?? null, limits.minBreak ?? 30);
  for (const s of services) run('INSERT INTO therapist_services VALUES (?, ?)', id, s);
  for (const [days, start, end] of shifts) for (const d of days) run('INSERT INTO availability (therapist_id, weekday, start_min, end_min) VALUES (?, ?, ?, ?)', id, d, start * 60, end * 60);
  return id;
};
// Maya: split shift with a lunch break, max 6 a day, needs a 30-min break after 3 hours.
const maya = therapist('Maya Chen', 'Licensed for 9 years. Specialises in deep tissue and sports recovery.',
  [swedish60, swedish90, deep60, sports], [[[1, 2, 3, 4, 5], 9, 13], [[1, 2, 3, 4, 5], 14, 17.5]], { maxSessions: 6, maxConsecutive: 180, minBreak: 30 });
// Jordan: afternoons + Saturday, max 5 a day.
const jordan = therapist('Jordan Ellis', 'Calm, intuitive touch. Certified prenatal and hot stone therapist.',
  [swedish60, swedish90, prenatal, hotstone], [[[2, 3, 4, 5], 11, 19], [[6], 10, 16]], { maxSessions: 5, maxConsecutive: 240, minBreak: 30 });
// Sam: evenings and weekends.
const sam = therapist('Sam Rivera', 'Former athletic trainer with a focus on mobility and injury prevention.',
  [deep60, sports, swedish60, hotstone], [[[1, 3, 5], 12, 20], [[6, 0], 9, 15]], { maxSessions: 6, maxConsecutive: 210, minBreak: 30 });
const team = [maya, jordan, sam];

// ---------- clients ----------
const FIRST = ['Alex', 'Priya', 'Chris', 'Taylor', 'Jamie', 'Morgan', 'Sofia', 'Daniel', 'Hannah', 'Marcus', 'Elena', 'Noah', 'Grace', 'Omar', 'Lily', 'Ethan', 'Zara', 'Lucas', 'Mia', 'Ben', 'Aisha', 'Ryan', 'Chloe', 'Kenji', 'Nora', 'Leo', 'Isla', 'Mateo', 'Ruby', 'Sam'];
const LAST = ['Morgan', 'Patel', 'Wong', 'Brooks', 'Garcia', 'Lee', 'Rossi', 'Kim', 'Novak', 'Bell', 'Silva', 'Clarke', 'Ahmed', 'Turner', 'Nguyen', 'Fischer', 'Okafor', 'Hughes', 'Dubois', 'Reyes'];
const NOTES = ['Prefers light pressure. Sensitive lower back.', 'Desk worker — tight shoulders and neck.', 'Runner. Focus on calves and hamstrings.', 'Allergic to nut oils — use the unscented lotion.', 'Likes the room warm. Chatty.', 'Recovering from a shoulder injury (left side).', '', '', '', ''];
const clients = [];
for (let i = 0; i < 42; i++) {
  const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`;
  const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}${i}@example.com`;
  const id = run('INSERT INTO clients (business_id, name, email, phone, notes) VALUES (?, ?, ?, ?, ?)', bid, name, email, `555-01${String(i).padStart(2, '0')}`, pick(NOTES));
  // Some clients are regulars (high weight), most are occasional.
  clients.push({ id, weight: i < 10 ? 6 : i < 22 ? 2 : 1, favorite: pick(team) });
}
const weighted = clients.flatMap((c) => Array(c.weight).fill(c));

// ---------- bookings via the engine ----------
const today = nowInZone(tz).date;
const services = db.prepare('SELECT * FROM services WHERE business_id = ?').all(bid);
const canDo = new Map(team.map((t) => [t, db.prepare('SELECT service_id FROM therapist_services WHERE therapist_id = ?').all(t).map((r) => r.service_id)]));
const insert = db.prepare(`INSERT INTO appointments (business_id, therapist_id, room_id, service_id, client_id, date, start_min, end_min, block_end_min,
  status, price_cents, client_notes, ref, manage_token, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const event = db.prepare('INSERT INTO appointment_events (appointment_id, at, actor, type, detail) VALUES (?, ?, ?, ?, ?)');
const CLIENT_NOTES = ['', '', '', '', 'Tight shoulders from work', 'First time — a bit nervous', 'Please focus on lower back', 'Training for a marathon'];
const stamp = (date, min) => `${date} ${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00`;

let made = 0;
function fillDay(date, targetUtil) {
  for (const tid of team) {
    let ctx = sched.loadDay(db, bid, date);
    const day = ctx.therapists.get(tid);
    for (const w of day.windows) {
      for (let s = w.start; s < w.end; s += 15) {
        if (rand() > targetUtil * 0.35) continue;
        const client = pick(weighted);
        const options = services.filter((x) => canDo.get(tid).includes(x.id));
        const service = rand() < 0.45 && client.favorite === tid ? options[0] : pick(options);
        const v = sched.evaluate(ctx, { therapistId: tid, service, start: s });
        if (v.hard.length || v.soft.length) continue;
        const past = date < today;
        const r = rand();
        const status = past ? (r < 0.86 ? 'completed' : r < 0.91 ? 'no_show' : 'cancelled') : (r < 0.94 ? 'booked' : 'cancelled');
        const online = rand() < 0.68;
        const leadDays = 1 + Math.floor(rand() * 12);
        const createdAt = stamp(addDays(date, -leadDays), 480 + Math.floor(rand() * 600));
        const id = Number(insert.run(bid, tid, v.roomId, service.id, client.id, date, s, s + service.duration_min, s + service.duration_min + service.buffer_min,
          status, service.price_cents, pick(CLIENT_NOTES), bookingRef(), randomToken(), online ? 'online' : 'staff', createdAt).lastInsertRowid);
        event.run(id, createdAt, online ? 'client' : 'staff', 'created', JSON.stringify({ date, startMin: s, therapistId: tid, roomId: v.roomId, serviceId: service.id }));
        if (status === 'completed' || status === 'no_show') event.run(id, stamp(date, s + service.duration_min + 5), 'staff', 'status', JSON.stringify({ from: 'booked', to: status }));
        if (status === 'cancelled') event.run(id, stamp(addDays(date, -1), 600), rand() < 0.6 ? 'client' : 'staff', 'status', JSON.stringify({ from: 'booked', to: 'cancelled' }));
        made++;
        ctx = sched.loadDay(db, bid, date);
        s += service.duration_min - 15; // skip ahead past this booking
      }
    }
  }
}

for (let d = -60; d <= 14; d++) {
  const date = addDays(today, d);
  // Busier on weekends and later in the period; future fills up less the further out it is.
  const wd = new Date(date + 'T00:00:00Z').getUTCDay();
  const base = d < 0 ? 0.62 + Math.min(0.15, (60 + d) / 400) : Math.max(0.12, 0.6 - d * 0.035);
  fillDay(date, Math.min(0.9, base + (wd === 6 || wd === 0 ? 0.12 : 0)));
}

// A rescheduled booking in history, to show the activity log.
const moved = db.prepare(`SELECT * FROM appointments WHERE business_id = ? AND status = 'booked' AND date > ? ORDER BY date, start_min LIMIT 1`).get(bid, today);
if (moved) {
  event.run(moved.id, stamp(addDays(today, -1), 615), 'client', 'rescheduled', JSON.stringify({
    from: { date: addDays(moved.date, -1), startMin: moved.start_min + 60, therapistId: moved.therapist_id }, to: { date: moved.date, startMin: moved.start_min, therapistId: moved.therapist_id },
  }));
}

// Custom hours: Sam covers a Tuesday evening next week.
const nextTue = (() => { let d = addDays(today, 1); while (new Date(d + 'T00:00:00Z').getUTCDay() !== 2) d = addDays(d, 1); return d; })();
run('INSERT INTO schedule_overrides (therapist_id, date, start_min, end_min, note) VALUES (?, ?, ?, ?, ?)', sam, nextTue, 15 * 60, 20 * 60, 'Covering evening');

// Jordan calls in sick for a day that already has bookings → shows up under "Needs attention".
const sickDay = db.prepare(`SELECT date FROM appointments WHERE therapist_id = ? AND status = 'booked' AND date > ? GROUP BY date ORDER BY date LIMIT 1`).get(jordan, today);
if (sickDay) run('INSERT INTO time_off (therapist_id, date, start_min, end_min, reason) VALUES (?, ?, 0, 1440, ?)', jordan, sickDay.date, 'Sick');

console.log(`Demo data created: ${made} bookings over 75 days, 3 rooms, 3 therapists, ${clients.length} clients.`);
console.log('  Login:        demo@serenity.test / demo1234');
console.log('  Booking page: /b/serenity');
void business; void willow; void cedar;
