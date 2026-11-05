'use strict';
/**
 * Staff notifications: an in-app inbox plus push to the studio's phones via Expo's push service.
 * Pushes are fire-and-forget; a failure never breaks the booking that caused it.
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const DEFAULT_PREFS = {
  newBooking: true,    // a client booked online
  cancelled: true,     // a client cancelled online
  rescheduled: true,   // a client moved their booking
  digest: true,        // morning summary of the day
  digestHour: 8,       // local hour for the summary
};

// Which preference controls each notification type. Types not listed always push.
const PREF_FOR_TYPE = { new_booking: 'newBooking', cancelled: 'cancelled', rescheduled: 'rescheduled', digest: 'digest' };

function readPrefs(business) {
  let saved = {};
  try { saved = JSON.parse(business.notify_prefs || '{}'); } catch { /* bad JSON → defaults */ }
  return { ...DEFAULT_PREFS, ...saved };
}

function cleanPrefs(input, current) {
  const out = { ...current };
  for (const k of ['newBooking', 'cancelled', 'rescheduled', 'digest']) if (typeof input[k] === 'boolean') out[k] = input[k];
  if (input.digestHour !== undefined) {
    const h = Number(input.digestHour);
    if (Number.isInteger(h) && h >= 0 && h <= 23) out.digestHour = h;
  }
  return out;
}

/** Sends messages through Expo's push API. Returns per-message tickets. */
async function expoSender(messages) {
  const tickets = [];
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(chunk),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Expo push failed (${res.status})`);
    tickets.push(...(json.data || []));
  }
  return tickets;
}

const isExpoToken = (t) => typeof t === 'string' && /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(t);

function createNotifier(db, { sender = expoSender, log = console } = {}) {
  /** Record an alert in the inbox and push it to the studio's phones if their settings allow. */
  async function notify(businessId, type, { title, body, data = {} }) {
    const business = db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId);
    if (!business) return { sent: 0 };
    const id = Number(db.prepare('INSERT INTO notifications (business_id, type, title, body, data) VALUES (?, ?, ?, ?, ?)')
      .run(businessId, type, title, body, JSON.stringify(data)).lastInsertRowid);

    const prefKey = PREF_FOR_TYPE[type];
    if (prefKey && !readPrefs(business)[prefKey]) return { id, sent: 0 };

    const devices = db.prepare('SELECT token FROM push_devices WHERE business_id = ?').all(businessId);
    if (!devices.length) return { id, sent: 0 };
    const unread = db.prepare('SELECT COUNT(*) n FROM notifications WHERE business_id = ? AND read_at IS NULL').get(businessId).n;
    const messages = devices.map((d) => ({
      to: d.token, title, body, sound: 'default', badge: unread, channelId: 'bookings',
      data: { ...data, notificationId: id },
    }));
    try {
      const tickets = await sender(messages);
      // Drop phones that uninstalled the app or revoked permission.
      tickets.forEach((t, i) => {
        if (t && t.status === 'error' && t.details && t.details.error === 'DeviceNotRegistered') {
          db.prepare('DELETE FROM push_devices WHERE token = ?').run(messages[i].to);
        }
      });
      return { id, sent: messages.length, tickets };
    } catch (err) {
      log.error?.('Push failed:', err.message);
      return { id, sent: 0, error: err.message };
    }
  }

  return { notify, readPrefs, cleanPrefs, isExpoToken };
}

module.exports = { createNotifier, expoSender, readPrefs, cleanPrefs, isExpoToken, DEFAULT_PREFS };
