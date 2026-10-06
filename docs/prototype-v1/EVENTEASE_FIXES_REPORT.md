# EventEase — Fixes Report

**Date:** 2026-09-23
**Source of truth:** `EVENTEASE_QA_AUDIT.md` (21 findings)
**Scope:** Approved fixes only. No redesign, no backend, no new dependencies, and the AJAX architecture (`eventService` → `EventsContext` → pages) is unchanged. No routes were added or removed.

**Result:** 19 of the 21 audit findings are fixed. #12 (Profile placeholder links) and #15 (Calendar mobile view) are deferred on purpose, and the #19 lint warning is accepted. Build is clean, lint has 0 errors, **42/42 automated browser checks pass**, and Lighthouse (mobile) now scores **Accessibility 100** (was 84) and **SEO 100** (was 83).

---

## 1. Audit bugs addressed

| # | Sev. | Finding | Status | What changed |
|---|---|---|---|---|
| 1 | 🔴 | Home search did `window.location.href = '/explore'` (full reload) | ✅ Fixed | Hero search is now a `<form role="search">`. Submitting calls `useNavigate()` → `/explore?q=<query>`, and Explore pre-fills its search box from `?q`. No document reload, and `events.json` is not fetched again. |
| 2 | 🔴 | My Events used hardcoded slices of the event list | ✅ Fixed | New `UserEventsContext` holds `registeredEventIds` (with registration ID + timestamp) and `savedEventIds`, persisted in `localStorage`. **Upcoming** = registered and not yet ended; **Past** = registered and ended; **Saved** = saved. Each tab has an empty state with a "Browse events" link. |
| 3 | 🔴 | Feedback page unreachable | ✅ Fixed | Each card in the **Past Events** tab (registered events that have ended) has a **Rate this Event** link to `/feedback/:id`. It isn't shown for upcoming or unregistered events. The FeedbackForm itself is unchanged apart from a11y. |
| 4 | 🟠 | Save Event was local-only | ✅ Fixed | The Save button calls `toggleSaved()` in the shared context. It shows the saved state (`Saved`, filled icon, `aria-pressed`), survives a refresh, and appears in the Saved tab. |
| 5 | 🟠 | Share / Add to Calendar had no handler | ✅ Fixed | **Add to Calendar** downloads an RFC 5545 `.ics` file (title, venue, description, URL). IST times are converted to UTC, and events that run past midnight get the correct end date. **Share** uses the Web Share API where it exists, otherwise copies the link to the clipboard. A small `role="status"` line confirms the result. |
| 6 | 🟠 | Download Pass had no handler | ✅ Fixed | Downloads a self-contained, printable HTML pass: event details plus the registration ID. The pass states it was generated in the browser and **is not an official university-issued ticket**. No PDF library added. |
| 7 | 🟠 | Navbar icon buttons: no name, no focus ring | ✅ Fixed | Hamburger: `aria-label="Toggle menu"`, `aria-expanded`, `aria-controls`. Bell: `aria-label="Notifications"` (or "Notifications (new)"), `aria-expanded`, `aria-controls`. Both get a `focus-visible` indigo ring. "Mark all read" changed from a clickable `<span>` to a real `<button>`. |
| 8 | 🟠 | Contrast failures (2.48 / 3.29 / 3.76) | ✅ Fixed | CTA keeps its teal-500 background; text changed from white to `indigo-950` (hover lightens to teal-400), giving **6.42:1**. Open badge green-600 → green-700 (**5.02:1**). Closed badge red-500 → red-600 (**4.83:1**). The red-500 "Registration Closes In" label on Event Details also moved to red-600. |
| 9 | 🟠 | Phone field not validated | ✅ Fixed | Native `pattern` for Indian mobiles: 10 digits starting 6–9, with optional `+91`/`0` prefix and optional space or hyphen. Also `maxLength=15`, `inputMode="tel"`, `autoComplete="tel"`, and a custom validation message. |
| 10 | 🟠 | Title was `temp-app` | ✅ Fixed | `<title>EventEase — CUTM Event Discovery &amp; Registration</title>` |
| 11 | 🟡 | `Math.random()` fallback ID computed during render | ✅ Fixed | The success page takes the ID from router state, then from the stored registration record (so a reload shows the same ID), and only as a last resort from a `useState(generateRegistrationId)` lazy initializer, which runs once. The `react(purity)` lint warning is gone. |
| 12 | 🟡 | Profile placeholder links | ⏸ Deferred | See §5. |
| 13 | 🟡 | No `aria-live` for async states | ✅ Fixed | `role="status"` "Loading events…" in the skeleton grid (the skeletons themselves are `aria-hidden`), "Loading event details…" on Event Details, and "Loading notifications…". `aria-live="polite"` on `ErrorState` and the notifications error. `role="alert"` on the registration submit error. |
| 14 | 🟡 | Star buttons unlabeled | ✅ Fixed | `aria-label="Rate N star(s)"` and `aria-pressed` on each star. The stars sit in a `role="group"` labelled "Overall Rating", and have a visible focus ring. |
| 15 | 🟡 | Calendar mobile risk | ⏸ Deferred | See §5. No horizontal overflow at any tested width. |
| 16 | 🟡 | No meta description / robots.txt | ✅ Fixed | `<meta name="description">` added; `public/robots.txt` (`User-agent: *` / `Allow: /`). |
| 17 | 🟡 | Declaration wasn't a checkbox | ✅ Fixed | Now a required `<input type="checkbox" id="agree">` with an associated label. Submission is blocked until it's ticked. |
| 18 | 🔵 | `as any` on the date-filter select | ✅ Fixed | `type DateFilter = 'all' \| 'upcoming' \| 'past'`, cast via `as DateFilter`. No `as any` is left in `src/`. |
| 19 | 🔵 | Fast Refresh warning (context + hook in one file) | ➖ Accepted | Left as is, as instructed (harmless). The new `UserEventsContext.tsx` follows the same pattern as the existing `EventsContext.tsx`. |
| 20 | 🔵 | Notification items looked clickable | ✅ Fixed | Removed `cursor-pointer` and the hover background from non-interactive items. |
| 21 | 🔵 | `package.json` name `temp-app` | ✅ Fixed | Renamed to `eventease` in `package.json` and both entries in `package-lock.json`. |

