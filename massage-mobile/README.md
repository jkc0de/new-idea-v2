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

| Owner | Client |
|---|---|
| **Today** — greeting, stats, swipeable date strip, therapist filter, agenda with a "now" line and open gaps | **Book** — treatment → therapist (or no preference) → date & time → details |
| **Appointment** — call / text / email the client, check out, no-show, cancel, staff notes | **Confirmation** — animated check, reference, save link, cancel |
| **Bookings** — upcoming / past / cancelled, grouped by day | |
| **Clients** — search, visit count, notes, history, "book again" | |
| **Studio** — share booking link, team (hours & time off), services, settings | |
| **New booking** (+ button) — same flow as clients, with existing-client lookup | |

## Code map

```
src/app/            screens (Expo Router — each file is a route)
  (owner)/          bottom tabs: index (Today), bookings, clients, more (Studio)
  book/[slug].tsx   client booking + confirmation
  new-booking.tsx   staff booking
src/components/
  ui.tsx            design system: Button, Card, Chip, Row, Field, Avatar, Fab…
  booking-flow.tsx  the 4-step booking wizard (shared by both sides)
src/lib/            API client, auth (token in Keychain / Keystore), theme, formatting
```

Light and dark mode both supported. Haptics on taps (iOS/Android).
