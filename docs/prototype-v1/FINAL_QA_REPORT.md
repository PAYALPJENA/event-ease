# EventEase — Final QA Report (consistency + demo-readiness pass)

**Date:** 2026-09-23
**Scope:** Only the three items below. No redesign, no new student-facing features, no backend, no new dependencies, no schema changes.

## Changes

### 1. Event status consistency
- `public/data/events.json`: **e2 — AI & Machine Learning Workshop** (held 12 Sep 2026) changed from `"upcoming"` to `"completed"`. This is the only event whose date has passed; the other four remain `"upcoming"`. No fields were added or removed.
- `src/services/eventService.ts` (`getUpcomingEvents`, used by Home): now requires `status === 'upcoming'` **and** that the event hasn't ended, using the existing `isEventPast` helper.
- `src/pages/ExploreEvents.tsx`: "Upcoming Only" previously counted an event as upcoming if its status said `upcoming` *or* its date was in the future. It now requires both a non-`completed` status and an end time that hasn't passed.

With both date checks, an event whose status goes stale during the demo can't show as upcoming either (e.g. Basketball Championship after 25 Sep).

### 2. Already-registered events
- `src/pages/EventDetails.tsx`: when `UserEventsContext.isRegistered(id)` is true, **Register Now** is replaced by a green **Already Registered** status plus a **View My Event** link to `/my-events`. Countdown, seats, Save, Share and Add to Calendar are unchanged.
- `src/pages/Register.tsx`: if the student is already registered, `/register/:id` shows a "You're already registered" notice with **View My Events** and **Back to Event Details** instead of the form. This covers a direct URL or the browser Back button. `handleSubmit` also returns early for an already-registered event. The form stays mounted while a submission is in flight, so the normal success redirect isn't interrupted.

### 3. Demo/test-only past registration
- **New `src/demo/seedPastRegistration.ts`** (marked *DEMO / TEST ONLY*): seeds one registration for e2 with ID **`CUTM-DEMO01`**. The non-numeric ID makes it easy to tell apart from real IDs. It only adds the record if e2 isn't already registered, and it leaves other saved state alone.
- **`src/main.tsx`**: calls the seed only when `import.meta.env.MODE === 'demo'`. Vite replaces this with a constant at build time, so **normal dev and production builds contain no demo code** (verified: `CUTM-DEMO01` is not in `dist/assets/*.js`).
- **New `src/services/userEventsStorage.ts`**: the storage key, types and load/save helpers moved out of `UserEventsContext.tsx`. The real context and the demo seed now use the same code, so the seeded record has exactly the real structure. Context behaviour is unchanged.
- **`package.json` scripts:**
  - `npm run dev:demo`: dev server in demo mode.
  - `npm run demo`: builds to `dist-demo/` and previews it.
  - `dist-demo` is added to `.gitignore`.
- `events.json` is **not** used to fake history (the only data change is the status correction in §1), and there is no demo UI.

## Verification

| Check | Result |
|---|---|
| `npm run build` | ✅ `tsc -b` clean; Vite build OK (JS 297.3 kB / 90.1 kB gzip) |
| `npm run lint` | ✅ 0 errors, the same 4 accepted warnings as the previous report (no new ones) |
| Previous 42 browser checks (production preview) | ✅ **42/42**. One test step was given an explicit wait for the Feedback stars to render (a timing race in the test, not an app change). |
| New final-pass checks (normal + demo builds) | ✅ **20/20** |

The 20 new checks, run with puppeteer-core and headless Chrome against `vite preview`:
- **Completed events aren't shown as upcoming:**
  - e2 is `completed` in the data.
  - Home "Upcoming Events" = Basketball, Hackathon, TechFest, Cultural Night (no workshop).
  - Explore "Upcoming Only" excludes the workshop; "Past Events" lists only it.
- **Event Details state changes on registration:**
  - Before registering: Register Now is shown and there's no registered state.
  - After registering through the real form: "Already Registered" and "View My Event" appear, the `/register/e1` link is gone, and Save/Share/Add to Calendar are still there.
  - View My Event opens My Events, which lists the registration.
- **Duplicate registration is prevented:**
  - `/register/e1` shows the notice and no form, and the stored registration ID is unchanged.
  - Pressing Back from the success page shows the notice, not a fresh form.
- **My Events still works:** registration and upcoming listing work, and all 42 original checks pass (Saved tab, Past/Feedback, persistence).
- **Demo past registration opens Feedback:**
  - The demo build seeds `{"registrations":{"e2":{"registrationId":"CUTM-DEMO01","registeredAt":"…"}},"savedEventIds":[]}`, the same shape the app writes.
  - The Upcoming tab is unaffected.
  - Past Events lists the workshop with "Rate this Event", which opens `/feedback/e2`, and feedback submits.
  - The seed runs only once and keeps other state across reloads.
- **Normal mode stays clean:**
  - A fresh visitor on the normal build gets empty storage (`{"registrations":{},"savedEventIds":[]}`) and an empty Past tab.
  - The production bundle contains no demo code.
- **No horizontal overflow:** at 375 / 430 / 768 / 1280 / 1440px on `/`, `/explore`, `/event/e1` (registered state), `/register/e1` (duplicate notice), `/my-events` and `/feedback/e2`, on both builds. Screenshots of the new states were reviewed.

## How to run the demo journey
```
npm run demo        # or: npm run dev:demo
```
Open **My Events → Past Events → Rate this Event**. To reset, clear the site's localStorage. The normal `npm run dev` / `npm run build` never seeds anything.

## Files changed in this pass
`public/data/events.json`, `src/services/eventService.ts`, `src/pages/ExploreEvents.tsx`, `src/pages/EventDetails.tsx`, `src/pages/Register.tsx`, `src/context/UserEventsContext.tsx`, `src/main.tsx`, `package.json`, `.gitignore`. New: `src/services/userEventsStorage.ts`, `src/demo/seedPastRegistration.ts`.
