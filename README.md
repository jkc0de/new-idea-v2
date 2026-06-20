# Lock In — Discipline App for Men

A no-excuses iOS app built to help men eliminate distractions, protect their time, and lock in on what matters.

---

## What It Does

### 1. Porn Blocker
Uses iOS Screen Time API (Family Controls) to block adult content categories at the OS level. The block cannot be bypassed from within the app — you set it, it stays. Includes a PIN/passcode lock so you can't undo it in a weak moment.

### 2. Gambling Blocker
Same Screen Time / Family Controls enforcement, targeting gambling apps and websites (casino apps, sports betting, online poker sites). Blocked at the OS level. Same anti-override PIN protection.

### 3. Super Alarm Clock
Not your average alarm. Features:
- **Math/puzzle unlock** — you must solve a set of math problems to dismiss the alarm (no half-asleep snooze)
- **Shake-to-wake** — requires physical movement before dismiss is allowed
- **QR/barcode scan unlock** — scan a QR code placed in another room (forces you out of bed)
- Full-volume override — ignores silent mode
- Repeating schedules (weekday, weekend, custom)
- Motivational quote displayed on wake

### 4. Bedtime Phone Lockout
At a set bedtime, the phone enters a restricted mode:
- Blocks all social media and entertainment apps
- Dims screen, silences non-emergency notifications
- Only allows: alarm, phone calls, messages
- Requires the same PIN to override — so you can't cave and scroll at 1am

---

## How the Blocking Works (iOS)

iOS does not allow apps to block content the way Android does. Instead it uses two official Apple frameworks:

| Framework | What it does |
|---|---|
| **Screen Time API** (Family Controls) | Blocks specific apps and website categories at OS level |
| **ManagedSettings** | Applies content restrictions programmatically |
| **DeviceActivity** | Monitors usage and triggers lockouts on a schedule |

These require the **Family Controls entitlement** from Apple — you apply for it during App Store review. This is the same framework parental control apps like OurPact use.

---

## App Structure

```
LockIn/
├── App/
│   └── LockInApp.swift          # Entry point, permissions setup
├── Views/
│   ├── ContentView.swift        # Tab bar root
│   ├── HomeView.swift           # Dashboard / status overview
│   ├── BlockerView.swift        # Porn & gambling blocker controls
│   ├── AlarmView.swift          # Alarm list and creation
│   ├── AlarmEditView.swift      # Alarm configuration (unlock method)
│   ├── AlarmRingView.swift      # Full-screen alarm dismissal challenge
│   ├── BedtimeView.swift        # Bedtime lockout schedule
│   └── SettingsView.swift       # PIN setup, onboarding
├── ViewModels/
│   ├── BlockerViewModel.swift
│   ├── AlarmViewModel.swift
│   └── BedtimeViewModel.swift
├── Models/
│   ├── Alarm.swift
│   ├── BlockerSettings.swift
│   └── BedtimeSettings.swift
└── Services/
    ├── AlarmService.swift       # UNUserNotifications scheduling
    ├── BlockerService.swift     # ManagedSettings + FamilyControls
    └── BedtimeService.swift     # DeviceActivity scheduling
```

---

## Screens

| Screen | Description |
|---|---|
| **Home** | Live status: blockers on/off, next alarm, bedtime in X hours |
| **Blockers** | Toggle porn block, toggle gambling block, set PIN |
| **Alarms** | List of alarms, tap to edit, swipe to delete |
| **Bedtime** | Set bedtime + wake time, choose which apps to restrict |
| **Settings** | Change PIN, reset all, about |

---

## Tech Stack

- **Language:** Swift 5.9+
- **UI:** SwiftUI
- **Notifications:** UserNotifications framework
- **Blocking:** FamilyControls + ManagedSettings + DeviceActivity (Screen Time API)
- **Storage:** UserDefaults + @AppStorage for settings, local JSON for alarms
- **Minimum iOS:** 16.0 (Screen Time API requires iOS 16+)

---

## Entitlements Required

```xml
com.apple.developer.family-controls
```

This entitlement must be requested from Apple at:
https://developer.apple.com/contact/request/family-controls-distribution

Without it, the blocking features are UI-only demos. The alarm clock works without any special entitlements.

---

## What This App Does NOT Do

- No accounts, no cloud sync, no data sent anywhere
- No tracking
- No social features
- No subscription (intended as a one-time purchase or free)

---

## Roadmap / Phases

- [x] Project structure + README
- [ ] Phase 1: Super Alarm Clock (works without special entitlements)
- [ ] Phase 2: Bedtime Lockout (DeviceActivity schedule)
- [ ] Phase 3: Porn + Gambling Blocker (requires Family Controls entitlement)
- [ ] Phase 4: PIN protection + anti-bypass hardening
- [ ] Phase 5: App Store submission
