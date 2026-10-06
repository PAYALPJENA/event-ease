# EventEase — Product Blueprint (V2 Specification)

**Status:** Draft 1 · 2026-09-23
**Covers:** the full campus product — the Student app, the Organizer portal and the Admin portal.
**Builds on:** EventEase V1, the frontend/CX prototype in this repository.
**Tech stack:** not decided yet. §12 lists the requirements a stack must meet; the choice comes later, after research.

> **How to read this document**
>
> - §1–3: what EventEase is, who uses it, and the lifecycle everything else hangs off.
> - §4–6: every screen in each of the three apps.
> - §7: the systems that connect the apps.
> - §8: the data model.
> - §9–10: quality requirements and the phased roadmap.
> - §11–14: how V1 feeds into this, stack criteria, success metrics, and questions only the university can answer.

---

## 1. Product definition

### 1.1 What EventEase is
EventEase is **CUTM's single platform for student events and opportunities**. It covers the whole lifecycle of an opportunity, from discovering it to taking part and getting an outcome (attendance, certificate, result). It is not just a place to list events.

### 1.2 The problem
Today, event information at CUTM is spread across WhatsApp groups, notice boards, Instagram pages, Google Forms and word of mouth. That causes predictable failures:

| Student question | Why it's hard today |
|---|---|
| "What's happening in college?" | No single source of truth. You find out only if you're in the right group. |
| "Where do I register?" | Every organizer uses a different form. |
| "Did I actually register?" | Forms give weak or no confirmation, and there's no personal record. |
| "When / where is it?" | Details sit in a poster or chat message that gets buried. |
| "What do I need to bring?" | Requirements are rarely stated in one place. |
| "Where's my certificate?" | Certificates are emailed or handed out by hand, and some are lost. |

Organizers have the mirror image of these problems: registrations scattered across forms, manual attendance, no reliable way to reach registrants, and no feedback loop.

### 1.3 Who it serves
| Role | Primary need |
|---|---|
| **Student** | Find relevant opportunities, register once, never miss a detail, keep a record of participation. |
| **Organizer** (club, department, cell) | Publish events, manage participants, run check-in, talk to attendees, issue outcomes. |
| **University Admin** | Govern what gets published, manage venues/clubs/organizers, see institution-wide activity. |
| **Super Admin** (optional) | Platform configuration, role assignment, data governance. |

### 1.4 Product principles
1. **One lifecycle, fully connected.** Every action updates everything that depends on it (see §7.1). A registration that doesn't show up in My Events, the Calendar, reminders, the pass and the organizer's list is a bug.
2. **Answer the student's question before they ask it.** Date, venue, requirements, deadline and registration status are visible at a glance on every surface.
3. **Know the student; never make them retype.** Identity comes from the university account, and forms pre-fill.
4. **Trust over decoration.** Passes, check-in and certificates must be verifiable. If something is mocked or pending, the UI says so.
5. **Student control.** Personalization, notifications and profile visibility are opt-in and adjustable.
6. **Accessible and mobile-first.** Most students will use a phone. Target WCAG 2.2 AA.

### 1.5 What makes it different from a college events page
A normal events page ends at "here's a poster and a form link." EventEase **owns what happens after** you register: a confirmed registration record, reminders, a digital pass, QR check-in, attendance, certificate, feedback and history. The organizer side is fed by the same data. That closed loop is the product.

---

## 2. Roles and permissions

### 2.1 Role model
- One **User** can hold several roles. A student can also be an organizer for a club.
- Organizer rights are **scoped to an organization** (a Club or Department). Being an organizer of the AI Club gives no rights over Cultural Club events.
- Admins act institution-wide. Every admin action is recorded in an **audit log**.

### 2.2 Permission matrix (summary)

