# EventEase — QA + UX Alignment Audit

**Scope:** Read-only audit. No application code was modified while producing this report.
**Date:** 2026-09-23
**Build tested:** production build (`npm run build` + `vite preview`), plus static code review.
**Artifacts reviewed:** `research.docx`, `wireframes.pdf` (7 pages), `userpersona.png`, `userflow.png`, `journeymap.png`, `AJAX_IMPLEMENTATION.md`, full `src/` tree, `package.json`, `tailwind.config.js`, `index.html`, `before-lighthouse.json`.
**Artifact requested but not found:** `implementation_plan.md` — no such file exists anywhere in the repository (confirmed via recursive search). It is not included in this audit.

### How this audit was performed (method & limitations)

This environment has no browser-automation tool (no Playwright/Puppeteer/DevTools access), so the following were done differently than a manual QA pass would:
- **Code-level tracing** substitutes for "click through in a browser": every journey step, button, and link was verified by reading the actual component code and route table, not by operating a live UI.
- **`npm run build`, `npm run lint`**, and a **real Lighthouse run** (via `npx lighthouse` against a `vite preview` server, Chrome headless) were executed and their output is quoted directly below — these are real, not simulated, results.
- **Responsive behavior** was assessed by reading Tailwind breakpoint classes and grid structures for each page, not by resizing a live viewport. This is noted explicitly in that section.
- **Color contrast** numbers are not estimates — they come from the real Lighthouse `color-contrast` audit, which computes actual foreground/background ratios.
- **"No console errors"** could not be observed directly (no live console); this is inferred from a clean TypeScript build, clean lint (0 errors), and manual tracing of every code path for unguarded null access, which is a weaker guarantee than an actual browser session.

Where this matters for a finding, it's called out again inline.

---

## 1. Executive Summary

The AJAX/data-layer work from the previous task is solid: the build is clean, lint has zero errors, the event data flow (`fetch → context → cache → UI`) is architecturally correct, and loading/error states exist everywhere they should. That part of the brief is in good shape.

This audit's job, however, was to check the **whole app** against the UX research, persona, journey map, and wireframes — and against that bar, EventEase is a faithful implementation of the **MVP core flow** (Discover → View Details → Register → Confirmation → My Events, per `userflow.png`'s own "MVP CORE FLOW" callout) but has three real breaks in that same flow, plus a set of accessibility and non-functional-button issues that predate the AJAX work and were not introduced by it.

**Headline findings:**
- The Home page's search box still does a full `window.location.href` redirect — a real full-page reload, on the app's most-used entry point, contradicting the AJAX requirement.
- "My Events" never actually reflects what a user registered for or saved — it's a hardcoded slice of the master event list. Registering for an event does not make it appear there.
- The Feedback page exists and works, but nothing in the UI links to it — it's only reachable by typing the URL, so the journey map's "Give Feedback" step is currently a dead end.
- Lighthouse (fresh run) measured concrete WCAG-AA color-contrast failures on the primary CTA button and on the "Open"/"Closed" status badge shown on every event card, plus a completely unlabeled icon-only button.

None of this requires a redesign — the visual language, routes, and page inventory already match the approved wireframes' *intent* (a simpler MVP subset of them, which is expected and appropriate). The issues below are about wiring, not layout.

---

## 2. UX Research Alignment

Extracted from `research.docx` ("EventEase — Research Insights to Design Requirements", based on 20 CUTM student survey responses):

| # | Research Finding | Design Requirement | Status |
|---|---|---|---|
| 1 | Events discovered through scattered channels (WhatsApp, posters, social) | Centralized Event Discovery Dashboard | ✅ Home page aggregates all events |
| 2 | 65% missed an event because they didn't know in time | Upcoming Events + Calendar + Reminder System | 🟡 Upcoming Events list ✅ and Calendar ✅ exist; there is no real reminder system — the notification bell shows two static, hardcoded messages unrelated to actual event deadlines |
| 3 | 65% search old messages for event info | Searchable Event Directory | ✅ Explore Events: live search + category + date filters |
| 4 | Finding complete info = biggest difficulty (25%) | Structured Event Details Page | ✅ `EventDetails.tsx` shows date/time/venue/eligibility/requirements/organizer/contact |
| 5 | Deadlines hardest info to find (35%) | Prominent Deadline Display + Deadline Alerts | 🟡 Countdown timer on Event Details is prominent ✅; "Deadline Alerts" (proactive notification when a deadline nears) does not exist — notifications are static mock content, not computed from real deadlines |
| 6 | 45% found tracking registered events difficult | My Events Dashboard | 🔴 Page exists but is **not wired to actual registrations** — see Bug #1 in §12. This is the single biggest gap against this research finding, since the finding is specifically about *tracking what you registered for* |
| 7 | Complete Event Details most requested (50%) | Full detail set on Event Details page | ✅ present |
| 8 | Event Calendar (40%) + Reminders (40%) requested | Interactive Calendar + Reminder Notifications | 🟡 Calendar ✅ (month view only); Reminder Notifications not implemented beyond the static mock dropdown |
| 9 | 55% would use a centralized platform | Simple, centralized platform | ✅ achieved at the level of page inventory and routing |
| 10 | Some students had no major complaints | Don't over-complicate the UX | ✅ UI stays simple/lightweight; no scope creep observed |