Small related fixes in the same spirit (accessibility only, no visual change): `aria-label`s on the Explore search box and its two filter selects, and the FeedbackForm textarea label linked with `htmlFor`/`id`.

---

## 2. Files changed

**New**
- `src/context/UserEventsContext.tsx` — registered/saved state, persisted in localStorage, with try/catch fallback when storage is unavailable
- `src/utils/eventActions.ts` — time parsing, `isEventPast`, `.ics` builder, Web Share/clipboard share, HTML pass builder, file download helper, `generateRegistrationId`
- `public/robots.txt`
- `fixes-lighthouse.json` — this round's Lighthouse report

**Modified**
- `src/App.tsx` — wraps routes in `UserEventsProvider`
- `src/pages/Home.tsx` — SPA search form, CTA contrast
- `src/pages/ExploreEvents.tsx` — reads `?q`, typed `DateFilter`, control labels
- `src/pages/EventDetails.tsx` — shared Save, Share, Add to Calendar, status message, loading status, red-600
- `src/pages/Register.tsx` — records the registration, phone validation, required checkbox, `role="alert"` on error
- `src/pages/RegistrationSuccess.tsx` — stable registration ID, Download Pass
- `src/pages/MyEvents.tsx` — real registered/saved derivation, Rate this Event, empty states
- `src/pages/FeedbackForm.tsx` — star labels, rating group, textarea label
- `src/components/Navbar.tsx` — accessible names, focus rings, aria-expanded/controls, Mark-all-read button, item cursor
- `src/components/EventCard.tsx` — optional `action` prop, badge contrast
- `src/components/EventCardSkeleton.tsx` — loading live region
- `src/components/ErrorState.tsx` — `aria-live="polite"`
- `index.html` — title, meta description
- `package.json`, `package-lock.json` — name