| Capability | Student | Organizer (own org) | Admin | Super Admin |
|---|:-:|:-:|:-:|:-:|
| Browse / search published events | ✅ | ✅ | ✅ | ✅ |
| Register, cancel, join waitlist, join team | ✅ | ✅ (as a student) | — | — |
| Give feedback on attended events | ✅ | ✅ (as a student) | — | — |
| Create / edit draft events | — | ✅ | ✅ | ✅ |
| Submit event for approval | — | ✅ | — | — |
| Approve / reject / request changes | — | — | ✅ | ✅ |
| View participant list & export | — | ✅ | ✅ | ✅ |
| Message registrants | — | ✅ | ✅ | ✅ |
| Run QR check-in | — | ✅ (plus assigned volunteers) | ✅ | ✅ |
| Publish results / issue certificates | — | ✅ | ✅ | ✅ |
| Cancel a published event | — | ✅ (request) | ✅ | ✅ |
| Manage venues, categories, clubs | — | — | ✅ | ✅ |
| Assign roles / manage users | — | Club membership only | ✅ | ✅ |
| Platform settings, data retention | — | — | — | ✅ |

**Check-in volunteers** are a narrow delegated role. They can scan and check people in for one event, and nothing else.

---

## 3. The core lifecycle

### 3.1 Student lifecycle
```text
Discover → View Event → Register / Join Team / Waitlist → Confirmation
   → My Events + Calendar + Reminders + Digital Pass
   → Check-in → Attendance → Certificate / Result → Feedback → History & Profile
```

### 3.2 Organizer lifecycle
```text
Create (Draft) → Submit → Admin Review → Published → Registrations open
   → Participants / Communication → Registrations close → Check-in → Attendance
   → Results / Certificates → Feedback → Analytics → Archived
```

### 3.3 State machines
These states drive every screen and notification. They must be defined before any UI is built.

**Event**
```text
draft ─submit→ pending_approval ─approve→ published ─(end time)→ completed → archived
                     │  └─request changes→ changes_requested ─resubmit→ pending_approval
                     └─reject→ rejected
published ─cancel→ cancelled          (notifies all registrants; reversible only by admin)
```
Registration availability is **derived**, never stored:
`not_open | open | closing_soon (< 48 h) | full (waitlist available) | closed`.

**Registration**
```text
pending (payment / docs / approval) → confirmed ─(check-in)→ checked_in ─(event end)→ attended
confirmed ─(event end, not checked in)→ no_show
confirmed | pending ─student or organizer→ cancelled
waitlisted ─seat offered→ offer_pending ─accept in time→ confirmed
                                         └─expires→ waitlist_expired
```

**Waitlist offer.** When a seat frees up, the first person on the waitlist gets an offer with a time limit (default 12 h, set per event). If it expires, the offer moves to the next person.

**Team**
```text
forming (leader + invites) → complete (meets min size) → registered → locked (at registration close)
```

**Certificate**
```text
not_eligible → eligible (attendance / result rule met) → issued → (revoked)
```

**Document**
```text
required → submitted → approved | rejected (with reason) → resubmitted
```

---

## 4. Student app — screen specification

Every screen must define its **loading, empty, error and offline** states. V1 already establishes the patterns for loading and error states (skeletons, retry).

### 4.1 Onboarding (first launch)
- **Sign in with CUTM account** (SSO). No passwords stored by EventEase.
- **Confirm profile.** Name, roll number, campus, school/department, programme, year/semester. These come from the university and are read-only. Contact preferences are editable.
- **Pick interests** (multi-select): Hackathons, Coding, AI/ML, Sports, Cultural, Music, Dance, MUN/Debate, Entrepreneurship, Workshops, Research, Competitions, Volunteering, Clubs, Conferences, Placement/Career.
- **Pick opportunity types**: Competitions, Workshops, Networking, Certifications, Volunteering, Cultural, Sports, Academic.
- **Notification permission** (explain the value before asking).
- Every step can be skipped and edited later in Profile → Interests.

### 4.2 Home — "What's happening at CUTM?"
Sections appear in this order and are hidden when empty:

| Section | Content | Rule |
|---|---|---|
| Greeting | "Good morning, {first name}" + campus | — |
| **Today** | The student's own events today, plus notable campus events today | Registered events first |
| **Closing soon** | Open events closing within 48 h that match eligibility | Sorted by deadline; live countdown |
| **Recommended for you** | Based on interests, followed clubs and history | "Why am I seeing this?" on each card |
| **From clubs you follow** | New events since the last visit | — |
| **This week** | Eligible published events in the next 7 days | — |
| **My week** | Mon–Sun strip of the student's registrations | Links to Calendar |
| **Announcements** | Important notices first | Dismissible except critical ones |