**Persona alignment (`userpersona.png` — Aarav Kumar):** His stated needs map almost 1:1 to the route list (centralized list ✅, search/filter ✅, complete details ✅, visible deadlines ✅, easy registration ✅, registration confirmation ✅, "My Events" section 🔴 not truly functional, event reminders 🔴 not implemented, calendar support ✅).

**Journey map alignment (`journeymap.png`):** The "Future Journey (With EventEase)" row promises: Discover → View Details → Register → Get Confirmation → **check all registered events in My Events "anytime"** → get reminded and attend. Every stage up to "Get Confirmation" holds up. The "My Events" stage does not hold up as designed, because what's shown there isn't derived from what was actually registered.

---

## 3. Feature Completion Matrix

| Feature | Research/Flow source | Status |
|---|---|---|
| Centralized event discovery (Home) | Req #1 | ✅ Fully implemented |
| Search & category/date filters (Explore) | Req #3 | ✅ Fully implemented |
| Structured Event Details page | Req #4, #7 | ✅ Fully implemented |
| Prominent registration deadline countdown | Req #5 | ✅ Fully implemented |
| Registration form → confirmation | User Flow steps 4–6 | ✅ Fully implemented (mocked backend, as intended) |
| My Events reflecting actual registrations | Req #6, Journey step 7 | 🔴 Missing (shows fixed demo slice, not real state) |
| Saved events reflecting actual "Save" actions | Persona need | 🔴 Missing (same root cause) |
| Event Calendar (month view) | Req #8 | ✅ Fully implemented (month view only) |
| Calendar week/list views, filters, mini-calendar | Wireframe p.2 | ⚪ Intentionally deferred (beyond MVP core flow) |
| Deadline/event reminder notifications | Req #2, #5, #8 | 🔴 Missing (bell menu is static demo content, not computed) |
| Feedback form | Journey step 10 | 🟡 Partially implemented — page works but is unreachable from any UI element |
| Multi-step guided registration wizard | Wireframe p.5 | ⚪ Intentionally deferred — current single-step form satisfies "Simple guided registration" persona need without the full 4-step wizard |
| Persistent left sidebar navigation | Wireframes (all pages) | ⚪ Intentionally deferred — current top navbar covers the same routes |
| Rich multi-column footer (Quick Links/Support/Download App) | Wireframes (all pages) | ⚪ Intentionally deferred — current minimal footer is a deliberate MVP simplification |
| "Add to Calendar" / "Share" / "Download Pass" actions | Wireframe pp. 4,6 | 🔴 Missing — buttons render but have no click handler at all |
| Organizers directory / About Us pages | Wireframes nav | ⚪ Intentionally deferred — not in MVP core flow or research requirements |
| Async event data via fetch + shared cache | This project's AJAX task | ✅ Fully implemented |
| Loading skeletons for async data | This project's AJAX task | ✅ Fully implemented |
| Error state + retry for failed fetch | This project's AJAX task | ✅ Fully implemented |
| On-demand notification fetch | This project's AJAX task | ✅ Fully implemented (data is real-fetched; content itself is still static demo data, which was explicitly scoped as "lightweight") |
| Registration as async service (mocked) | This project's AJAX task | ✅ Fully implemented |
| No full-page reloads during navigation | This project's AJAX task | 🔴 Violated in one place — see Bug #1 |

---

## 4. User Journey Test

Traced by reading route definitions (`App.tsx`) and each page's code — not by operating a live browser.

