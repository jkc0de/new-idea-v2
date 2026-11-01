'use strict';
/**
 * The scheduling engine. Every "can this booking happen?" question goes through here.
 *
 * A booking needs:
 *   HARD (never allowed, not even for staff)
 *     - the therapist free for the session + cleanup buffer
 *     - a free room the service is allowed in (when the business uses rooms)
 *   SOFT (blocks online booking; staff may override with a warning)
 *     - inside the therapist's working hours for that date (weekly hours or a date override)
 *     - not during their time off
 *     - under their daily session limit
 *     - not making them work too long without a break
 */
const { weekdayOf, addDays, nowInZone, minutesBetween, fmtTime } = require('./time');

// Statuses that occupy time. No-shows still used the slot.
const OCCUPYING = "status IN ('booked','completed','no_show')";

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && aEnd > bStart;

/** Everything needed to answer scheduling questions for one business on one date. */
function loadDay(db, businessId, date, { excludeId = null } = {}) {
  const weekday = weekdayOf(date);
  const weekly = db.prepare('SELECT start_min AS start, end_min AS end FROM availability WHERE therapist_id = ? AND weekday = ? ORDER BY start_min');
  const overrides = db.prepare('SELECT start_min AS start, end_min AS end, note FROM schedule_overrides WHERE therapist_id = ? AND date = ? ORDER BY start_min');
  const timeOff = db.prepare('SELECT id, start_min AS start, end_min AS end, reason FROM time_off WHERE therapist_id = ? AND date = ? ORDER BY start_min');
  const appts = db.prepare(
    `SELECT id, therapist_id AS therapistId, room_id AS roomId, start_min AS start, end_min AS end, block_end_min AS blockEnd
     FROM appointments WHERE business_id = ? AND date = ? AND ${OCCUPYING} ORDER BY start_min`,
  ).all(businessId, date).filter((a) => a.id !== excludeId);

  const therapists = new Map();
  for (const t of db.prepare('SELECT * FROM therapists WHERE business_id = ?').all(businessId)) {
    const ov = overrides.all(t.id, date);
    therapists.set(t.id, {
      t,
      windows: ov.length ? ov : weekly.all(t.id, weekday),
      overridden: ov.length > 0,
      timeOff: timeOff.all(t.id, date),
      appts: appts.filter((a) => a.therapistId === t.id),
    });
  }

  const rooms = db.prepare('SELECT * FROM rooms WHERE business_id = ? AND active = 1 ORDER BY sort, id').all(businessId);
  const roomAppts = new Map(rooms.map((r) => [r.id, appts.filter((a) => a.roomId === r.id)]));
  const serviceRooms = new Map();
  for (const row of db.prepare('SELECT sr.service_id AS s, sr.room_id AS r FROM service_rooms sr JOIN services sv ON sv.id = sr.service_id WHERE sv.business_id = ?').all(businessId)) {
    if (!serviceRooms.has(row.s)) serviceRooms.set(row.s, []);
    serviceRooms.get(row.s).push(row.r);
  }
  // How many services depend exclusively on each room. Used to keep special rooms free.
  const roomDemand = new Map(rooms.map((r) => [r.id, 0]));
  for (const ids of serviceRooms.values()) for (const id of ids) roomDemand.set(id, (roomDemand.get(id) || 0) + 1);

  return { date, therapists, rooms, roomAppts, serviceRooms, roomDemand };
}

function allowedRooms(ctx, serviceId) {
  const ids = ctx.serviceRooms.get(serviceId);
  if (!ids || !ids.length) return ctx.rooms;
  const restricted = ctx.rooms.filter((r) => ids.includes(r.id));
  return restricted;
}

/**
 * Longest stretch of near-continuous work that would include the candidate session.
 * Sessions separated by less than `minBreak` minutes count as one stretch.
 */
function stretchWith(appts, start, end, minBreak) {
  const list = [...appts.map((a) => [a.start, a.end, false]), [start, end, true]].sort((x, y) => x[0] - y[0]);
  let chainStart = list[0][0];
  let chainEnd = list[0][1];
  let hasCandidate = list[0][2];
  for (let i = 1; i < list.length; i++) {
    const [s, e, cand] = list[i];
    if (s - chainEnd < minBreak) {
      chainEnd = Math.max(chainEnd, e);
      hasCandidate = hasCandidate || cand;
    } else {
      if (hasCandidate) return chainEnd - chainStart;
      chainStart = s; chainEnd = e; hasCandidate = cand;
    }
  }
  return chainEnd - chainStart;
}

