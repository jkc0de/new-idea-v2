'use strict';
const { weekdayOf, addDays, nowInZone, minutesBetween } = require('./time');

/**
 * Pure slot calculation.
 * windows: working intervals [{start, end}] (minutes from midnight)
 * busy:    blocked intervals [{start, end}] (existing appointments incl. their buffer, time off)
 * A slot needs `duration` inside a window, and `duration + buffer` clear of anything busy.
 */
function computeSlots({ windows, busy, duration, buffer = 0, step = 15, isAllowed = () => true }) {
  const out = new Set();
  for (const w of windows) {
    let s = Math.ceil(w.start / step) * step;
    for (; s + duration <= w.end; s += step) {
      const blockEnd = s + duration + buffer;
      const clash = busy.some((b) => s < b.end && blockEnd > b.start);
      if (!clash && isAllowed(s)) out.add(s);
    }
  }
  return [...out].sort((a, b) => a - b);
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function loadDay(db, therapistId, date, { excludeAppointmentId = null } = {}) {
  const windows = db.prepare(
    'SELECT start_min AS start, end_min AS end FROM availability WHERE therapist_id = ? AND weekday = ? ORDER BY start_min',
  ).all(therapistId, weekdayOf(date));
  const timeOff = db.prepare(
    'SELECT start_min AS start, end_min AS end FROM time_off WHERE therapist_id = ? AND date = ?',
  ).all(therapistId, date);
  const appts = db.prepare(
    `SELECT id, start_min AS start, block_end_min AS end FROM appointments
     WHERE therapist_id = ? AND date = ? AND status IN ('booked','completed')`,
  ).all(therapistId, date).filter((a) => a.id !== excludeAppointmentId);
  return { windows, timeOff, appts };
}

/** Returns a predicate that enforces lead time + booking window for public bookings, or null if the date is out of range. */
function bookingRules(business, date, now = new Date()) {
  const today = nowInZone(business.timezone, now);
  if (date < today.date) return null;
  if (date > addDays(today.date, business.booking_window_days)) return null;
  return (s) => minutesBetween(today.date, today.minutes, date, s) >= business.lead_time_min;
}

function therapistCanDo(db, therapistId, serviceId) {
  return !!db.prepare(
    `SELECT 1 FROM therapist_services ts JOIN therapists t ON t.id = ts.therapist_id
     WHERE ts.therapist_id = ? AND ts.service_id = ? AND t.active = 1`,
  ).get(therapistId, serviceId);
}

function therapistSlots(db, business, therapistId, service, date, now) {
  const isAllowed = bookingRules(business, date, now);
  if (!isAllowed) return [];
  const { windows, timeOff, appts } = loadDay(db, therapistId, date);
  return computeSlots({
    windows,
    busy: [...timeOff, ...appts],
    duration: service.duration_min,
    buffer: service.buffer_min,
    step: business.slot_step_min,
    isAllowed,
  });
}

/**
 * Public availability for a service on a date.
 * Returns [{ time, therapistIds: [...] }] so the "any therapist" option can be resolved at booking time.
 */
function serviceSlots(db, business, service, date, therapistId = null, now) {
  const therapists = therapistId
    ? [therapistId]
    : db.prepare(
      `SELECT t.id FROM therapists t JOIN therapist_services ts ON ts.therapist_id = t.id
       WHERE t.business_id = ? AND t.active = 1 AND ts.service_id = ?`,
    ).all(business.id, service.id).map((r) => r.id);

  const byTime = new Map();
  for (const tid of therapists) {
    if (!therapistCanDo(db, tid, service.id)) continue;
    for (const s of therapistSlots(db, business, tid, service, date, now)) {
      if (!byTime.has(s)) byTime.set(s, []);
      byTime.get(s).push(tid);
    }
  }
  return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([time, therapistIds]) => ({ time, therapistIds }));
}

/** For staff-entered bookings: only check clashes with other appointments (staff may book outside normal hours). */
function staffConflict(db, therapistId, date, start, blockEnd, excludeAppointmentId = null) {
  const { appts } = loadDay(db, therapistId, date, { excludeAppointmentId });
  return appts.some((a) => overlaps(start, blockEnd, a.start, a.end));
}

module.exports = { computeSlots, overlaps, therapistSlots, serviceSlots, staffConflict, therapistCanDo, bookingRules };