### 4.3 Discover and search
- **Global search** (in the header, on every screen) across Events, Clubs, Opportunities, Venues and People (organizer contacts only, subject to privacy settings).
- **Event filters:**
  - Type
  - Date: today, tomorrow, this week, this month, custom
  - Department
  - Eligibility: year/programme
  - Participation: individual, team, volunteer, audience
  - Fee: free or paid
  - Status: open, closing soon, full, closed
  - Location: venue, online, hybrid
- **"Eligible for me"** toggle, on by default.
- Filters live in the URL, so a filtered view can be shared or bookmarked. V1 already does this for the `?q=` search.

### 4.4 Event page
Section order: Hero → quick facts → registration panel → about → what you'll learn → requirements (bring) → eligibility → schedule → organizer → location → FAQ → results/gallery (after the event).

- **Quick facts:** date, time, venue, eligibility, fee, organizer, participation type.
- **Registration panel.** The primary action depends on derived state:

| State | Primary action |
|---|---|
| not open yet | "Opens {date}" + Notify me |
| open / closing soon | Register (countdown shown) |
| full | Join waitlist |
| waitlisted | "#{position} on waitlist" + Leave waitlist |
| offer pending | Confirm seat (countdown) |
| registered / confirmed | Already registered + View pass (V1 already has this state) |
| closed / cancelled / completed | Status message; results or recap if available |

- **Secondary actions:** Save, Share, Add to Calendar (V1 has these three), Open in Maps.
- **Change banner.** If the venue or time changed after the student registered, show "Changed on {date}: Auditorium → Convention Centre".

### 4.5 Registration flow
1. **You.** Pre-filled from the profile and read-only; contact fields editable.
2. **Participation.** Individual, or team: create a team, join with an invite code or link, or accept a pending invite.
3. **Event questions.** Custom fields defined by the organizer (text, choice, file upload).
4. **Documents**, if required. These can be submitted later, and the registration stays `pending` until approved.
5. **Payment**, if paid. Gateway handoff; the registration is confirmed on payment webhook, never on client redirect alone.
6. **Review and agree** to rules (required checkbox — in V1), then **Confirm**.

**Rules:**
- A student can have **one active registration per event**. V1 already blocks duplicates in the UI; V2 enforces it on the server.
- The seat check happens **atomically on the server**. The count shown in the browser is only for display.

### 4.6 Confirmation
- Shows "You're registered!", the event summary and the registration ID.
- The pass, with a QR code, is available straight away.
- **Actions:** Add to Calendar, Download/Save Pass, Share, View My Events.
- A **What's next** list tailored to the event: reminders are scheduled, what to bring, documents still pending.

### 4.7 My Events (personal dashboard)
**Tabs:** Today · Upcoming · Past · Saved · Applications (pending, waitlisted, team invites, documents needing action).