/**
 * Check one candidate booking. Returns { hard: [...], soft: [...], roomId }.
 * Pass roomId to require a specific room; otherwise the best free room is picked.
 */
function evaluate(ctx, { therapistId, service, start, roomId = null }) {
  const hard = [];
  const soft = [];
  const day = ctx.therapists.get(Number(therapistId));
  const end = start + service.duration_min;
  const blockEnd = end + service.buffer_min;
  if (!day) return { hard: ['unknown_therapist'], soft, roomId: null };
  if (!Number.isInteger(start) || start < 0 || end > 1440) hard.push('out_of_day');

  if (day.appts.some((a) => overlaps(start, blockEnd, a.start, a.blockEnd))) hard.push('therapist_busy');

  let room = null;
  if (ctx.rooms.length) {
    const allowed = allowedRooms(ctx, service.id);
    const free = allowed.filter((r) => !ctx.roomAppts.get(r.id).some((a) => overlaps(start, blockEnd, a.start, a.blockEnd)));
    if (roomId) {
      room = free.find((r) => r.id === Number(roomId)) || null;
      if (!room) hard.push(allowed.some((r) => r.id === Number(roomId)) ? 'room_busy' : 'room_not_allowed');
    } else if (!allowed.length) {
      hard.push('no_room_for_service');
    } else {
      // Prefer rooms that fewer special services depend on, so e.g. the stone room stays open for hot stone.
      room = [...free].sort((a, b) => (ctx.roomDemand.get(a.id) || 0) - (ctx.roomDemand.get(b.id) || 0) || a.sort - b.sort || a.id - b.id)[0] || null;
      if (!room) hard.push('no_room');
    }
  }

  if (!day.t.active) soft.push('inactive');
  if (!day.windows.some((w) => start >= w.start && end <= w.end)) soft.push('outside_hours');
  if (day.timeOff.some((o) => overlaps(start, end, o.start, o.end))) soft.push('time_off');
  if (day.t.max_sessions_per_day && day.appts.length >= day.t.max_sessions_per_day) soft.push('daily_limit');
  if (day.t.max_consecutive_min && stretchWith(day.appts, start, end, day.t.min_break_min ?? 30) > day.t.max_consecutive_min) soft.push('needs_break');

  return { hard, soft, roomId: room ? room.id : null };
}

const ISSUE_TEXT = {
  unknown_therapist: () => 'Unknown therapist',
  out_of_day: () => 'That time doesn’t fit in the day',
  therapist_busy: (n) => `${n} already has a booking then`,
  room_busy: () => 'That room is taken then',
  room_not_allowed: () => 'This service can’t be done in that room',
  no_room_for_service: () => 'No active room can host this service',
  no_room: () => 'All suitable rooms are taken then',
  inactive: (n) => `${n} isn’t taking bookings`,
  outside_hours: (n) => `Outside ${n}’s working hours`,
  time_off: (n) => `${n} is on time off`,
  daily_limit: (n, t) => `${n} has reached their limit of ${t.max_sessions_per_day} sessions that day`,
  needs_break: (n, t) => `${n} would work over ${t.max_consecutive_min} minutes without a ${t.min_break_min}-minute break`,
};

function describe(ctx, therapistId, codes) {
  const day = ctx.therapists.get(Number(therapistId));
  const name = day ? day.t.name : 'Therapist';
  return codes.map((c) => ({ code: c, message: (ISSUE_TEXT[c] || (() => c))(name, day ? day.t : {}) }));
}

/** Lead time + booking window for online bookings. Returns null if the date is out of range. */
function onlineRule(business, date, now) {
  const today = nowInZone(business.timezone, now);
  if (date < today.date) return null;
  if (date > addDays(today.date, business.booking_window_days)) return null;
  return (s) => minutesBetween(today.date, today.minutes, date, s) >= business.lead_time_min;
}

