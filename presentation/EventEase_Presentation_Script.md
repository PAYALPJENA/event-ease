# EventEase — Presentation & Demo Script

**Total time:** about 9–10 minutes of slides, then 5–6 minutes of live demo.
**Tone:** calm, confident, conversational. Don't read the slides: they hold the evidence, while you tell the story.
**Story in one line:** *Students miss campus events because information is scattered. I researched it, understood it, designed around it, and built EventEase.*

---

## Before you start (5 minutes earlier)

1. Open a terminal in the `eventease-platform` folder and run **`npm run dev`**.
2. Open **http://localhost:5173** in the browser. Make sure you're **signed out**, and zoom to about **110%** so the examiner can read it.
3. Keep the browser open in a second window, ready to switch to (Alt + Tab).
4. **Don't register Aarav for TechFest while rehearsing.** If you do, reset the database before presenting: run `npm run db:reset -w server -- --with-samples`, then `npm run dev` again.
5. In PowerPoint, check that the **slide 2 video plays on click** and that the sound is on.
6. Turn off phone and laptop notifications.

---

## SLIDE 1 — Cover (≈ 30 sec)

> Good morning, ma'am. I'm **Payal Priyadarshini Jena**, B.Tech Computer Science and Engineering. For Customer Experience Design and Programming, under the guidance of **Perween Rumana ma'am**, my project is **EventEase**, a student event discovery and registration platform for CUTM.
>
> I'd like to start with a 23-second video that shows the problem better than I can describe it.

*[Click → slide 2]*

---

## SLIDE 2 — The 23-second ad (≈ 40 sec including the video)

