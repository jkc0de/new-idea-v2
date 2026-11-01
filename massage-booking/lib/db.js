'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS businesses (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  currency TEXT NOT NULL DEFAULT 'USD',
  lead_time_min INTEGER NOT NULL DEFAULT 60,
  booking_window_days INTEGER NOT NULL DEFAULT 60,
  cancel_cutoff_hours INTEGER NOT NULL DEFAULT 24,
  slot_step_min INTEGER NOT NULL DEFAULT 15,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  duration_min INTEGER NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  buffer_min INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS therapists (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  bio TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS therapist_services (
  therapist_id INTEGER NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (therapist_id, service_id)
);

-- Weekly working hours. weekday: 0 = Sunday ... 6 = Saturday. Times are minutes from midnight.
CREATE TABLE IF NOT EXISTS availability (
  id INTEGER PRIMARY KEY,
  therapist_id INTEGER NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL CHECK (end_min > start_min)
);

CREATE TABLE IF NOT EXISTS time_off (
  id INTEGER PRIMARY KEY,
  therapist_id INTEGER NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  start_min INTEGER NOT NULL DEFAULT 0,
  end_min INTEGER NOT NULL DEFAULT 1440,
  reason TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (business_id, email)
);

-- Dates and times are stored in the business's local time zone.
-- block_end_min = end_min + the service's cleanup buffer; used for overlap checks.
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  therapist_id INTEGER NOT NULL REFERENCES therapists(id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  date TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  block_end_min INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','completed','cancelled','no_show')),
  price_cents INTEGER NOT NULL DEFAULT 0,
  client_notes TEXT DEFAULT '',
  internal_notes TEXT DEFAULT '',
  ref TEXT NOT NULL UNIQUE,
  manage_token TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'online',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_appt_therapist_date ON appointments(therapist_id, date);

-- Treatment rooms are inventory too: a booking needs a free therapist AND a free room.
-- If a business has no rooms, room checks are skipped.
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

-- Services that can only happen in certain rooms (e.g. hot stone needs the stone room).
-- A service with no rows here can use any room.
CREATE TABLE IF NOT EXISTS service_rooms (
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  PRIMARY KEY (service_id, room_id)
);

-- Custom hours for one date. When a date has overrides they replace the weekly hours.
CREATE TABLE IF NOT EXISTS schedule_overrides (
  id INTEGER PRIMARY KEY,
  therapist_id INTEGER NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL CHECK (end_min > start_min),
  note TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_override_therapist_date ON schedule_overrides(therapist_id, date);

-- Everything that happens to a booking, for history and accountability.
CREATE TABLE IF NOT EXISTS appointment_events (
  id INTEGER PRIMARY KEY,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  actor TEXT NOT NULL,
  type TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_events_appt ON appointment_events(appointment_id);
CREATE INDEX IF NOT EXISTS idx_appt_business_date ON appointments(business_id, date);
`;

// Columns added after the first release. Added in place so existing databases keep working.
const COLUMNS = [
  ['therapists', 'max_sessions_per_day', 'INTEGER'],          // null = no limit
  ['therapists', 'max_consecutive_min', 'INTEGER'],           // null = no limit
  ['therapists', 'min_break_min', 'INTEGER NOT NULL DEFAULT 30'],
  ['appointments', 'room_id', 'INTEGER REFERENCES rooms(id)'],
  ['appointments', 'updated_at', 'TEXT'],
];

function migrate(db) {
  for (const [table, col, def] of COLUMNS) {
    const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
    if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_appt_room_date ON appointments(room_id, date)');
}

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Run fn inside a transaction. IMMEDIATE takes the write lock up front so availability checks can't race. */
function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { openDb, tx };
