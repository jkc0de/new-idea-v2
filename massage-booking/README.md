# Restful — Massage Therapist Booking

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

## How it works

- `lib/availability.js` — slot engine: working hours − time off − existing bookings (incl. buffers), with lead time and booking window rules
- `lib/app.js` — HTTP routes and JSON API
- `lib/db.js` — SQLite schema. Dates/times are stored in the business's local time zone
- `public/` — plain HTML/JS pages, no build step

Config via env: `PORT`, `DB_FILE` (default `data/booking.db`), `SECURE_COOKIES=1` behind HTTPS.

## Not built yet

- Email/SMS confirmations and reminders (biggest gap — clients currently save their link manually)
- Online payments / deposits (Stripe)
- Staff logins with their own permissions (one owner login per business today)
- Client self-service rescheduling (they can cancel and rebook)
- Login rate limiting and password reset