/** Same day, staff view: anything not in the past. */
function staffRule(business, date, now) {
  const today = nowInZone(business.timezone, now);
  if (date < today.date) return null;
  return (s) => date > today.date || s >= today.minutes;
}

/**
 * Bookable start times for a service.
 * Returns [{ startMin, therapistIds }] where every listed therapist passes all hard and soft checks.
 */
function slots(ctx, business, service, therapistIds, isAllowed) {
  if (!isAllowed) return [];
  const step = business.slot_step_min || 15;
  const byTime = new Map();
  for (const tid of therapistIds) {
    const day = ctx.therapists.get(tid);
    if (!day || !day.t.active) continue;
    for (const w of day.windows) {
      for (let s = Math.ceil(w.start / step) * step; s + service.duration_min <= w.end; s += step) {
        if (!isAllowed(s)) continue;
        const r = evaluate(ctx, { therapistId: tid, service, start: s });
        if (r.hard.length || r.soft.length) continue;
        if (!byTime.has(s)) byTime.set(s, []);
        byTime.get(s).push(tid);
      }
    }
  }
  return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([startMin, ids]) => ({ startMin, therapistIds: ids }));
}

/** Therapists who offer the service (and are active). */
function therapistsFor(db, businessId, serviceId) {
  return db.prepare(
    `SELECT t.id FROM therapists t JOIN therapist_services ts ON ts.therapist_id = t.id
     WHERE t.business_id = ? AND t.active = 1 AND ts.service_id = ? ORDER BY t.id`,
  ).all(businessId, serviceId).map((r) => r.id);
}

// ---------- inventory (capacity vs. booked) ----------

/** Minutes of working time after removing time off. */
function workingMinutes(windows, timeOff) {
  let total = 0;
  for (const w of windows) {
    // Subtract time off from this window.
    let pieces = [[w.start, w.end]];
    for (const o of timeOff) {
      pieces = pieces.flatMap(([s, e]) => {
        if (!overlaps(s, e, o.start, o.end)) return [[s, e]];
        const out = [];
        if (o.start > s) out.push([s, o.start]);
        if (o.end < e) out.push([o.end, e]);
        return out;
      });
    }
    total += pieces.reduce((n, [s, e]) => n + (e - s), 0);
  }
  return total;
}

/** Per-therapist capacity for one date. bookedMin counts massage time (not cleanup). */
function dayInventory(ctx) {
  const therapists = [];
  for (const [id, d] of ctx.therapists) {
    if (!d.t.active && !d.appts.length) continue;
    const availableMin = workingMinutes(d.windows, d.timeOff);
    const bookedMin = d.appts.reduce((n, a) => n + (a.end - a.start), 0);
    therapists.push({
      therapistId: id,
      availableMin,
      bookedMin,
      freeMin: Math.max(0, availableMin - bookedMin),
      sessions: d.appts.length,
      maxSessions: d.t.max_sessions_per_day || null,
      utilization: availableMin ? Math.min(1, bookedMin / availableMin) : (bookedMin ? 1 : 0),
      working: d.windows.length > 0 && availableMin > 0,
      overridden: d.overridden,
      hasTimeOff: d.timeOff.length > 0,
    });
  }
  return therapists;
}

/** Booked appointments that no longer fit the schedule (hours changed, time off added, therapist deactivated). */
function scheduleIssues(ctx, appt) {
  const day = ctx.therapists.get(appt.therapist_id);
  if (!day) return [];
  const issues = [];
  if (!day.t.active) issues.push('inactive');
  if (!day.windows.some((w) => appt.start_min >= w.start && appt.end_min <= w.end)) issues.push('outside_hours');
  if (day.timeOff.some((o) => overlaps(appt.start_min, appt.end_min, o.start, o.end))) issues.push('time_off');
  return issues;
}

function windowLabel(w) { return `${fmtTime(w.start)}–${fmtTime(w.end)}`; }

module.exports = {
  OCCUPYING, overlaps, loadDay, evaluate, describe, slots, therapistsFor, onlineRule, staffRule,
  dayInventory, workingMinutes, scheduleIssues, stretchWith, allowedRooms, windowLabel,
};
