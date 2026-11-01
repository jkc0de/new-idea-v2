# Restful — Mobile App (Expo / React Native)

Phone app for the massage booking system. One app, two sides:

- **Studio owners** — Today agenda, bookings, clients, team, services, settings
- **Clients** — book a massage in 4 taps, then view or cancel

It talks to the booking server in `../massage-booking`.

## Run it

```bash
# 1. Start the server (from the repo root)
cd massage-booking && npm run seed && npm start      # http://localhost:3000

# 2. Start the app
cd massage-mobile && npm install && npx expo start
```

Then press `i` (iOS simulator), `a` (Android emulator), `w` (browser), or scan the QR code with **Expo Go**.

**On a real phone**, `localhost` means the phone itself. Either start with
`EXPO_PUBLIC_API_URL=http://<your-computer-ip>:3000 npx expo start`, or tap
**Server settings** on the welcome screen and enter that address.

Demo login: `demo@serenity.test` / `demo1234` · Demo studio code: `serenity`

## Screens

**Running the day**
- **Today** — agenda or **timeline** (one lane per therapist: shifts, breaks, time off, bookings, now-line). Tap free time to book it. Each therapist's capacity for the day (free hours, sessions vs limit). Red **Needs attention** banner when bookings no longer fit the schedule.
- **Schedule** — the week's inventory: therapists × days, free hours and sessions per cell, full / off / time-off / custom-hours states, team and room totals. Tap a cell to open that day.
- **Appointment** — call / text / email, check out, no-show, cancel, **move or reassign**, staff notes, room, and a full **activity log**.
- **Move booking** — pick therapist (or any), date and open time; confirm with a reason. Rule warnings let you move anyway; double-booking is never allowed.
- **New booking** (+ or tap the timeline) — same flow clients use, with existing-client lookup, custom times for walk-ins and a "book anyway" warning for rule breaks.

**Setting up the inventory** (Studio tab)
- **Team** — split shifts (breaks), daily session limit, max continuous work before a break, custom hours for specific dates, time off. Any change that breaks existing bookings is flagged.
- **Rooms** — rooms are inventory too; services can be limited to rooms (hot stone → Stone Room).
- **Services**, **Business settings**.

**Looking back**
- **Insights** — revenue, utilization, no-shows, cancellations, new vs returning, therapist utilization, top services, busiest days and hours (7/30/90 days).
- **Booking history** — search every booking ever by client, phone, email or reference.
- **Clients** — regular / lapsed badges; profile with visits, spend, favourite therapist and treatment, rebooking rhythm, one-tap **Book again**.

**Clients**
- Book in 4 steps; confirmation lets them **change time** or cancel within the studio's policy.

## Code map

```
src/app/            screens (Expo Router — each file is a route)
  (owner)/          bottom tabs: index (Today), bookings, clients, more (Studio)
  book/[slug].tsx   client booking + confirmation
  new-booking.tsx   staff booking
src/components/
  ui.tsx            design system: Button, Card, Chip, Row, Field, Avatar, Fab…
  booking-flow.tsx  the 4-step booking wizard (shared by both sides)
  bk-*              slot picker, activity log
  sched-*           day timeline, capacity bars
  cfg-*             steppers/shift editors, charts
src/lib/            API client, auth (token in Keychain / Keystore), theme, formatting
```

Light and dark mode both supported. Haptics on taps (iOS/Android).