---

## 3. Implementation approach

- **State:** a second, small context sits next to `EventsContext` rather than inside it. `EventsContext` still owns fetched event data; `UserEventsContext` stores only event IDs, so the AJAX layer is untouched. `localStorage` (key `eventease:user-events`) was chosen over `sessionStorage` so the demo state survives a closed tab. If storage throws, the app falls back to in-memory state.
- **Past vs upcoming:** based on when the event *ends*, parsed from its `time` string (e.g. `09:00 AM - 05:00 PM`; overnight events like the Hackathon roll over to the next day). This is more reliable than the `status` field, which says `upcoming` for every event in `events.json`.
- **Downloads:** Blob + temporary `<a download>`. No dependencies. The pass is HTML rather than PDF so no PDF library is needed. It prints cleanly and can be saved as a PDF from the browser.
- **Validation:** native constraint validation (`pattern`, `required`, `maxLength`) plus `setCustomValidity` for a clearer message, so no custom form library.
- **Contrast:** colors were computed before editing. The CTA keeps its teal background (brand identity) and switches to dark text rather than a darker teal, so the button still looks the same on the indigo hero.

---

## 4. Verification performed

### Build & lint
- `npm run build` — ✅ `tsc -b` clean, Vite build OK (JS 295.9 kB / 90.0 kB gzip, previously 285.4 kB).
- `npm run lint` — ✅ **0 errors, 4 warnings**. The `react(purity)` warning is gone. The remaining warnings are the pre-existing `EventsContext` Fast Refresh warning and two `set-state-in-effect` warnings, plus one new Fast Refresh warning for `UserEventsContext`. All were left alone per the instructions.
- `grep window.location src/` — the only hit is `window.location.origin`, read to build the share/calendar URL. No internal navigation uses `window.location.href`.

### Automated browser tests — 42/42 passed
Run with puppeteer-core and Chrome 153 (headless) against `vite preview` (production build, port 4174):

| Area | Checks |
|---|---|
| Branding/SEO | Tab title is exactly "EventEase — CUTM Event Discovery & Registration"; meta description present; `/robots.txt` served |
| SPA navigation | Home search → `/explore?q=hack`: no new document request, a JS marker on `window` survives, **0 extra `events.json` requests**, Explore shows only "Hackathon Bhubaneswar". The Explore Events CTA also keeps the marker. |
| Save | Button goes `aria-pressed=false/"Save Event"` → `true/"Saved"`; toggling off works; stored in localStorage; the Saved tab lists exactly the saved event |
| Empty states | Fresh state: Upcoming and Past both show empty states (hardcoded slices confirmed gone) |
| Phone | Accepted: `9876543210`, `+91 98765 43210`, `+91-9876543210`, `09876543210`. Rejected: `1234567890`, `98765abcde`, `987654321`, `98765432101`, `abcdefghij`. `maxLength=15`. Invalid input blocks submit with the custom message. |
| Declaration | `type=checkbox`, `required`; unticked blocks submit |
| Registration | Success page shows `CUTM-######`; event appears in Upcoming Registrations and **stays after a page refresh**; success-page reload shows the **same** ID; no Feedback link on upcoming events |
| Download Pass | `eventease-pass-cutm-techfest-2026-cutm-XXXXXX.html` downloaded, containing the event title, the same registration ID and the "not an official" disclaimer |
| Feedback | A registered past event appears under Past (not Upcoming) with "Rate this Event". Clicking it opens `/feedback/e2` without a reload. 5 stars labelled "Rate 1 star" … "Rate 5 stars"; group labelled "Overall Rating"; textarea `label.control` resolves; submit still shows the thank-you screen. |
| .ics | Hackathon (10:00 AM → 10:00 AM next day): `DTSTART:20261005T043000Z`, `DTEND:20261006T043000Z`. TechFest 09:00–17:00 IST → `033000Z`–`113000Z`. Correct `VCALENDAR`/`VEVENT` structure, CRLF line endings, UID, SUMMARY, LOCATION. |
| Share | With Web Share available: `navigator.share` called with title/text/url. Without it: the event URL is on the clipboard and the "Event link copied to clipboard." status appears. |
| Keyboard/a11y | Tabbing to the bell and the hamburger (375px) shows a visible 2px indigo focus ring (`box-shadow` checked); accessible names "Notifications (new)" and "Toggle menu"; `aria-expanded` toggles; "Mark all read" is a `<button>`; notification items no longer use `cursor: pointer` |
| Contrast (computed in page) | CTA **6.42:1** (was 2.48) · Open **5.02:1** (was 3.29) · Closed **4.83:1** (was 3.76) |
| Responsive | 375 / 430 / 768 / 1280 / 1440px × 9 routes (`/`, `/explore`, `/event/e1`, `/register/e1`, `/register-success/e1`, `/my-events`, `/calendar`, `/feedback/e2`, `/profile`): **no horizontal overflow** anywhere. Full-page screenshots of Home, Event Details, Register, Success and My Events were reviewed at each width; layouts match the pre-fix design. |