| Step | Loads | Nav works | Data loads | Loading state | Error state | Buttons work | Back nav | Broken links | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Home | ✅ | ✅ | ✅ (context) | ✅ skeleton | ✅ ErrorState | 🔴 search box reloads page | n/a | — | See Bug #1 |
| Explore Events | ✅ | ✅ | ✅ | ✅ skeleton | ✅ ErrorState | ✅ | ✅ | — | Search/filter client-side, confirmed no extra fetch |
| Search | ✅ | n/a | ✅ (in-memory filter) | n/a | n/a | ✅ | n/a | — | Pure client-side `useMemo`, no network call per keystroke |
| Filter (category/date) | ✅ | n/a | ✅ | n/a | n/a | ✅ | n/a | — | Same as above |
| Event Details | ✅ | ✅ | ✅ | ✅ skeleton | ✅ ErrorState | 🔴 Share/Add to Calendar no-op; 🟡 Save not persisted | ✅ (`navigate(-1)`) | — | See Bugs #4, #5 |
| Registration | ✅ | ✅ | n/a (uses cached event) | ✅ spinner in button | ✅ inline error text on failure | ✅ | ✅ | — | Validation gap, see Bug #9 |
| Registration Confirmation | ✅ | ✅ | n/a | n/a | n/a | 🔴 Download Pass no-op | ✅ links | — | See Bug #6 |
| My Events | ✅ | ✅ | ✅ | ✅ skeleton | ✅ ErrorState | ✅ (tabs) | n/a | — | 🔴 Content is not tied to actual registrations — see Bug #2 |
| Calendar | ✅ | ✅ | ✅ | ✅ skeleton | ✅ ErrorState | ✅ (month nav) | n/a | — | Fixed to Sept 2026 starting month by design (demo data) |
| Notifications | ✅ (dropdown) | n/a | ✅ (fetched on first open) | ✅ "Loading notifications..." | ✅ text + retry | 🟡 items not clickable (no action expected) | n/a | — | Confirmed on-demand fetch, not on page load |
| Feedback | ✅ (if URL typed) | 🔴 unreachable from UI | ✅ | n/a (no loading needed, uses cached event) | n/a | ✅ | ✅ | 🔴 **no link anywhere points here** | See Bug #3 |