*[Click the video to play it. Let it finish. Don't talk over it.]*

> That's a situation most of us know: a forwarded message, a poster, an Instagram story, a form link, and by the time we piece it together, registration has closed.
>
> The video shows the idea. But in a CX course an idea isn't enough: I needed to know whether students actually experience this. So I started with the students.

*[Click → slide 3]*

---

## SLIDE 3 — Research methodology (≈ 1 min)

> Before designing anything, I wanted to understand the existing experience.
>
> I followed six steps: I **identified the problem**, **created a Google Form**, **shared it with students**, collected **22 responses**, **analyzed** them, and **extracted CX insights**.
>
> To be clear about the method: this was an **exploratory survey**, 22 responses, mostly from **second-year students**. It isn't statistically representative of the whole university, but it was enough to understand the experience and spot patterns.
>
> The survey looked at four parts of the journey: how students **discover** events, how they find **event information**, how they **register**, and how they **keep track** afterwards. On the right are the nine questions I asked.
>
> So what did the students tell me?

*[Click → slide 4]*

---

## SLIDE 4 — Research findings (≈ 1 min 30 sec)

> Four findings stood out. Each row of dots is the 22 students; the filled dots are the ones who said yes.
>
> **First:** 14 out of 22, that's **63.6%**, had **missed an event because they didn't know about it in time**. That's the core problem.
>
> **Second:** 15 out of 22, **68.2%**, frequently or sometimes had to **search through WhatsApp or other platforms** for event information or registration links.
>
> **Third:** the single biggest registration difficulty, chosen by 6 of 22, was **finding complete event information**.
>
> **Fourth:** when I asked what would help most, **complete event details** came top, at 45.5%, together with an **event calendar**, and **reminders** at 36.4%.
>
> *[Point to the bottom line]* So the research pointed clearly towards a **more centralized and structured event experience**.
>
> Numbers tell me *what* is happening. To design well, I also needed to know *who* I'm designing for.

*[Click → slide 5]*

---

## SLIDE 5 — Persona (≈ 1 min)

> This is **Aarav Kumar**, a 20-year-old CSE undergraduate at CUTM.
>
> Aarav is a **representative persona**. He isn't one specific respondent; he brings together the patterns from the survey.
>
> His **goals** are simple: discover relevant events, find complete information, register quickly, track what he's registered for, and not miss deadlines.
>
> His **pain points** come straight from the findings: fragmented information, finding out late, hard-to-find registration links, unclear deadlines and difficult tracking.
>
> He uses a smartphone and a laptop, is comfortable with digital platforms, and hears about events from many channels.
>
> In his own words: *"I want to know what's happening on campus without having to search everywhere."*
>
> Now, what does Aarav's experience actually look like today?

*[Click → slide 6]*

---

## SLIDE 6 — Customer journey map (≈ 1 min 30 sec)

> This is Aarav's **current journey**, in six stages. For each stage I mapped the touchpoint, what he does, the pain point, and how he feels.
>
> *[Move left to right; follow the emotion line with your hand]*
>
> He **discovers** an event through WhatsApp, Instagram, friends or a poster, so he's **curious but unsure** of the details.
> He **searches for information**, scrolling through old messages, and gets **frustrated**.
> He tries to **find the registration** link and the deadline, and this is the **lowest point**: anxious.
> He **registers** through a form, relieved, but **not sure it actually worked**.
> Afterwards, to **track the event**, he has to re-find the date, venue and requirements: **stressed** again.
> Only at the event itself does the experience become positive.
>
> *[Point to the bottom line]* The key insight: the friction isn't only at registration. It runs across the whole journey: **discovery, finding information, registration and tracking afterwards**.
>
> *(If asked about the emotions: "The emotions are my interpretation of the journey, based on the pain points from the survey.")*

*[Click → slide 7]*

---

## SLIDE 7 — Design opportunity (≈ 1 min 15 sec)

> This is the most important step: turning pain points into a design opportunity.
>
> *[Top row]* The **current experience**: discover, search multiple channels, find information, find the registration link, register, then search again and track manually.
>
> *[Bottom row]* The **designed experience**: discover, view complete details in one place, register, get a confirmation, save it to My Events, get a reminder, attend, and give feedback.
>
> That gave me one **design goal**: *create a centralized, low-friction experience for discovering, registering for and managing campus events.*
>
> *[Right side]* Every part of the design traces back to a research need: complete details became the **Event Details** page, the calendar became **Calendar**, reminders became **notifications**, registered events became **My Events**, and the event pass became a **QR pass**.
>
> So I didn't just add features: **each CX finding became a design requirement.**

*[Click → slide 8]*

---

## SLIDE 8 — From CX to UX (≈ 1 min)

> Next, I translated that future journey into the product itself.
>
> *[Left]* The **user flow** has three parts: **discover** (Home, Discover, Search and Filter), **understand and register** (Event Details, Register, Confirmation), and **manage and reflect** (My Events, reminders, attending, feedback).
>
> *[Right]* The **information architecture** organizes the platform into seven areas: Home, Explore, Calendar, Clubs, Opportunities, My Events and Profile.
>
> So the CX journey shaped both **how students move through the platform** and **how it's organized**.

*[Click → slide 9]*

---

## SLIDE 9 — Conclusion & future scope (≈ 1 min 15 sec)

> To bring it together: I went from **research**, to **CX insights**, to **user-centered design**, to a **functional prototype**.
>
> Looking ahead, four areas would take EventEase towards a real product:
> 1. **Production authentication**: university-approved single sign-on.
> 2. **Event operations**: approvals, check-in, attendance and tools for organizers.
> 3. The **student ecosystem**: clubs, teams, competitions and certificates in one place.
> 4. **Intelligence and integration**: analytics, personalization, and integration with university systems.
>
> I want to be clear about the **current status**: it's a **functional academic prototype**, and it is **not deployed at CUTM**.
>
> In one line: *EventEase turns "Where did I find that event?" into "Everything I need is here."*
>
> Thank you, ma'am. I'd be happy to show you the prototype.

*[When ma'am asks for the prototype: click → slide 10]*

---

## SLIDE 10 — Live prototype (bridge, ≈ 20 sec)

> I'll demonstrate it as one story: **let's imagine Aarav has just heard about an event.** He'll discover it, understand it, register, confirm, manage it, track it, and finally give feedback.

*[Switch to the browser (Alt + Tab)]*

---

# LIVE DEMO (≈ 5–6 min)

Narrate **what Aarav is doing and why it matters**, not just which button you're clicking. After each step, link it back to a pain point.

### 0. Sign in (≈ 20 sec)
- Click **Sign in** and choose **Aarav Kumar**.
> In this prototype, sign-in uses a demo account picker. In production this would be the university's single sign-on, which is in my future scope.

### 1. Home (≈ 30 sec)
- Show **Recommended for you**. Click **"Why am I seeing this?"** on one card.
> The home page already shows events relevant to Aarav, and it explains *why* it's recommending each one. No guessing.

### 2. Discover: Explore & search (≈ 40 sec)
- Click **Explore Events**. Click the **Technical** category, or type **"tech"** in the search box.
> Instead of searching WhatsApp, Aarav searches and filters in one place. *(This answers finding 2: 15 of 22 students searching chats.)*
- *(Optional, 10 sec)* Point to a real CUTM event card that shows "Time to be announced" or "Not specified".
> For real CUTM events, the platform only shows what was officially announced. If a detail isn't known, it says so, instead of guessing.

### 3. Understand: Event details (≈ 45 sec)
- Open **CUTM TechFest 2026**.
> Everything Aarav needs is on one page: date and time, venue, who can participate, the fee, seats left, what to bring, and the organizer contact. And there's a **countdown to the registration deadline**. *(This answers finding 3, complete event information, and the deadline pain point.)*
- Click **Save** (bookmark).

### 4. Register (≈ 40 sec)
- Click **Register Now**.
> His university details are filled in automatically, so the form stays short. He only adds a phone number.
- Type a phone number (e.g. **98765 43210**), tick **I agree**, and click **Complete Registration**.

### 5. Confirm: Confirmation & QR pass (≈ 30 sec)
> Now there's no doubt it worked: **"You're registered!"**, a registration ID, and a **QR event pass** to show at the venue. *(This answers the "unsure the registration worked" pain point.)*
- Point to **Download Pass** and **Add to Calendar**.

### 6. Save & manage: My Events (≈ 30 sec)
- Click **View My Events**.
> All his registrations are in one place, under **Upcoming Registrations**. *(Optional: open the **Saved** tab.)*
- Click the **bell** icon to show the registration confirmation notification.

### 7. Track: Calendar (≈ 20 sec)
- Click **Calendar**.
> TechFest now appears on **15 October**, highlighted because he's registered. No more re-finding dates in old chats.

### 8. Reflect: Feedback (≈ 40 sec)
- Go to **My Events → Past Events**. On **AI & Machine Learning Workshop**, click **Rate this Event**, give stars and a short comment, and submit.
> After attending, students can give feedback, which closes the loop for organizers. And because Aarav attended, he also has a **certificate**. *(Optional: click **Certificate**.)*

### 9. Close the demo (≈ 15 sec)
> So that's the full journey we mapped: discover, understand, register, confirm, manage, track and reflect, all in one place. That's how EventEase answers the problems the students told me about. Thank you, ma'am.

### If there's time: organizer view (≈ 1 min)
- Sign out, sign in as **Rahul Sharma**, then click **Organizer**.
> Organizers can create events, see participants, run check-in at the door by scanning QR passes, and view analytics. The same experience thinking applies on their side too.

---

## If something goes wrong
- **Page won't load:** check that the terminal is still running `npm run dev`, then refresh.
- **TechFest says "Already registered":** you registered during rehearsal. Show the existing confirmation through **View My Pass** instead and carry on.
- **You lose your place:** come back to the story line, *"Let's imagine Aarav has just heard about an event"*, and continue from the next step.

---

## Likely questions — short, honest answers

**Why only 22 responses?**
> It was an exploratory survey within the course timeline. It isn't representative of all of CUTM, but it was enough to identify clear patterns. A larger survey and user testing would be the next step.

**Is Aarav a real student?**
> No. He's a representative persona synthesized from the survey patterns, a standard CX tool for designing around a realistic user.

**How is this different from just using Google Forms?**
> A form handles one step: registration. EventEase covers the whole journey: discovering the event, complete information, registration with a confirmation and QR pass, tracking, reminders and feedback.

**Is it live at CUTM?**
> No. It's a functional academic prototype. Using it for real would need university approval, single sign-on and proper infrastructure.

**What did you build it with?**
> The front end is React with TypeScript and Tailwind CSS; the back end is a Node.js API (Hono) with a SQLite database. It has automated server tests.

**What about accessibility?**
> I followed accessibility basics throughout: keyboard navigation, visible focus, readable contrast, and labels for screen readers.

**What would you improve next?**
> Usability testing with real students on the prototype, a larger survey, and then the production steps: single sign-on, real notifications and university integration.
