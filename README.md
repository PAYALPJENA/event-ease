# EventEase Platform

The real, backend-powered version of EventEase — CUTM's platform for discovering, registering for and keeping track of campus events.

This repository implements **all five phases of the product blueprint — V1 (Student MVP), V2 (Event operations),
V3 (Student ecosystem), V4 (Platform intelligence) and V5 (Integrations)**
(`EVENTEASE_PRODUCT_BLUEPRINT.md` in the original `eventease` prototype folder). The prototype
itself is untouched in `../eventease`; its UX, components and accessibility fixes were carried over here.

## Quick start

Requirements: Node.js 24+ (the API runs TypeScript directly with Node's built-in type stripping). No database server, Docker or accounts are needed.

```bash
npm install
npm run dev
```

`npm run dev` creates and seeds the local database (first run only), applies any new migrations, then starts:

- the **API** on http://localhost:3001/api
- the **web app** on http://localhost:5173 (it proxies `/api` to the API)
- the **scheduler** inside the API process, every 60 seconds: reminders, attendance, waitlist offers, unpaid seats, team locking, message delivery

## Content: real CUTM events vs. fictional samples

The database holds two clearly separated kinds of content:

| | What | Loaded |
|---|---|---|
| **CUTM events** (`server/src/db/seed-cutm.ts`) | Real events from CUTM communications: College Rivals 4, the “Building Happy & Resilient Youth” workshop, Code Golf, International Microorganism Day & Agar Art Competition, the NCC Plantation Drive, and IEEE SCOPES 2027 | Always (the default) |
| **Sample events** (`server/src/db/seed-samples.ts`) | Fictional events, clubs, students and activity that exercise every feature (registration, waitlist, teams, payment, documents, check-in, certificates, opportunities). Labelled **Sample** in the app | Only with `--with-samples`; always in the tests |

**No invented facts on real events.** A CUTM event holds only what its source states — title, date, type,
category, and the organizer when the source names one (NCC). Everything else (exact time, venue, capacity, fee,
registration window, eligibility, contact) is stored as *not specified* and shown that way ("Time to be
announced", "Venue not specified", "Registration details not specified"). No registrations, attendance or
statistics are attached to real events. Status comes from the dates, so on 1 October 2026 the September events show
as ended and SCOPES 2027 (4–6 February 2027) as upcoming.

Still to add once their source details are available: the MEAI interaction session, the alumni talk(s) (kept
separate unless the source says they're one event), the daily yoga / wellness sessions (recurring), and Pre-Qiskit
Fall Fest 2026.

```bash
npm run db:reset -w server                      # CUTM events only (default)
npm run db:reset -w server -- --with-samples    # CUTM events + the fictional sample set
```

Resetting deletes the local database. Upgrading an existing database is automatic and keeps its data.

Open http://localhost:5173 and use **Sign in**. In development you pick one of the sample accounts (fictional people).
With only the CUTM events, there's nothing to register for yet — browse, filter, save, use the calendar, and sign
in as the **Student Affairs Office** (admin) to manage events, clubs and approvals. With `--with-samples` you can
try everything:

| Account | Role | Try (with `--with-samples`) |
|---|---|---|
| Aarav Kumar | Student, CSE year 3 | Home shows *Recommended for you* with reasons (he follows two clubs). Attended the AI & ML Workshop: rate it, and see his certificate under *My Certificates* (verify it at `/verify/CERT-AARAV001`) |
| Priya Das | Student, ECE year 2 | Register for *Startup Pitch Night* (₹150): answer the questions, pay on the test gateway, upload a PDF. Start a team for the Hackathon and share the invite code. Registered for the live Tech Talk |
| Rohan Mishra | Student, BBA year 1 | *Alumni Mentorship Circle* is full: join the waitlist. Sees "Not eligible" on CSE-only events |
| Rahul Sharma | Student + organizer of CUTM Tech Club and Coding Club | *Organizer*: approve Priya's document on Participants, add a check-in volunteer, check people in to the live Tech Talk, analytics, club page, post an opportunity |
| Dr. Anita Desai | Organizer, Dept. of Computer Science | *Results & certificates* on the finished AI & ML Workshop; her Cloud Computing workshop is waiting for approval |
| Student Affairs Office | Administrator | *Approvals*, *Insights* (with the co-curricular records export), *Payments*, *Clubs* (assign organizer roles), *Message log* |

The sample **Tech Talk: Building for the Web** starts one hour after the database is seeded, so its check-in
window (opens 2 hours before the start) is open straight away. Reset the database to move it to "now" again.

## Event taxonomy

- **Categories** (subject area, used for filters and recommendations): Technical · Competitions · Workshops ·
  Seminars & Talks · Research · Sports · Cultural · Clubs & Societies · Student Development · Social Impact ·
  Wellness · Career · Other. Reference data installed by migration `0006`, in that order.
- **Event type** (what kind of happening it is): workshop, competition, talk, seminar, conference, fest, sports,
  cultural, club activity, community service, wellness, student development, other.
- **Registration mode**: students register on EventEase · no registration needed · not specified.
- Plus free-form **tags**, a **time to be announced** flag, a **source note** and a **sample** flag.

Events, **opportunities** (applied to, with a deadline) and **announcements** stay separate content types.

## What V1 does

- **Sign-in and sessions**: httpOnly session cookies, stored hashed on the server. A clearly labelled development sign-in stands in for university SSO (see *Connecting SSO*).
- **Events from a database**: published events with live seat counts and derived status (opens soon / open / closing soon / full / closed / ended / cancelled).
- **Registration enforced by the server** (blueprint §8.3):
  - one active registration per student per event (unique index + check)
  - never over capacity (transactional seat check, tested with concurrent requests)
  - eligibility from the student's university profile (department/year)
  - registration window
  - Indian mobile number validation (same rule in the browser and on the server)
- **Digital pass**: QR code carrying an HMAC-signed token; organizers can verify it (`POST /api/admin/passes/verify`), and a cancelled registration's pass is rejected. Printable HTML pass download.
- **My Events**: upcoming (with View Pass and cancel), past (rate once), saved.
- **Feedback**: stored per registration, only after the event ends, once.
- **In-app notifications**: registration confirmed/cancelled, event time/venue changed, event cancelled.
- **Organizer & admin screens**: create draft → publish, edit (time/venue changes notify registrants), cancel with a reason (cancels registrations and notifies students), participants list and CSV export. Organizers only ever see their own organizations' events.
- **Security basics**: CSRF protection (allowed origins + JSON-only writes + SameSite cookies), secure headers, server-side role checks on every write, audit log of registrations and event changes.

## What V2 adds

- **Approval workflow** (blueprint §3.3): `draft → pending_approval → published`, with *request changes* (and resubmit) or *reject*, and a review timeline with the admin's comments. Organizers submit; admins approve. Admins can also publish directly. Everyone involved gets a notification.
- **Venue clash check** (§8.3 #7): a venue can't be booked for two overlapping published events. The approvals queue shows clashes. Admins can override, and the override is logged.
- **Change propagation** (§7.1, §8.3 #8): changing a published event's time or venue needs a reason. The change is recorded, shown as a banner on the event page, and sent to every registrant in-app and by email.
- **Cancellation**: an organizer cancelling an event that has registrations sends a request that an admin confirms or declines.
- **QR check-in** (§5, §8.3 #6): a camera scanner in the browser (BarcodeDetector, or jsQR as a fallback), manual lookup by name, roll number or registration ID, and a live counter. Each scan is ✅ checked in, ⚠️ already checked in, or ❌ cancelled, wrong event, not yet open, or not a valid pass. Check-in opens 2 hours before the start.
- **Offline queue**: scans made without a connection are kept on the device with their scan time and synced automatically when the connection returns. The participant list is cached, so the door still sees names while offline.
- **Attendance**: when an event ends, `checked_in → attended` and `confirmed → no_show`. **Feedback is limited to attendees** (§8.3 #4).
- **Participants**: an overview (registered, checked in, absent, feedback, average rating), search and filters, add a student by roll number or remove one (each with a logged reason the student sees), and a CSV that includes check-in times.
- **Announcements**: message everyone registered, only those not yet checked in, or only those checked in, in-app and by email. Every message is logged.
- **Scheduled reminders and email** (§7.2), sent by the server:

  | When | Message | Channel |
  |---|---|---|
  | On registration | Confirmation with the registration ID | In-app, email |
  | 7 days before | "Coming up" | In-app |
  | Within 24 h of the start | "{event} is today/tomorrow", with the time, venue and what to bring | In-app, email |
  | 24 h before registration closes | "Registration closes soon", for students who saved the event | In-app |
  | Time/venue change, cancellation | Critical update | In-app, email |
  | 09:00 IST the morning after | "How was {event}?", to attendees who haven't rated it | In-app |

  Emails go to an **outbox table** in the same transaction as the action that caused them, and the scheduler delivers them. A failed send is retried up to 5 times. In development they are printed in the API terminal (`MAIL_MODE=console`); admins can read every message under *Organizer → Email log*.

## What V3 adds (student ecosystem)

- **Clubs and following** (§4.11): a club directory and club pages (about, recruiting, links, contacts, events). Following a club puts its new events on Home and in notifications. Admins create clubs and assign lead/organizer/volunteer roles; a club's lead edits its page.
- **Waitlist with offers** (§3.3): when an individual event is full, students join the waitlist and see their position. A freed seat is offered to the next person, held for the event's offer window (default 12 h), then passed on if not accepted. Raising capacity offers the new seats straight away.
- **Teams** (§3.3 Team): team events set a minimum and maximum size. Students start a team (and get an invite code) or join one. A team is *forming* until it reaches the minimum; at registration close complete teams are locked and incomplete ones are cancelled with a notice.
- **Registration questions and documents** (§4.5): organizers add text or multiple-choice questions and required documents. Documents (PDF/PNG/JPEG ≤ 2 MB, type checked from the file's bytes) are reviewed on the Participants page; the seat is held as *pending documents* until everything is approved.
- **Cancellation cut-off**: events can close cancellations N hours before the start.
- **Feedback on dimensions** (§5): content, speakers, organization, venue, registration experience, and "would attend again".
- **Results and certificates** (§4.13, §8.3 #5): after the event, organizers enter and publish results (attendees are notified), and issue certificates by the event's rule — participation for attendees, winners, or both. Students download a printable certificate (save as PDF) and share a public verification link, `/verify/{code}`, which shows only the holder, event, issuer and date. Certificates can be revoked.
- **Recap and gallery** on the event page after it ends.
- **Opportunities** (§4.12): internships, scholarships, research, competitions — with deadlines, eligibility and external links. Students save them and get a reminder the day before the deadline.
- **Check-in volunteers** (§2.2): organizers add a student as a volunteer for one event; they can open the scanner at `/check-in/{event}` and see the door list, and nothing else.
- **My Events → Applications**: registrations waiting for payment, documents or a waitlist seat.

## What V4 adds (platform intelligence)

- **Recommendations** (§7.5): rule-based — interests × category, followed clubs, categories you attended, popularity with your department and year, and closing soon. Every card says *why*, and students can switch personalization off. Interests are picked in the profile.
- **Organizer analytics**: the funnel from unique page views → registrations → attendance → feedback, fill rate, waitlist, no-show rate, ratings per dimension, and comparison with the organization's past events.
- **Admin insights** (§6): participation by department and year, demand and fill rate by category, attendance and no-show rates, and organizer performance, for any date range, with CSV export.

## What V5 adds (integrations)

- **Payments with refunds**: paid events hold the seat as *pending payment* for 30 minutes; the registration is confirmed only by the gateway's **signed webhook** (never the browser redirect). Unpaid seats are released automatically, a payment that arrives late is refunded, and cancelling before the cut-off (or cancelling the event) refunds the fee. Admins get a reconciliation page. Development uses a built-in mock gateway with a test checkout page.
- **Push notifications and an installable app**: a web app manifest and service worker; students turn on push per device in their profile. The service worker also keeps passes viewable offline (§4.9) and clears them on sign-out.
- **Calendar subscription** (§4.8): a private, revocable `webcal://` feed of the student's events, so Google Calendar and Outlook stay in sync with time and venue changes.
- **Notification preferences** (§4.10): a category × channel matrix (email, push, and SMS/WhatsApp where enabled). Critical changes to registered events can't be switched off.
- **SMS and WhatsApp**: wired into the same outbox, off by default until the university approves (`SMS_MODE`, `WHATSAPP_MODE`); by default they carry only critical updates.
- **University records**: an admin export of co-curricular records (every attended event per student, with hours and certificate IDs), as CSV or JSON.
- **Personal data export** (§9.2): students download everything EventEase holds about them.

## Connecting real providers

Everything external is behind a small interface, with a development stand-in:

| What | Where | Development stand-in |
|---|---|---|
| Email, push, SMS, WhatsApp | `Sender` in `server/src/lib/channels.ts` | prints each message in the API terminal; admins read them under *Message log* |
| Payments (e.g. Razorpay) | `PaymentGateway` in `server/src/services/payments.ts`, webhook at `POST /api/payments/webhook` | mock gateway with a test checkout page |
| University SSO | see *Connecting SSO* below | development sign-in |

The outbox, retries, preferences and logs don't change when a real provider is plugged in. Set `APP_URL` to the public
web address so links in messages and calendar feeds work. In production the server refuses to start with the mock
gateway, without `PAYMENT_WEBHOOK_SECRET`, or without VAPID keys. Web Push needs HTTPS (as does the camera scanner on phones).

## Project layout

```
server/                 Hono API + Kysely + SQLite
  src/app.ts            routes and middleware wiring
  src/auth.ts           sessions, CSRF, role checks
  src/db/               schema types, migrations, seed, setup script
  src/lib/              pure rules, ids, signed pass tokens, channels (senders), ICS builder
  src/services/         events, registrations + lifecycle (waitlist, teams), payments, documents,
                        certificates/results, check-in, recommendations, analytics, scheduler, notifications
  src/routes/           auth, events, me (student), public (clubs, opportunities, verify, calendar, payments),
                        admin (events, approvals, clubs, opportunities, insights, payments), operations (event
                        day and after), checkin (door, incl. volunteers)
  test/                 unit + API tests (node:test, in-memory database, controllable clock)
web/                    React + Vite + Tailwind (the prototype's UI, now API-backed), installable (PWA)
  public/sw.js          service worker: offline app shell and passes, push notifications
  src/services/         api.ts fetch wrapper; event, registration, student and admin services
  src/context/          Auth, Events, UserEvents (registrations + saved)
  src/pages/            student pages: events, registration + pass, clubs, opportunities, certificates, profile
  src/pages/admin/      organizer/admin screens: events, form, approvals, participants, check-in, announcements,
                        results & certificates, analytics, insights, clubs, opportunities, payments, message log
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Set up the database if needed, run API + web with reload |
| `npm test` | Server tests (97): rules, pass tokens, config safety, every API invariant, the V2–V5 workflows, and the CUTM events as test cases for the event model |
| `npm run build` | Type-check and build the web app |
| `npm run lint` | Lint the web app (oxlint) |
| `npm run typecheck` | Type-check server and web |
| `npm run db:reset -w server` | Delete and re-seed the local database |

## Public demo on Render

`render.yaml` deploys the whole platform as one free Render web service: `npm run build` builds the web app and
the API serves it from the same origin (`server/src/index.ts`). On every start the database is re-seeded with the
CUTM events and the fictional sample data (`npm run start:render`), so the demo always begins fresh and the
development sign-in lets visitors pick a sample account. It is a demo, not a production setup (no SSO, test
payment gateway, data resets on restart).

1. Push this repository to GitHub.
2. On [render.com](https://render.com): **New → Blueprint**, pick the repository, **Apply**.
3. The site is live at `https://eventease-xxxx.onrender.com` (shown on the service page). Free services sleep
   after ~15 minutes idle; the first visit after that takes about 30 seconds.

## Connecting SSO (next step)

Identity is separated from sessions. To add CUTM single sign-on (Google Workspace, Microsoft Entra ID or the campus identity provider — blueprint §14 Q1):

1. Add an OIDC login + callback route in `server/src/routes/auth.ts`.
2. In the callback, find or create the `users` row from the verified identity claims (roll number, department, year, campus from the university directory).
3. Call `startSession(c, user)`. Nothing else in the app changes.
4. Run with `AUTH_MODE=sso`, which switches off the development sign-in. The server refuses to start with `AUTH_MODE=dev` when `NODE_ENV=production`.

## Moving to PostgreSQL

The schema follows portability rules (text IDs, ISO timestamps, JSON-as-text, partial unique index supported by both). To switch:

1. Replace `SqliteDialect` with Kysely's `PostgresDialect` in `server/src/db/index.ts`.
2. In `server/src/services/registrations.ts`, add `.forUpdate()` to the event select inside the registration transaction so concurrent registrations for the same event queue up (SQLite serializes transactions, Postgres does not).
3. Map unique-violation error codes (`SQLITE_CONSTRAINT_UNIQUE` → Postgres `23505`).

## Still to connect or decide

- **Real providers**: university SSO, an email service, a Web Push sender, an SMS/WhatsApp gateway and a payment gateway. Each plugs into the interface described in *Connecting real providers*; they need the university's accounts and approvals.
- **Malware scanning** of uploaded documents (blueprint §9.3): uploads are type- and size-checked; a scanner such as ClamAV would run before a file is accepted.
- **Exit criteria that need real use**: the blueprint's phase exit criteria (a pilot with real events, measuring recommendations against a control group, reminder open rates per channel) can only be met with students using it.
- **Blueprint items beyond the phase lists**: event sessions/schedules, FAQs, a campus map, global search across clubs and people, institution-wide announcements, account deletion requests and a data-retention job.