| Card context | Shows | Actions |
|---|---|---|
| Upcoming | Status chip (Confirmed / Pending / Waitlisted #n), date, venue | View event, Pass, Add to calendar, Cancel registration |
| Today | Time-ordered agenda | Pass, Navigate |
| Past | Attended / No-show | Rate event, Certificate, Photos, Results |
| Saved | Registration status of the event | Register, Remove |

**Cancelling:**
- Cancel asks for confirmation on the page itself.
- The event's own policy applies: a cut-off time, and a note about refunds for paid events.
- After cancelling, the freed seat goes to the waitlist.

### 4.8 Calendar
- **Views:** Month · Week · Day · Agenda. Agenda is the default on mobile.
- **Layers:** My events (bold) and eligible campus events (muted). Category filters.
- **Export:**
  - Single events (.ics, available in V1).
  - A personal **subscription feed** (a private webcal URL that can be revoked), so Google and Outlook calendars stay in sync.

### 4.9 Digital pass
- Shows the student's name, roll number, event, date/time, venue, registration ID and QR code.
- The QR code holds a **signed, non-guessable token**, never a plain ID (see §9.3). Scanning it shows the current status, so a cancelled registration can't be used to get in.
- **Works offline.** Once cached, the pass stays viewable without a connection.
- Updates automatically if the venue or time changes.

### 4.10 Notifications center
- **Categories:** Registrations · Reminders · Changes · Results · Certificates · Clubs · Announcements.
- **Controls:** mark all as read, filter by category, and deep links to the relevant screen.
- **Preferences** are set per category × channel (in-app, email, push, and later WhatsApp/SMS). Critical changes to registered events, such as a cancellation or venue change, can't be turned off.

### 4.11 Clubs
- **Directory:** search, and filter by category.
- **Club page:** About, Events, Announcements, Recruitment, Members (visibility controlled), Social links, Contact.
- **Follow / Unfollow.** Following adds the club's new events to the Home feed and to notifications.

### 4.12 Opportunities
Internships, scholarships, research positions, fellowships, external competitions and conferences.
- **Differences from events:** these may have no venue or time, only a deadline, and may link to an external application.
- **Shared with events:** they use the same card, save and deadline-reminder patterns.

### 4.13 Certificates
- **List:** event, date, issuer, certificate ID. Download as PDF.
- **Share link.** A public verification page at `/verify/{certificateId}` confirms the certificate is genuine and shows minimal information.

### 4.14 Profile
- **Identity:** from the university; read-only.
- **Interests:** editable.
- **Activity:** events attended, registrations, certificates, clubs, competitions.
- **Settings:** Notifications, Calendar integration, Privacy, Accessibility, Account.
- **Data export and account deletion requests** (see §9.2).

---

## 5. Organizer portal

| Screen | Purpose / key features |
|---|---|
| **Dashboard** | Your organizations; events by state; items needing action (changes requested, documents to review, offers expiring). |
| **Create / edit event** | Basic info (name, description, category, banner) → Schedule (date, time, sessions, registration open/close) → Venue (from the admin-managed list, online link, or hybrid) → Eligibility (departments, years, capacity) → Registration (individual/team with size limits, custom questions, required documents, fee, waitlist on/off, cancellation cut-off) → Certificates (rule: attendance or result; template) → **Preview as student** → Save draft / Submit. |
| **Approval status** | Timeline of the review; admin comments; resubmit. |
| **Event overview** | Registered / capacity, waitlist, checked-in, feedback count, average rating, registrations per day. |
| **Participants** | Search; filter by department, year, status, attendance, team; review documents; manual add/remove (with a reason, logged); CSV export. |
| **Teams** | Team list, members, completeness; lock at registration close. |
| **Communication** | Send an announcement to: all confirmed / team leaders / not checked in / waitlist. In-app + email. Every message is logged. |
| **Check-in** | Camera QR scanner (mobile browser); result shown as ✅ valid / ⚠️ already checked in / ❌ cancelled or not found; manual lookup by roll number; offline queue that syncs later; live counter. |
| **Results & certificates** | Enter winners (individual or team, ranked); publish results; generate certificates in bulk for eligible participants; revoke if needed. |
| **Feedback & analytics** | Ratings per dimension (content, speaker, organization, venue, registration experience), comments, trend against the organization's past events. |
| **Change / cancel event** | Edits to time or venue after publishing require a reason and automatically notify registrants (see §7.1). Cancelling needs admin confirmation if registrations exist. |

---

## 6. Admin portal

| Screen | Purpose / key features |
|---|---|
| **Dashboard** | Events this month, registrations, attendance rate, active clubs, pending approvals. |
| **Event approvals** | Queue of submitted events. For each one: preview, a venue clash check, an eligibility check, then Approve, Request changes (with comments) or Reject (with a reason). |
| **Clubs & organizations** | Create/approve clubs, assign organizer roles, deactivate. |
| **Users & roles** | Look up users, assign or revoke roles, audit history. |
| **Venues** | Venue list with capacity, map location, facilities; booking calendar to prevent double-booking. |
| **Categories & tags** | The controlled lists used for filters and recommendations. |
| **Announcements** | Institution-wide notices, sent to everyone or to selected groups (campus/department/year). |
| **Moderation** | Reported content, edits to published events, removing inappropriate material. |
| **Reports & analytics** | Participation by department, year and category; attendance vs registration; organizer performance; data export. |
| **Settings** | Academic calendar, blackout dates, default policies (waitlist offer window, cancellation cut-off), data retention. |

---

## 7. Cross-cutting systems

### 7.1 The connected lifecycle — what each action updates
This table is the contract that makes EventEase feel like a real platform. Each row should become an automated test.

| Trigger | Must update |
|---|---|
| Student registers | Registration created → seat count → My Events → Calendar/feed → reminders scheduled → pass issued → organizer participant list and analytics → confirmation notification |
| Student cancels | Registration cancelled → seat freed → waitlist offer → reminders removed → pass invalidated → organizer list |
| Event venue/time changed | Event page (change banner) → My Events → Calendar/feed → pass → reminders rescheduled → "Changes" notification to all confirmed and waitlisted students |
| Event cancelled | All registrations cancelled (refund flow if paid) → reminders removed → passes invalidated → critical notification |
| QR scanned at the door | Registration → `checked_in` → student sees "Checked in {time}" → live counter |
| Event ends | `checked_in` → `attended`, `confirmed` → `no_show` → certificate eligibility checked → feedback requested the next day |
| Certificate issued | Student notification → Past card and Profile activity → verification page live |
| Results published | Results tab on the event → notifications to participants → certificates for winners |
| Club publishes event | Followers notified (subject to preferences) → Home "From clubs you follow" |

### 7.2 Notification and reminder schedule
Default schedule. Students can turn any row off, except where marked critical.

| When | Message | Channel |
|---|---|---|
| On registration | "You're registered for {event}" + pass | In-app, email |
| 7 days before | "Your event is next week" | In-app |
| 1 day before | "{event} is tomorrow at {time}, {venue}. Bring: {requirements}" | In-app, push, email |
| 2 hours before | "{event} starts in 2 hours" + Navigate | Push |
| 24 h before deadline (saved or eligible events) | "Registration for {event} closes tomorrow" | In-app, push |
| On change | "⚠️ Venue changed: …" | All channels (**critical**) |
| On cancellation | "{event} has been cancelled" | All channels (**critical**) |
| Waitlist offer | "A seat opened. Confirm within {n} h" | All channels |
| Day after the event | "How was {event}?" | In-app, push |
| On certificate / result | "Your certificate is ready" / "Results are out" | In-app, email |

Reminders must be scheduled and sent by the **server**. Browser-only timers can't deliver them reliably.

### 7.3 Search
- A single index across Events, Clubs, Opportunities, Venues and organizer contacts.
- Tolerant of typos, with prefix matching.
- Only **published** content, with results limited by the viewer's eligibility.

### 7.4 Campus map and venues
- **Venues** are admin-managed records with coordinates. Events reference a venue; they never hold free text.
- **V2:** an "Open in Maps" deep link.
- **Later:** a campus map with building markers.

### 7.5 Recommendations (V4)
- **Start rule-based:** interests × category, followed clubs, eligibility, popularity with the student's department/year.
- **Consider ML only once there's data to learn from.**
- **Always** explain why each item is shown, and let students switch personalization off.

---

## 8. Data model

### 8.1 Entities and key fields
Types are indicative. `id`, `created_at` and `updated_at` are implied on every entity.

| Entity | Key fields |
|---|---|
| **User** | university_id (from SSO), name, email, phone, campus, school, department, programme, year, semester, roles[], status |
| **UserPreference** | user → interests[], opportunity_types[], notification matrix (category × channel), personalization_enabled, profile_visibility |
| **Organization** | type (club/department/cell), name, slug, description, logo, socials, contact, status |
| **OrganizationMember** | organization, user, role (lead/organizer/member/volunteer) |
| **Follow** | user, organization |
| **Venue** | name, building, campus, capacity, geo, facilities[], active |
| **EventCategory** | name, slug, parent |
| **Event** | organization, title, slug, summary, description, category, tags[], banner, venue / online_url / mode, starts_at, ends_at (timezone-aware), registration_opens_at, registration_closes_at, capacity, participation (individual/team/volunteer/audience), team_min, team_max, eligibility {departments[], years[], programmes[]}, fee_amount, waitlist_enabled, offer_window_hours, cancellation_cutoff, requirements[], learning_outcomes[], certificate_rule, status (see §3.3) |
| **EventSession** | event, title, starts_at, ends_at, speaker (the schedule) |
| **EventQuestion** | event, label, type (text/choice/file), options[], required |
| **EventChange** | event, field, old_value, new_value, reason, changed_by (feeds the change banner and notifications) |
| **ApprovalReview** | event, reviewer, decision, comments |
| **Registration** | event, user, team?, status (see §3.3), registration_code (public ID, e.g. CUTM-8F92KD), answers {}, source, cancelled_reason |
| **WaitlistEntry** | event, user/team, position, offer_expires_at, status |
| **Team** | event, name, leader, invite_code, status |
| **TeamMember** | team, user, status (invited/accepted/declined) |
| **Document** | registration, requirement, file_ref, status, reviewer, rejection_reason |
| **Payment** | registration, amount, currency, gateway_ref, status, receipt_ref |
| **CheckIn** | registration, scanned_at, scanned_by, method (qr/manual), device |
| **Certificate** | registration, certificate_code (public), template, issued_at, revoked_at, reason |
| **Result** | event, rank/position, registration or team, title (Winner / Runner-up) |
| **Feedback** | registration (attended only), overall, content, speaker, organization, venue, registration_experience, liked, improve, would_attend_again |
| **Announcement** | scope (institution/organization/event), audience filter, priority, title, body, author |
| **Notification** | user, category, title, body, deep_link, read_at, delivered_channels[] |
| **ScheduledJob** | type (reminder/offer_expiry/close_registration), target, run_at, status |
| **SavedItem** | user, event or opportunity |
| **Opportunity** | type, title, provider, deadline, eligibility, external_url, tags[] |
| **Media** | event, type (photo/video), file_ref, caption, visibility |
| **AuditLog** | actor, action, entity, before/after, at |

### 8.2 Relationships
```text
User ─< Registration >─ Event >─ Organization
User ─< TeamMember >─ Team >─ Event
User ─< Follow >─ Organization
User ─< OrganizationMember >─ Organization
User ─< Notification
User ─< SavedItem
Event ─ Venue
Event ─< EventSession
Event ─< EventQuestion
Event ─< EventChange
Event ─< ApprovalReview
Event ─< WaitlistEntry
Event ─< Result
Event ─< Media
Registration ─< Document
Registration ─ Payment
Registration ─ CheckIn
Registration ─ Certificate
Registration ─ Feedback
```

### 8.3 Invariants the system must enforce (server-side)
1. One active Registration per (event, user). A user can be on at most one Team per event.
2. Confirmed registrations ≤ capacity, checked **transactionally** so two last-seat clicks can't both succeed.
3. A registration is allowed only if the user matches the eligibility rules and the time is inside the registration window.
4. Feedback is allowed only for registrations with status `attended`, and only once each.
5. A Certificate needs an eligible registration under the event's `certificate_rule`.
6. Check-in is valid only for `confirmed` registrations of *that* event, inside the check-in window, and only once. A repeat scan reports "already checked in".
7. A venue can't be double-booked for overlapping published events. Admins can override, and the override is logged.
8. Every change to a published event's time or venue creates an EventChange and notifications.

---

## 9. Non-functional requirements

### 9.1 Identity
- **University SSO** only, so there are no EventEase passwords. The provider is an open question (§14).
- Profile data from the university is the source of truth, and students can't edit it.

### 9.2 Privacy and data protection
- Handle personal data in line with India's **Digital Personal Data Protection Act, 2023**: clear notice, collection limited to the purpose, and ways for students to see and correct their data or ask for it to be erased.
- **Organizers see only what they need:** name, roll number, department, year, and answers to their own questions. They never see phone numbers unless the event requires them and the student has been told.
- Profile visibility (for people search and member lists) is controlled by the student.
- A **data retention policy** is set by the university. Example: feedback is anonymized after N months.

### 9.3 Security
- The QR code carries a **signed token** (for example an HMAC over the registration and event), so it can't be guessed or forged. Status is re-checked on every scan.
- **Role checks on the server** for every write. Hiding a control in the UI is not access control.
- Rate-limit registration and search. File uploads are type- and size-limited and malware-scanned.
- An audit log covers admin and organizer actions on registrations, results and certificates.

### 9.4 Accessibility
- **WCAG 2.2 AA.** V1 already reaches Lighthouse Accessibility 100 on Home.
- Full keyboard support and screen-reader announcements for async states. The QR scanner must offer manual lookup as an alternative.

### 9.5 Performance and reliability
- **Mobile-first:** usable on 4G and a mid-range Android phone.
- **Registration opening spikes:** a popular event can get most of its registrations in the first few minutes. Seat allocation must stay correct under that concurrency (§8.3 invariant 2).
- **Check-in keeps working with a patchy connection.** Scans queue on the device and sync later; the server settles duplicates.
- Reminder delivery is at least once, with deduplication.

### 9.6 Platform
- Responsive web app first, installable as a PWA so there's a home-screen icon, push notifications, and an offline pass.
- Native apps are optional later, if push reliability or camera access in the browser prove insufficient.

---

## 10. Roadmap

Each phase has an **exit criterion**. The next phase starts only once it's met.

### V1 — Student MVP (make the prototype real)
- **Scope:**
  - SSO login and a real profile.
  - Events stored in a database, entered by admins at first.
  - Registration with server-enforced capacity and duplicate prevention.
  - My Events (Today / Upcoming / Past / Saved), Calendar, and in-app notifications.
  - Signed QR pass.
  - Basic admin screens to create and publish events.
- **Carried over from the prototype:** the entire student UX and component set (§11).
- **Exit criterion:** a pilot group of students across 2–3 real events registers, receives a confirmation and a pass, and sees correct My Events and Calendar entries. No registration is lost or duplicated.

### V2 — Event operations
- **Scope:**
  - Organizer portal: create, submit, approval workflow.
  - Participant management and CSV export.
  - QR check-in with an offline queue, and attendance.
  - Announcements to registrants and change propagation (§7.1).
  - Scheduled email reminders.
- **Exit criterion:** at least one real event runs **entirely** through EventEase, from creation through approval and registration to check-in and the attendance export, without a Google Form or a paper list.

### V3 — Student ecosystem
- **Scope:** clubs and following, teams, waitlist with offers, documents, feedback with dimensions, certificates plus the public verification page, results, opportunities, event photos/recap.
- **Exit criterion:** a team competition runs end to end (teams → waitlist → results → certificates), and certificates can be verified by anyone who has the link.

### V4 — Platform intelligence
- **Scope:**
  - Rule-based recommendations with explanations.
  - Organizer analytics (funnel: views → registrations → attendance → feedback).
  - Admin insights: participation by department and year, demand by category, no-show rates.
- **Exit criterion:** recommendations increase registrations from Home, measured against a control group, and organizers use analytics to plan events.

### V5 — Integrations
- **Scope:** push notifications, Google/Outlook calendar subscription, payment gateway with refunds, WhatsApp/SMS where the university approves, and integration with university records (for example, co-curricular credit).
- **Exit criterion:** paid events run with no manual reconciliation, and reminder open rates are tracked per channel.

### Dependency notes
- **Certificates (V3) depend on attendance (V2).**
- **Recommendations (V4) need V1–V3 data.** Building them earlier means guessing.
- **Waitlist (V3) depends on server-side capacity (V1) and scheduled jobs (V2).**
- **Payments (V5) change the registration state machine** (`pending` → `confirmed` on webhook). Design that state in V1, even though payments ship later.

---

## 11. From the V1 prototype to the product

The CX prototype in this repository has already validated the core student journey with users: **Discover → Event Details → Register → Confirmation → My Events → Calendar → Feedback**. It isn't thrown away. It becomes the UX baseline and the component library.

| V1 prototype (today) | Becomes in the product |
|---|---|
| `public/data/events.json` fetched via `eventService` | Events API. The service layer was written to swap `fetch('/data/events.json')` for a real endpoint without changing any page. |
| `EventType` (`src/types/event.ts`) | A subset of **Event**. Missing: organization, venue reference, timezone-aware `starts_at`/`ends_at` (V1 parses "09:00 AM – 05:00 PM" strings), eligibility rules, participation, fee, waitlist settings. |
| `UserEventsContext` + localStorage (`registrations`, `savedEventIds`) | **Registration** and **SavedItem** rows on the server, with the same concepts and a server source of truth. |
| `registrationService` (mocked async POST) | Registration API with server-side capacity, eligibility and duplicate checks. |
| Already Registered state / duplicate guard | Driven by Registration status from the API, with the full set of states in §4.4. |
| `isEventPast` (derived from the time string) | Server-side event status and scheduled `completed` transition. |
| `.ics` download | Kept for single events, plus a personal calendar subscription feed. |
| Web Share / clipboard | Kept as is. |
| Printable HTML pass with a decorative QR icon | Signed QR pass that works offline (§4.9). |
| Feedback form (single rating, not stored) | **Feedback** entity with dimensions, restricted to `attended` registrations. |
| `notifications.json` dropdown | Notification center with categories and preferences (§4.10). |
| Mock profile "Aarav Kumar" | SSO identity and UserPreference. |
| Demo-mode past-registration seed | Replaced by real history. Keep a seeded **staging** environment for demos and testing. |

**Also reused from V1:**
- The visual language and design tokens.
- The accessibility fixes (focus rings, live regions, contrast).
- The responsive layouts, tested at 375–1440px.
- The UX research artefacts: persona, journey map, user flow, wireframes.

---

## 12. Stack decision criteria (to research — not decided)

Any backend option (a managed backend-as-a-service, or a custom API with a database) should be evaluated against these requirements, taken from this document:

1. **SSO integration** with whatever identity provider CUTM uses (Google Workspace, Microsoft Entra ID, or a campus system).
2. **Relational data with transactions**, for seat allocation (§8.3 invariant 2) and the many relationships in §8.2.
3. **Row-level or role-scoped authorization**: student, organizer-of-org, admin (§2).
4. **Scheduled jobs / cron** for reminders, waitlist offer expiry, closing registration and completing events.
5. **Email delivery and web push.** WhatsApp/SMS later.
6. **File storage** with access control (documents, banners, certificates, photos).
7. **PDF generation** for certificates, on the server so the templates can be trusted.
8. **Realtime or polling** for live check-in counters.
9. **Data residency and compliance** questions for the university (§9.2).
10. **Cost at campus scale** (estimate with the university's actual student numbers) and whether student maintainers can run it after the original team graduates.

---

## 13. Success metrics

| Area | Metric |
|---|---|
| Adoption | Share of campus events published on EventEase; weekly active students |
| Discovery | Share of registrations coming from Home, Search and Recommendations, compared with direct links |
| Registration | Drop-off at each registration step; time to register |
| Reliability | Lost or duplicate registrations (target: 0); reminder delivery rate |
| Attendance | Check-in rate (attended ÷ confirmed); no-show rate by event type |
| Outcomes | Certificates issued within N days of the event |
| Feedback | Feedback response rate; average rating per organizer over time |
| Organizer value | Share of events run without an external form or paper list |
| Accessibility | WCAG 2.2 AA audit pass on all core flows |

---

## 14. Open questions for the university

1. Which identity provider does CUTM use, and can EventEase get name, roll number, department, year and campus from it?
2. Which campuses are in scope at launch? Is eligibility ever shared across campuses?
3. Who approves events: a central office, department heads, or a student affairs body? Is there more than one level of approval?
4. Are certificates from EventEase **official** (university-issued), or does each organizer issue its own? Who signs them?
5. Is there a policy on data retention and on which staff and organizers can see student data?
6. Are paid events in scope? Which payment gateway and refund policy apply?
7. Can EventEase send email from a university domain? Is WhatsApp/SMS allowed?
8. Should attendance feed into academic records (for example, co-curricular credits)?
9. Who runs the platform after launch: IT department, a student tech team, or a vendor?

---

## 15. Out of scope for now
- A general social network (student posts, chat, DMs).
- Ticket resale or transfer between students.
- Hosting livestreams for hybrid events. EventEase links to an external meeting URL instead.
- Tools for external event sponsors or vendors.