"No console errors" and "no unnecessary reloads" were checked by static tracing (clean TS build, clean lint, single `window.location` usage found — see Bug #1); a live DevTools console session was not available in this environment.

---

## 5. AJAX/Data Layer Test

| Check | Result | Evidence |
|---|---|---|
| `events.json` fetched asynchronously via `fetch()` | ✅ | `src/services/eventService.ts` — `fetch(EVENTS_URL)`; confirmed served at `/data/events.json` via `curl` against both `vite dev` and `vite preview` (HTTP 200 both times) |
| `EventsContext` shares data across pages | ✅ | Single `EventsProvider` mounted once in `App.tsx`, wrapping `<Routes>`; every page reads via `useEvents()` |
| Duplicate requests avoided | ✅ | Verified by code trace: `eventService.ts` keeps a module-level `cachedEvents` + `inFlightRequest`. Under React 19 StrictMode's dev-only double-invoke of effects, the second invocation hits the already-set `inFlightRequest` and reuses it rather than firing a second `fetch()`. In production (no StrictMode double-invoke) there is exactly one call per session unless `refetch()` is triggered. |
| Notifications fetched on demand | ✅ | `Navbar.tsx` only calls `fetchNotifications()` inside a `useEffect` gated on `showNotifications && !hasLoadedOnce` — confirmed it does not fire on initial page/app load |
| Loading states appear correctly | ✅ | Skeletons on Home/Explore/My Events (`EventCardSkeletonGrid`), inline skeletons on Event Details/Calendar, "Loading notifications..." text in the dropdown |
| Error states appear correctly | ✅ | `ErrorState` component wired into Home, Explore, Event Details, Calendar, My Events; Navbar has its own inline error+retry text |
| Retry works | ✅ (by code trace) | `refetch()` sets `reloadToken`, which re-runs the fetch effect with `force: true`, clearing the module cache first so a genuinely new request is made |
| No full page reload during normal navigation | 🔴 **Fails in one place** | `src/pages/Home.tsx:42` — clicking the hero search input runs `window.location.href = '/explore'`. This is a real full navigation (verified by reading the code — this API is not intercepted by React Router), not an SPA route change, and it will discard/re-fetch the entire in-memory `EventsContext` state on the next page load. This directly contradicts the AJAX task's explicit "no full-page reloads" requirement, and it's the single easiest thing to demo/find. |
| Search/filter operate on fetched data without reload | ✅ | Confirmed in Explore Events code — filtering runs against `events` from context via `useMemo`, no navigation involved |

**Recommendation (not applied — audit only):** replace the `window.location.href` assignment with either `useNavigate()` or wrap the input in a `<Link>`-driven pattern consistent with the rest of the app.

---

## 6. Registration Flow Test

Traced `Register.tsx`, `registrationService.ts`, `RegistrationSuccess.tsx`.

| Scenario | Result |
|---|---|
| Empty required fields (name, roll no., email, phone) | ✅ Blocked — all four have `required`; native browser validation prevents submit |
| Invalid email (e.g. `abc`) | ✅ Blocked — `type="email"` triggers native format validation |
| Invalid phone (e.g. letters, 3 digits) | 🔴 **Not blocked** — the field is `type="tel"`, which (unlike `type="email"`) does **not** enforce any format by itself, and there is no `pattern` attribute. Any non-empty string passes. |
| Missing department/year | Not possible to leave empty — both are `<select>` with a pre-selected default value, so there's no "missing" state, only a possibly-wrong default a student forgets to change (minor UX note, not a defect) |
| Successful registration | ✅ Calls `registerForEvent()`, shows a spinner ("Processing Registration..."), then navigates to `/register-success/:id` with the generated `registrationId` passed via router state |
| Registration ID reaches confirmation page | ✅ via `location.state.registrationId`; falls back to a freshly generated mock ID only if the page is opened without that state (e.g., direct URL) |
| Registration correctly presented as mocked, not real | ✅ `AJAX_IMPLEMENTATION.md` and inline comments in `registrationService.ts` are explicit that this simulates a POST and there is no backend; the UI itself never claims a server processed anything beyond the visible spinner/confirmation |
| Failure path | 🟡 Exists in code (`try/catch` around `registerForEvent`, sets `submitError`) but is **currently unreachable** in practice, since `registerForEvent()` always resolves `{ success: true }` — this is consistent with "keep the existing mock behavior" from the prior task, but means the error UI can't actually be demonstrated without manually editing the service to test it |

---

## 7. Responsive Test

**Method note:** performed by reading Tailwind breakpoint classes (`sm:`/`md:`/`lg:`/`xl:`) and grid/flex structures per page — not by resizing a live browser window at each of the five requested widths. Treat this section as a structural risk assessment, not a rendered-pixel confirmation.

| Area | 1440 / 1280 | 768 | 375 / 430 | Notes |
|---|---|---|---|---|
| Navbar | ✅ full inline nav | ✅ (`sm:` breakpoint = 640px, so 768px still shows desktop nav) | ✅ collapses to hamburger menu below 640px | No horizontal-overflow risk found |
| Hero / Search | ✅ | ✅ | ✅ | `flex-col sm:flex-row` stacks button+input cleanly; hero heading uses fluid `text-4xl sm:text-5xl` |
| Event cards grid | ✅ 4-col (`xl:grid-cols-4`) | ✅ 2-col (`md:grid-cols-2`) | ✅ 1-col | Standard responsive grid, no fixed pixel widths found |
| Event Details | ✅ 2/3 + 1/3 sidebar | 🟡 sidebar likely stacks awkwardly right at 768px (`md:` breakpoint = 768px, exactly the boundary) | ✅ single column | Countdown boxes (`w-16` × 3) fit comfortably even at 375px |
| Registration form | ✅ 2-col | ✅ 2-col (`sm:grid-cols-2`, 640px breakpoint) | ✅ 1-col | No issues found |
| Calendar | ✅ | 🟡 7-column grid gets tight | 🔴 **Likely cramped** | `grid-cols-7` with `min-h-[100px]` cells has no mobile-specific alternative (e.g., a list/agenda view). At 375–430px, each column is roughly 45–55px wide; event chips rely on `truncate` to avoid overflow, so text will be heavily clipped even though no *layout* overflow occurs. This matches a gap already visible in the wireframes comparison (§10) — the wireframe's Week/List toggle exists specifically to solve this and wasn't carried over. |
| My Events | ✅ | ✅ | ✅ | Same card grid as Explore; tabs wrap via normal flex, no overflow found |
| Feedback | ✅ | ✅ | ✅ | Centered `max-w-2xl` column scales cleanly; 5 stars at `w-10 h-10` fit at 375px |
| Footer | ✅ | ✅ | ✅ | Minimal single-line footer, no layout risk |

No fixed pixel widths wider than the smallest tested viewport (375px) were found anywhere in the codebase, and no `min-width` values that would force horizontal scrolling were found. The Calendar is the one area with a genuine structural risk under this analysis method.

---

## 8. Accessibility Audit

Combines static code review with **real Lighthouse accessibility audit output** (not estimated).

### Findings confirmed by the Lighthouse run
- **`button-name` (failed):** the mobile hamburger menu button (`Navbar.tsx`) has no accessible name — no text, `aria-label`, or `title`. Screen readers announce it only as "button."
- **`color-contrast` (failed, 8 instances / 3 distinct patterns):**
  - "Explore Events" CTA button: white text on `teal-500` (`#14b8a6`) background — measured contrast **2.48:1** (needs 4.5:1). `src/pages/Home.tsx`.
  - "Open" registration-status badge: `green-600` (`#16a34a`) on white — measured **3.29:1**. Appears on every `EventCard`, i.e. Home, Explore, and My Events.
  - "Closed" registration-status badge: `red-500` on white — measured **3.76:1**. Same component, same reach.

### Findings from static code review
- **Semantic structure:** good baseline — `<nav>`, `<main>`, `<footer>` are used correctly (`Layout.tsx`, `Navbar.tsx`); forms use real `<form>`/`<label htmlFor>`/`<input id>` pairs in `Register.tsx`.
- **Heading hierarchy:** minor skips (h1 → h3, no h2) on Explore Events' empty state and Event Details' sub-sections. Not a severe violation, but not strictly correct outline order.
- **Form labels:** `Register.tsx` is fully correct (`htmlFor`/`id` pairs). `FeedbackForm.tsx` has visually-adjacent `<label>` elements for "Overall Rating" and the feedback textarea, but neither uses `htmlFor`/`id`, so the association isn't programmatic.
- **Icon-only interactive elements without labels:** Navbar bell button and hamburger button (confirmed by Lighthouse above); the five star-rating buttons in `FeedbackForm.tsx` (`Star` icon only, no `aria-label="Rate N stars"`).
- **Image alt text:** correct throughout — `EventCard` and `EventDetails` both set `alt={event.title}`.
- **Keyboard navigation:** no custom clickable `<div>`s were found standing in for buttons/links; all interactive elements are native `<button>`, `<a>`/`<Link>`, `<input>`, `<select>` — inherently keyboard-operable.
- **Visible focus states:** the shared `.btn` class and `.input-field` class both replace `focus:outline-none` with a visible `focus:ring`. However, the Navbar's icon buttons (bell, hamburger) use `focus:outline-none` with **no replacement ring at all** — a genuine, isolated regression risk for keyboard users on exactly two buttons.
- **Accessible error messages:** `ErrorState` and the Register form's inline `submitError` render as plain text with no `role="alert"`/`aria-live`, so a screen-reader user who triggers an error mid-session may not be notified unless they happen to move focus there.
- **Accessible loading states:** skeletons are correctly `aria-hidden="true"` (good — they're decorative), but there is no accompanying `aria-live="polite"` status text anywhere (e.g. a visually-hidden "Loading events…"), so screen-reader users get silence during a fetch rather than an announcement.

No unnecessary ARIA was added or is being recommended here — the two concrete recommendations (a couple of `aria-label`s on icon-only buttons, one `aria-live` region reused across pages) are the minimum needed to close a measured gap, not decoration.

---

## 9. Performance Audit

### Fresh Lighthouse run (this audit)
Run against a real `vite preview` production server (`npx lighthouse`, headless Chrome), report saved to `after-lighthouse.json` alongside the existing `before-lighthouse.json` for direct comparison.

| Metric | Before (2026-09-08, pre-AJAX) | After (2026-09-23, this audit) | Change |
|---|---|---|---|
| Performance | 76 | 81 | 🟢 +5 |
| Accessibility | 84 | 84 | ⚪ unchanged |
| Best Practices | 100 | 100 | ⚪ unchanged |
| SEO | 83 | 83 | ⚪ unchanged |
| LCP | 5.1 s | 4.7 s | 🟢 −0.4s |
| FCP | 1.7 s | 1.9 s | 🔴 +0.2s |
| Speed Index | 4.4 s | 2.9 s | 🟢 −1.5s |
| TBT | 130 ms | 20 ms | 🟢 −110ms |
| CLS | 0 | 0 | ⚪ unchanged |
| Time to Interactive | 5.1 s | 4.7 s | 🟢 −0.4s |

The AJAX refactor did **not** regress performance overall — most metrics improved slightly (likely noise-level machine variance plus a smaller/simpler synchronous initial render now that data loads after mount), and none of the four category scores dropped. LCP/TTI remain the weakest metrics (both ~4.7s) and are unchanged in kind from before.

### Fresh Lighthouse diagnostics (this run, not present in before-lighthouse.json)
- `unused-javascript`: ~41 KiB of unused JS in the shipped bundle.
- `image-delivery-insight`: ~347 KiB of possible savings — the app currently hotlinks full-size Unsplash images (`?w=1000&q=80` etc.) directly in `mockEvents`-derived JSON rather than using the already-generated `public/images/*-400.webp` responsive variants sitting unused in the repo.
- `render-blocking-insight`: ~730 ms of estimated savings — the Google Fonts `@import` in `index.css` (`Inter` font) is a render-blocking request.
- Bundle size (from `npm run build`): `285.38 kB` JS (`85.87 kB` gzip), `30.07 kB` CSS (`6.11 kB` gzip) — small and reasonable for this app's scope.

### Accessibility/SEO/Best Practices audit failures (from the same Lighthouse run)
- `meta-description`: `index.html` has no `<meta name="description">`.
- `robots-txt`: no `robots.txt` file exists at all (Lighthouse fetched the SPA's `index.html` fallback instead and correctly flagged it as invalid).
- `<title>` is still `temp-app` — the Vite scaffold default, never updated to "EventEase". This doesn't fail a specific Lighthouse audit but is a real, visible defect (browser tab, search results, bookmarks).

No optimization was performed — this section only records current state, per the task instructions.

---

## 10. Visual/Wireframe Comparison

Compared each of the 7 wireframe pages against its corresponding built page. The build is a **simplified subset** of the wireframes, consistent with `userflow.png`'s explicit "MVP CORE FLOW" scope note. Differences below are descriptive, not redesign requests.

| Wireframe page | Built page | Key differences observed |
|---|---|---|
| Home | `Home.tsx` | Wireframe: category pills + carousel + "Plan Your Week" CTA on Home itself. Built: category pills live on Explore instead; Upcoming Events is a static grid, not a carousel; no "Plan Your Week" calendar cross-promotion. |
| Explore/Event Details | `EventDetails.tsx` | Wireframe: tabbed content (About/Schedule/Competitions/Rules/Contact), "You may also like" related events, "Set Reminder" CTA, organizer club card with social links, registration fee display. Built: single-scroll layout with the same core facts (date/time/venue/eligibility/requirements/contact) but none of the tabs, related events, reminder CTA, or a fee field (the data model has no price field at all — all events are implicitly free). |
| Register | `Register.tsx` | Wireframe: 4-step wizard (Personal → Additional → Review → Confirmation) with a progress bar, category radio (Participant/Team Leader/Team Member), "how did you hear about this" field, and an explicit declaration checkbox. Built: single-step form covering only Personal Details' fields, with a static declaration sentence instead of a checkbox. |
| Registration Success | `RegistrationSuccess.tsx` | Wireframe: full registration-details recap (name/college/department/year/timestamp), a "What would you like to do next" action list, and a "What's Next" 3-step guide. Built: event-pass card with mock QR code + registration ID + Download Pass/View My Events — materially simpler, but hits the core "confirmation with an ID" requirement. |
| Calendar | `CalendarView.tsx` | Wireframe: Month/Week/List toggle, mini side-calendar, per-day event panel, type+date-range filters, category color legend, "Manage Reminders" CTA. Built: month grid only, no side panels, no filters, no legend. See also the responsive risk noted in §7. |
| My Events | `MyEvents.tsx` | Wireframe: 4 tabs including counts and an "Applications" tab, a search box, "View Calendar" shortcut, "Registered" badges, "View Certificate"/"Rate this Event"/"Event Guide" links per card. Built: 3 tabs (Upcoming/Past/Saved), generic `EventCard` reused with no status badge, no search, no certificate/feedback entry points. This is also where Bug #2 lives — the deeper problem is the tab contents aren't derived from real state at all, which is more fundamental than the missing UI chrome. |
| Feedback | `FeedbackForm.tsx` | Wireframe: 4 separate star-rating categories, 3 distinct optional text fields, a "would you recommend" 5-point radio, sidebar context panel. Built: single overall star rating + one free-text field. Functionally reachable-but-unlinked (Bug #3). |

**Not present in the build at all (and not in the MVP core flow), so treated as intentionally deferred rather than defects:** persistent left sidebar nav, "Organizers" section, "About Us" page, multi-column footer with Quick Links/Support/Download-app links, Applications tracking.

---

## 11. Code Quality

### `npm run build`
```
✓ 1830 modules transformed.
dist/index.html                   0.45 kB
dist/assets/index-*.css          30.07 kB
dist/assets/index-*.js          285.38 kB
✓ built in ~2-3s
```
**TypeScript compiles cleanly — 0 errors.**

### `npm run lint` (oxlint)
**0 errors, 4 warnings:**

| File | Warning | Assessment |
|---|---|---|
| `src/context/EventsContext.tsx:60` | `react(only-export-components)` — exporting both `EventsProvider` and `useEvents()` from one file breaks Fast Refresh isolation | Low — a very common, accepted pattern (context + its hook together); cosmetic |
| `src/context/EventsContext.tsx:31` | `react(set-state-in-effect)` — synchronous `setLoading`/`setError` calls at the top of the fetch effect | Medium — idiomatic for this fetch pattern, but could be simplified (e.g., initialize `loading` state as `true` by default instead of setting it in the effect) |
| `src/components/Navbar.tsx:21` | Same `set-state-in-effect` pattern for the notification fetch | Medium — same reasoning |
| `src/pages/RegistrationSuccess.tsx:16` | `react(purity)` — `Math.random()` called during render for the fallback registration ID | Medium — a real correctness concern: if this component re-renders before router state settles, the displayed fallback ID could change. Should be computed once via `useState(() => ...)` or `useMemo`. |

### Other code-quality observations (not lint-flagged)
- `src/pages/ExploreEvents.tsx` — `onChange={(e) => setDateFilter(e.target.value as any)}` uses `as any` instead of a typed union cast (pre-existing).
- `src/pages/MyEvents.tsx:14-16` — the "registered/saved" derivation is dead-end mock logic that doesn't consume any real registration state (this is Bug #2, listed again here because it's also a maintainability smell — the function names imply real filtering logic that doesn't exist).
- `src/pages/StudentProfile.tsx` — four `href="#"` placeholder links and a non-wired "Edit Profile" button (pre-existing, not part of the AJAX work).
- No dead code, no duplicate service logic, and no unused imports were found — the new service/context layer (`eventService`, `notificationService`, `registrationService`, `EventsContext`) is cleanly separated with no overlap.
- No component was found making its own redundant `fetch()` call outside the service layer — all data access goes through the three services as intended.

---

## 12. Bugs Found

| ID | Severity | Area | Summary |
|---|---|---|---|
| 1 | 🔴 Critical | Home / AJAX | Hero search input triggers `window.location.href = '/explore'` — a full page reload on the app's main entry point, contradicting the explicit "no full-page reload" requirement. `src/pages/Home.tsx:42` |
| 2 | 🔴 Critical | My Events | Tab contents (`registeredUpcoming`, `registeredPast`, `savedEvents`) are hardcoded slices of the master event list, not derived from any real registration/save action. Registering for an event never makes it appear here. `src/pages/MyEvents.tsx:14-16` |
| 3 | 🔴 Critical | Feedback / Navigation | `/feedback/:id` has no inbound link anywhere in the UI (Navbar, EventCard, My Events all checked) — only reachable via manual URL entry, breaking the journey map's final step |
| 4 | 🟠 High | Event Details / My Events | "Save Event" toggles local-only state; it has no effect on the "Saved" tab in My Events (which is itself hardcoded — see Bug #2) |
| 5 | 🟠 High | Event Details | "Share" and "Add to Calendar" buttons have no `onClick` handler at all — purely decorative. `src/pages/EventDetails.tsx:223-232` |
| 6 | 🟠 High | Registration Success | "Download Pass" button has no `onClick` handler. `src/pages/RegistrationSuccess.tsx:78-79` |
| 7 | 🟠 High | Accessibility | Navbar hamburger button has no accessible name (Lighthouse `button-name` failure); both bell and hamburger buttons remove the focus outline (`focus:outline-none`) with no replacement ring, so keyboard users lose visible focus on them entirely |
| 8 | 🟠 High | Accessibility | Measured WCAG-AA color-contrast failures: "Explore Events" CTA (2.48:1), "Open" status badge (3.29:1), "Closed" status badge (3.76:1) — the badge issue reaches every event card sitewide |
| 9 | 🟠 High | Registration | Phone field (`type="tel"`) enforces no format — invalid phone numbers (letters, wrong length) pass client-side validation silently |
| 10 | 🟠 High | Branding/SEO | Browser tab title is still `temp-app` (Vite scaffold default), never updated to "EventEase". `index.html:7` |
| 11 | 🟡 Medium | Registration Success | Fallback registration ID uses `Math.random()` directly in the render body (impure — flagged by lint), which is not React-render-safe |
| 12 | 🟡 Medium | Profile | Four sidebar links (`Personal Info`, `Notifications`, `Security`, `Sign Out`) are `href="#"` placeholders; "Edit Profile" button has no handler (pre-existing) |
| 13 | 🟡 Medium | Accessibility | No `aria-live` region anywhere to announce loading/error state changes to screen-reader users |
| 14 | 🟡 Medium | Accessibility | Feedback form's five star-rating buttons are icon-only with no accessible name (e.g. "Rate 3 stars") |
| 15 | 🟡 Medium | Responsive | Calendar's 7-column month grid has no mobile-appropriate alternative view; text will be heavily truncated at 375-430px widths (structural risk, not confirmed by live rendering) |
| 16 | 🟡 Medium | SEO | Missing `<meta name="description">` and no `robots.txt` (both confirmed by Lighthouse) |
| 17 | 🟡 Medium | Registration | Declaration is static text, not an actual checkbox the user must tick, unlike the wireframe |
| 18 | 🔵 Low | Code quality | `ExploreEvents.tsx` uses `as any` for the date-filter select's change handler instead of a typed union |
| 19 | 🔵 Low | Code quality | `EventsContext.tsx` triggers an oxlint Fast-Refresh warning by exporting a hook alongside its provider component |
| 20 | 🔵 Low | Navbar | Notification list items are styled `cursor-pointer` but have no click behavior, implying interactivity that doesn't exist |
| 21 | 🔵 Low | Branding | `package.json` `"name": "temp-app"` — cosmetic Vite scaffold leftover |

**Total: 21 findings** (3 Critical, 7 High, 7 Medium, 4 Low).

---

## 13. Improvements Recommended

*(Not applied — recommendations only, ordered to roughly match the bug list above.)*

1. Replace the Home hero search input's `window.location.href` redirect with `useNavigate()`, or make it an actual controlled search that filters in place / navigates via `<Link>`.
2. Introduce a minimal piece of shared state (e.g., a `registeredEventIds`/`savedEventIds` set in `EventsContext` or a sibling context) that `Register.tsx` writes to on success and `MyEvents.tsx` reads from, so "My Events" reflects real actions. This does not require a backend — it can be in-memory or `sessionStorage`-backed, consistent with the project's "no real backend" constraint.
3. Add a "Give Feedback" entry point — the most natural spot is a button on each Past Event card in My Events, matching the wireframe's "Rate this Event" link.
4. Wire "Add to Calendar" to a real `.ics` file download (pure client-side, no backend needed) or remove the button if out of scope.
5. Wire "Share" to the Web Share API with a clipboard-copy fallback (both are client-only, no backend required).
6. Wire "Download Pass" similarly, or clearly label it as a demo placeholder if left as-is.
7. Add `aria-label="Notifications"` and `aria-label="Toggle menu"` (or similar) to the two icon-only Navbar buttons, and give both a visible `focus:ring` to replace the removed default outline.
8. Darken the teal CTA background or switch its text/background pairing, and darken the green/red status-badge text, to reach 4.5:1 contrast.
9. Add a `pattern="[0-9]{10}"` (or equivalent) and `maxLength` to the phone input, and consider a similar constraint for the roll number field.
10. Update `<title>` in `index.html` to "EventEase — CUTM Event Discovery & Registration", and update `package.json`'s `name`.
11. Compute the fallback registration ID once via `useState(() => generateId())` instead of inline `Math.random()` in the render body.
12. Either wire up the Profile sidebar links/Edit Profile button or visually mark them as "coming soon" so they don't read as broken.
13. Add one shared visually-hidden `aria-live="polite"` region (e.g., inside `ErrorState` and the skeleton components) announcing "Loading events" / the error message.
14. Add `aria-label={\`Rate ${star} star${star>1?'s':''}\`}` to each star button in `FeedbackForm.tsx`.
15. Consider a simple agenda/list fallback view for Calendar below a viewport breakpoint (this is exactly what the wireframe's "List" toggle already models).
16. Add a `<meta name="description">` tag and a minimal `public/robots.txt`.
17. Turn the registration declaration text into an actual required checkbox.
18-21. Minor code-quality cleanups (typed cast, split hook/provider into two files if Fast Refresh purity matters to the team, remove dead `cursor-pointer` styling or add real behavior, rename `package.json`).

---

## 14. Priority Fix List

**🔴 Critical (fix first):**
1. Home search full-page reload (Bug #1)
2. My Events not reflecting real registrations/saves (Bug #2)
3. Feedback page unreachable from the UI (Bug #3)

**🟠 High (fix next):**
4. Save Event ↔ My Events disconnect (Bug #4)
5. Non-functional Share/Add to Calendar buttons (Bug #5)
6. Non-functional Download Pass button (Bug #6)
7. Icon-only Navbar buttons: missing accessible name + missing focus ring (Bug #7)
8. Color-contrast failures on CTA button and status badges (Bug #8)
9. No phone number format validation (Bug #9)
10. Page title still "temp-app" (Bug #10)

**🟡 Medium:**
11. Impure `Math.random()` fallback ID (Bug #11)
12. Non-functional Profile sidebar links (Bug #12)
13. No `aria-live` for async state changes (Bug #13)
14. Unlabeled feedback star buttons (Bug #14)
15. Calendar mobile responsiveness risk (Bug #15)
16. Missing meta description / robots.txt (Bug #16)
17. Registration declaration not an actual checkbox (Bug #17)

**🔵 Low:**
18-21. Code-quality/cosmetic items (Bugs #18-21)

---

## Summary

- **Total issues found:** 21
- **Critical:** 3 (Home full-page reload; My Events not tied to real registrations; Feedback page unreachable)
- **High:** 7 (disconnected Save/My Events, three non-functional buttons, Navbar accessibility, measured color-contrast failures, missing phone validation, leftover page title)
- **Medium:** 7 · **Low:** 4
- **Fully complete features:** Home discovery, Explore search/filter, Event Details content, Registration submission + confirmation, Calendar (month view), async event-fetching architecture (fetch → context → cache → UI), loading states, error states + retry, on-demand notification fetch, mocked-but-properly-abstracted registration service, clean TypeScript build, clean lint (0 errors)
- **Features needing improvement:** My Events (functional gap, not cosmetic), Feedback discoverability, Event Details/Registration-Success secondary actions (Share/Calendar/Download), Navbar accessibility, sitewide color contrast on two recurring UI elements, registration input validation

No application code was changed while producing this report. Awaiting approval before implementing any fixes.
