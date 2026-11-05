# Massage Studio Booking

Online booking for massage studios. Each business gets a public booking page for clients and a dashboard for running the day.

**Zero dependencies.** Node 22.13+ only (uses the built-in `node:sqlite`).

```bash
npm run seed    # optional: demo studio (login demo@serenity.test / demo1234)
npm start       # http://localhost:3000
npm test
```

| URL | What |
|---|---|
| `/` | Sign up / log in |
| `/admin` | Owner dashboard |
| `/b/<slug>` | Public booking page (e.g. `/b/serenity`) |
| `/b/<slug>/manage?ref=…&token=…` | Client views / cancels a booking |

## Features

**Clients**
- Pick service → therapist (or "any available") → date → time → details
- Only shows times that are open; re-checked at booking so two people can't take the same slot
- "Any therapist" bookings go to whoever has the lightest day
- Booking reference + private link to view or cancel (within the cancellation policy)

**Business owner**
- Day schedule with every therapist side by side (closed hours, time off, now-line)
- Add phone/walk-in bookings (can go outside normal hours, still can't double-book)
- Mark completed / no-show / cancelled, private staff notes
- Therapists: bio, services they do, weekly hours, time off (single days or ranges)
- Services: duration, price, cleanup buffer between sessions
- Clients: search, visit history, private notes (pressure, injuries, allergies)
- Settings: booking link, time zone, currency, minimum notice, how far ahead, cancellation cutoff, slot interval
- Several businesses can share one install; each only sees its own data

## Scheduling engine (the hard part)

Therapist time and treatment rooms are the studio's inventory. Every "can this happen?" question goes through `lib/scheduler.js`:

| Rule | Type | What it means |
|---|---|---|
| Therapist free (incl. cleanup buffer) | hard | Never double-booked, not even by staff |
| A free room the service is allowed in | hard | Hot stone only in the Stone Room, etc. Rooms are optional |
| Inside working hours for that date | soft | Weekly shifts (split shifts = breaks) or a date-specific override |
| Not on time off | soft | Full or partial days |
| Under the daily session limit | soft | e.g. max 6 massages a day |
| Not too long without a break | soft | e.g. no more than 3h of near-continuous work without a 30-min break |

Online bookings must pass everything. Staff get a clear warning for soft rules and can **book anyway**; the override is recorded in the booking's history.

Smart assignment: "any therapist" goes to whoever has the most free time left that day; rooms are picked so special rooms stay free for the services that need them.

When schedules change (time off, new hours, therapist deactivated), affected bookings are flagged under **Needs attention** (`GET /api/conflicts`).

## History & reporting

- Every booking keeps an activity log: created (online/staff), moved (from → to, reason), status changes, notes, overrides
- `GET /api/appointments?q=` searches all-time history by client, email, phone or reference
- `GET /api/inventory` — capacity vs booked minutes per therapist per day (+ rooms)
- `GET /api/reports` — revenue, utilization, no-show/cancellation rates, new vs returning clients, top services, busiest days/hours
- Client profiles: visits, spend, favourite therapist/service, typical rebooking interval, one-tap rebook

## How it works

- `lib/scheduler.js` — the engine above
- `lib/app.js` — HTTP routes and JSON API
- `lib/db.js` — SQLite schema + in-place migrations. Dates/times are stored in the business's local time zone
- `public/` — plain HTML/JS pages, no build step
- `test/` — `npm test` covers booking flow, every scheduling rule, rescheduling, conflicts, inventory and reports

Config via env: `PORT`, `DB_FILE` (default `data/booking.db`), `SECURE_COOKIES=1` behind HTTPS.

## Not built yet

- Email/SMS confirmations and reminders (biggest gap — clients currently save their link manually)
- Online payments / deposits (Stripe)
- Staff logins with their own permissions (one owner login per business today)
- Waitlist and recurring bookings
- Web dashboard doesn't yet expose rooms, limits, overrides or reports (the mobile app does)
- Login rate limiting and password reset