**How the Past/Feedback check was set up:** e2 (AI & ML Workshop, 12 Sep 2026) is the only event that has already happened, and its registration closed on 10 Sep, so nobody can register for it through the UI today. The test therefore wrote a registration record for e2 into localStorage, in exactly the format the app writes, to simulate a student who registered before the deadline. Every other flow was driven through the real UI.

### Lighthouse (mobile, simulated throttling, same settings as the audit's `after-lighthouse.json`)

| Category | Before fixes | After fixes |
|---|---|---|
| Performance | 81 | 80 |
| Accessibility | 84 | **100** |
| Best Practices | 100 | 100 |
| SEO | 83 | **100** |

`button-name`, `color-contrast`, `meta-description` and `robots-txt` went from failing to passing. The 1-point Performance change is run-to-run noise from simulated throttling: LCP improved 4.7 s → 3.9 s and TBT 20 ms → 0 ms, while FCP and Speed Index went up. No images, fonts or loading strategy changed; the bundle grew ~10 kB. (This Lighthouse version also reports a new experimental "agentic-browsing" category, which was not part of the audit.)

---

## 5. Deliberately deferred

1. **Bug #12 — Profile sidebar links / Edit Profile.** Wiring them would mean building settings sections or a sign-out flow, which is outside this fix list and would edge toward an auth system. Still pre-existing.
2. **Bug #15 — Calendar mobile agenda view.** A list view would be a new feature. The 7-column grid doesn't overflow at 375px, but day cells stay cramped.
3. **Bug #19 — Fast Refresh lint warning.** Harmless; left as instructed.
4. **Past-event demo data.** With today's data, no finished event can be registered for through the UI (e2's deadline passed before the event). In a live demo the Past tab stays empty until a registered event ends, e.g. TechFest after 15 Oct. To show the feedback journey now, either add a past event with an open-until-event deadline to `events.json`, or pre-seed a demo registration. Neither was done, to avoid hardcoded data.
5. **Already-registered state on Event Details.** Event Details still shows "Register Now" for an event the student already registered for. Not in the audit, so not changed.
6. **`events.json` status field.** Every event has `status: "upcoming"`, including e2, which already happened, so Home's "Upcoming Events" still lists it. This is a data issue outside the audit list; My Events now uses the actual date instead.
7. **Pass format.** Printable HTML rather than a true PDF or QR code, to avoid new dependencies. The QR shown on screen is still a decorative icon, as before.
