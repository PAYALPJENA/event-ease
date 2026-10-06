import type { Transaction } from 'kysely';
import { newId, newRegistrationCode } from '../lib/ids.ts';
import type { Database, EventType, RegistrationStatus } from './types.ts';

/**
 * FICTIONAL SAMPLE DATA, for demos and the automated tests. Every event here
 * is flagged `is_sample` and labelled "Sample" in the app; none of it
 * describes a real CUTM event. Real, source-based events are in seed-cutm.ts.
 *
 * Loaded by the tests, and in development with `npm run db:reset -w server -- --with-samples`.
 * It exercises every feature: a live event to check in to (e8, an hour after
 * seeding), a paid event with a document and questions (e9), a full event with
 * a waitlist (e10), hackathon teams (e5), a finished workshop with attendance,
 * feedback and certificates (e2), a draft (e6), an event awaiting approval
 * (e7), clubs, follows and opportunities.
 */

const SEEDED_AT = '2026-08-01T00:00:00.000Z';

/** IST wall-clock time → UTC ISO string. */
const ist = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`).toISOString();

const ORGANIZATIONS = [
  {
    id: 'org-tech-club', type: 'club' as const, name: 'CUTM Tech Club', slug: 'tech-club', contact_email: 'rahul.s@cutm.ac.in',
    description: 'Talks, build nights and TechFest — the club for anyone who likes making things with technology.',
    social_links: { instagram: 'https://instagram.com/', website: 'https://cutm.ac.in/' },
    recruitment: 'We’re looking for design and event-management volunteers for TechFest 2026. Talk to Rahul at any club event.',
  },
  {
    id: 'org-cse', type: 'department' as const, name: 'Department of Computer Science', slug: 'cse', contact_email: 'anita.d@cutm.ac.in',
    description: 'Workshops, guest lectures and research seminars from the Department of Computer Science and Engineering.',
    social_links: { website: 'https://cutm.ac.in/' },
    recruitment: null,
  },
  {
    id: 'org-cultural', type: 'club' as const, name: 'Cultural Society', slug: 'cultural-society', contact_email: 'cultural@cutm.ac.in',
    description: 'Music, dance and drama at CUTM. We run Cultural Night and the inter-department fests.',
    social_links: { instagram: 'https://instagram.com/' },
    recruitment: 'Auditions for Cultural Night open soon — singers, dancers and stage crew welcome.',
  },
  {
    id: 'org-sports', type: 'club' as const, name: 'Sports Club', slug: 'sports-club', contact_email: 'sports@cutm.ac.in',
    description: 'Inter-department tournaments and practice sessions across basketball, football, cricket and athletics.',
    social_links: {},
    recruitment: null,
  },
  {
    id: 'org-coding', type: 'club' as const, name: 'Coding Club', slug: 'coding-club', contact_email: 'hackathon@cutm.ac.in',
    description: 'Competitive programming, hackathons and mentorship from alumni working in industry.',
    social_links: { linkedin: 'https://linkedin.com/', website: 'https://cutm.ac.in/' },
    recruitment: null,
  },
];

const campusMaps = 'https://www.google.com/maps/search/?api=1&query=Centurion+University+Bhubaneswar';
const VENUES = [
  { id: 'ven-cse-seminar', name: 'Seminar Hall, Dept. of Computer Science', capacity: 80 },
  { id: 'ven-oat', name: 'Open Air Theatre, CUTM', capacity: 600 },
  { id: 'ven-sports', name: 'Sports Complex', capacity: 300 },
  { id: 'ven-innovation-lab', name: 'Innovation Lab', capacity: 60 },
  { id: 'ven-auditorium', name: 'Auditorium, Block A', capacity: 250 },
].map(v => ({ ...v, campus: 'Bhubaneswar', maps_url: campusMaps }));

const MEMBERSHIPS = [
  { organization_id: 'org-tech-club', user_id: 'usr-rahul', role: 'lead' as const },
  { organization_id: 'org-coding', user_id: 'usr-rahul', role: 'organizer' as const },
  { organization_id: 'org-cse', user_id: 'usr-anita', role: 'lead' as const },
];

const unsplash = (id: string) => `https://images.unsplash.com/${id}?ixlib=rb-4.0.3&auto=format&fit=crop&w=1000&q=80`;

const EVENTS = [
  {
    id: 'e1', slug: 'cutm-techfest-2026', organization_id: 'org-tech-club', category_id: 'cat-technical', venue_id: 'ven-main-campus',
    title: 'CUTM TechFest 2026',
    description: 'The biggest technical festival of the year! Join us for a 2-day extravaganza of coding, robotics, and innovation.',
    image: unsplash('photo-1540575467063-178a50c2df87'),
    starts_at: ist('2026-10-15', '09:00'), ends_at: ist('2026-10-15', '17:00'),
    registration_opens_at: ist('2026-08-15', '09:00'), registration_closes_at: ist('2026-10-10', '23:59'),
    capacity: 200, taken: 150, eligibility_text: 'All CUTM students', eligible_departments: null, eligible_years: null,
    requirements: ['College ID Card'], contact_person: 'Rahul Sharma', contact_email: 'rahul.s@cutm.ac.in', is_featured: 1,
  },
  {
    id: 'e2', slug: 'ai-ml-workshop', organization_id: 'org-cse', category_id: 'cat-workshop', venue_id: 'ven-cse-seminar',
    title: 'AI & Machine Learning Workshop',
    description: 'Learn the fundamentals of Artificial Intelligence and Machine Learning in this hands-on workshop led by industry experts.',
    image: unsplash('photo-1485827404703-89b55fcc595e'),
    starts_at: ist('2026-09-12', '10:00'), ends_at: ist('2026-09-12', '16:00'),
    registration_opens_at: ist('2026-08-20', '09:00'), registration_closes_at: ist('2026-09-10', '12:00'),
    capacity: 60, taken: 45, eligibility_text: 'B.Tech CSE 2nd & 3rd Year', eligible_departments: ['CSE'], eligible_years: [2, 3],
    requirements: ['Laptop', 'Basic Python knowledge'], contact_person: 'Dr. Anita Desai', contact_email: 'anita.d@cutm.ac.in', is_featured: 0,
  },
  {
    id: 'e3', slug: 'cultural-night-2026', organization_id: 'org-cultural', category_id: 'cat-cultural', venue_id: 'ven-oat',
    title: 'Cultural Night 2026',
    description: 'A night filled with music, dance, and drama performances by the talented students of CUTM.',
    image: unsplash('photo-1514525253161-7a46d19cd819'),
    starts_at: ist('2026-11-20', '18:00'), ends_at: ist('2026-11-20', '22:00'),
    registration_opens_at: ist('2026-09-01', '09:00'), registration_closes_at: ist('2026-11-18', '23:59'),
    capacity: 500, taken: 350, eligibility_text: 'All CUTM students and faculty', eligible_departments: null, eligible_years: null,
    requirements: ['Valid CUTM ID'], contact_person: 'Sneha Patel', contact_email: 'cultural@cutm.ac.in', is_featured: 1,
  },
  {
    id: 'e4', slug: 'basketball-championship', organization_id: 'org-sports', category_id: 'cat-sports', venue_id: 'ven-sports',
    title: 'Basketball Championship',
    description: 'Inter-departmental basketball tournament. Form your team and compete for the CUTM Sports Trophy!',
    image: unsplash('photo-1546519638-68e109498ffc'),
    starts_at: ist('2026-09-25', '16:00'), ends_at: ist('2026-09-25', '19:00'),
    registration_opens_at: ist('2026-08-25', '09:00'), registration_closes_at: ist('2026-09-20', '23:59'),
    capacity: 16, taken: 12, eligibility_text: 'All CUTM students', eligible_departments: null, eligible_years: null,
    requirements: ['Sports attire', 'Team of 5-7 players'], contact_person: 'Vikram Singh', contact_email: 'sports@cutm.ac.in', is_featured: 0,
  },
  {
    id: 'e5', slug: 'hackathon-bhubaneswar', organization_id: 'org-coding', category_id: 'cat-competitions', venue_id: 'ven-innovation-lab',
    title: 'Hackathon Bhubaneswar',
    description: 'A 24-hour coding marathon to solve real-world problems. Great prizes to be won!',
    image: unsplash('photo-1504384308090-c894fdcc538d'),
    starts_at: ist('2026-10-05', '10:00'), ends_at: ist('2026-10-06', '10:00'),
    registration_opens_at: ist('2026-09-01', '09:00'), registration_closes_at: ist('2026-10-01', '23:59'),
    capacity: 30, taken: 20, eligibility_text: 'All tech enthusiasts', eligible_departments: null, eligible_years: null,
    requirements: ['Laptop', 'Charger', 'Team of 2-4 members'], contact_person: 'Priya Mishra', contact_email: 'hackathon@cutm.ac.in', is_featured: 0,
  },
];

/** A paid event (₹150) with a required document and registration questions (V3 documents, V5 payments). */
const PAID_EVENT = {
  id: 'e9', slug: 'startup-pitch-night', organization_id: 'org-tech-club', category_id: 'cat-competitions', venue_id: 'ven-auditorium',
  title: 'Startup Pitch Night',
  description: 'Pitch your startup idea to alumni founders and investors in three minutes. The best three pitches win mentorship and incubation support.',
  image: unsplash('photo-1556761175-5973dc0f32e7'),
  starts_at: ist('2026-10-28', '18:00'), ends_at: ist('2026-10-28', '21:00'),
  registration_opens_at: ist('2026-09-10', '09:00'), registration_closes_at: ist('2026-10-25', '23:59'),
  capacity: 80, taken: 12, eligibility_text: 'All CUTM students', eligible_departments: null, eligible_years: null,
  requirements: ['A three-minute pitch', 'College ID Card'], contact_person: 'Rahul Sharma', contact_email: 'rahul.s@cutm.ac.in', is_featured: 1,
};

/** Full, with a waitlist, so "Join waitlist" and seat offers can be tried. */
const FULL_EVENT = {
  id: 'e10', slug: 'alumni-mentorship-circle', organization_id: 'org-coding', category_id: 'cat-workshop', venue_id: 'ven-cse-seminar',
  title: 'Alumni Mentorship Circle',
  description: 'A small-group session with alumni engineers: career paths, interview preparation and honest answers to your questions.',
  image: unsplash('photo-1522202176988-66273c2fd55f'),
  starts_at: ist('2026-10-12', '16:00'), ends_at: ist('2026-10-12', '18:00'),
  registration_opens_at: ist('2026-09-15', '09:00'), registration_closes_at: ist('2026-10-10', '23:59'),
  capacity: 10, taken: 10, eligibility_text: 'All CUTM students', eligible_departments: null, eligible_years: null,
  requirements: ['Questions for the mentors'], contact_person: 'Coding Club', contact_email: 'hackathon@cutm.ac.in', is_featured: 0,
};

const SAMPLE_TYPES: Record<string, EventType> = {
  e1: 'fest', e2: 'workshop', e3: 'cultural', e4: 'sports', e5: 'competition',
  e6: 'workshop', e7: 'workshop', e8: 'talk', e9: 'competition', e10: 'talk',
};

/** V3/V5 options per event; everything else uses the defaults. */
const EVENT_DEFAULTS = {
  participation: 'individual' as 'individual' | 'team',
  team_min: null as number | null,
  team_max: null as number | null,
  waitlist_enabled: 1,
  offer_window_hours: 12,
  questions: '[]',
  required_documents: '[]',
  cancellation_cutoff_hours: null as number | null,
  certificate_rule: 'none' as 'none' | 'attendance' | 'winners' | 'attendance_and_winners',
  recap: null as string | null,
  gallery: '[]',
  results_published_at: null as string | null,
  fee_amount: 0 as number | null,
  tags: '[]',
  time_tbd: 0,
  registration_mode: 'eventease' as const,
  source_note: null as string | null,
  is_sample: 1,
};
const EVENT_OPTIONS: Record<string, Partial<typeof EVENT_DEFAULTS>> = {
  e2: {
    certificate_rule: 'attendance',
    recap: '52 students built their first image classifier. Slides and notebooks are on the department drive; thanks to our speakers from industry!',
    gallery: JSON.stringify([unsplash('photo-1485827404703-89b55fcc595e'), unsplash('photo-1531482615713-2afd69097998')]),
  },
  e5: { participation: 'team', team_min: 2, team_max: 4, certificate_rule: 'attendance_and_winners' },
  e9: {
    fee_amount: 15000,
    cancellation_cutoff_hours: 48,
    certificate_rule: 'winners',
    required_documents: JSON.stringify([{ id: 'id-card', label: 'College ID card (photo or PDF)' }]),
    questions: JSON.stringify([
      { id: 'stage', label: 'What stage is your startup idea at?', type: 'choice', options: ['Just an idea', 'Prototype', 'Launched'], required: true },
      { id: 'pitch', label: 'Your idea in one line', type: 'text', required: false },
    ]),
  },
  e10: { offer_window_hours: 12 },
};

const HACKATHON_TEAMS = ['Byte Busters', 'Null Pointers', 'Stack Smashers', 'Quantum Coders', 'Tab Warriors'];

const OPPORTUNITIES = [
  {
    id: 'opp-1', type: 'internship' as const, title: 'Summer Research Internship in Machine Learning', provider: 'IIT Bhubaneswar',
    description: 'An eight-week research internship in the ML lab. Stipend provided. Suited to students comfortable with Python and linear algebra.',
    deadline: ist('2026-10-20', '23:59'), eligibility_text: 'B.Tech CSE/ECE, 3rd year', eligible_departments: JSON.stringify(['CSE', 'ECE']), eligible_years: JSON.stringify([3]),
    external_url: 'https://www.iitbbs.ac.in/', tags: JSON.stringify(['AI/ML', 'Research', 'Paid']), organization_id: 'org-cse',
  },
  {
    id: 'opp-2', type: 'scholarship' as const, title: 'Women in Tech Scholarship 2026', provider: 'CUTM Foundation',
    description: 'Covers one semester of tuition for women students in engineering programmes with strong academic records.',
    deadline: ist('2026-10-05', '17:00'), eligibility_text: 'All B.Tech students', eligible_departments: JSON.stringify(['CSE', 'ECE', 'ME', 'CE']), eligible_years: null,
    external_url: null, tags: JSON.stringify(['Scholarship']), organization_id: null,
  },
  {
    id: 'opp-3', type: 'competition' as const, title: 'Smart India Hackathon — internal selection', provider: 'Government of India',
    description: 'Teams selected at CUTM go on to the national Smart India Hackathon. Register your team with the Coding Club.',
    deadline: ist('2026-11-10', '23:59'), eligibility_text: 'All CUTM students', eligible_departments: null, eligible_years: null,
    external_url: 'https://www.sih.gov.in/', tags: JSON.stringify(['Hackathon', 'Teams']), organization_id: 'org-coding',
  },
];

/** An unpublished draft, so the admin screens have something to publish. */
const DRAFT_EVENT = {
  id: 'e6', slug: 'git-and-github-bootcamp', organization_id: 'org-tech-club', category_id: 'cat-workshop', venue_id: 'ven-innovation-lab',
  title: 'Git & GitHub Bootcamp',
  description: 'A beginner-friendly, hands-on session on version control: commits, branches, pull requests and collaborating on GitHub.',
  image: unsplash('photo-1556075798-4825dfaaf498'),
  starts_at: ist('2026-10-22', '14:00'), ends_at: ist('2026-10-22', '17:00'),
  registration_opens_at: ist('2026-09-25', '09:00'), registration_closes_at: ist('2026-10-20', '23:59'),
  capacity: 50, taken: 0, eligibility_text: 'All CUTM students', eligible_departments: null, eligible_years: null,
  requirements: ['Laptop with Git installed'], contact_person: 'Rahul Sharma', contact_email: 'rahul.s@cutm.ac.in', is_featured: 0,
};

/** Submitted by the CSE department and waiting in the admin approval queue. */
const PENDING_EVENT = {
  id: 'e7', slug: 'cloud-computing-fundamentals', organization_id: 'org-cse', category_id: 'cat-workshop', venue_id: 'ven-cse-seminar',
  title: 'Cloud Computing Fundamentals',
  description: 'An introduction to cloud platforms: virtual machines, storage, serverless functions and deploying your first app.',
  image: unsplash('photo-1451187580459-43490279c0fa'),
  starts_at: ist('2026-11-05', '10:00'), ends_at: ist('2026-11-05', '13:00'),
  registration_opens_at: ist('2026-10-01', '09:00'), registration_closes_at: ist('2026-11-03', '23:59'),
  capacity: 70, taken: 0, eligibility_text: 'B.Tech CSE, all years', eligible_departments: ['CSE'], eligible_years: null,
  requirements: ['Laptop'], contact_person: 'Dr. Anita Desai', contact_email: 'anita.d@cutm.ac.in', is_featured: 0,
};

/** Starts an hour after seeding, so the check-in screen has something to scan. */
const liveEvent = (now: Date) => {
  const at = (offsetHours: number) => new Date(now.getTime() + offsetHours * 3600_000).toISOString();
  return {
    id: 'e8', slug: 'tech-talk-building-for-the-web', organization_id: 'org-tech-club', category_id: 'cat-technical', venue_id: 'ven-auditorium',
    title: 'Tech Talk: Building for the Web',
    description: 'Alumni engineers share how they build and ship web apps at scale, followed by an open Q&A. Check-in opens two hours before the start.',
    image: unsplash('photo-1505373877841-8d25f7d46678'),
    starts_at: at(1), ends_at: at(4),
    registration_opens_at: at(-24 * 7), registration_closes_at: at(0.5),
    capacity: 120, taken: 25, eligibility_text: 'All CUTM students', eligible_departments: null, eligible_years: null,
    requirements: ['College ID Card'], contact_person: 'Rahul Sharma', contact_email: 'rahul.s@cutm.ac.in', is_featured: 0,
  };
};

/** A door scan a few minutes before the start, by the organizer. */
const checkInRow = (registrationId: string, eventId: string, startsAt: string, i: number) => {
  const scannedAt = new Date(new Date(startsAt).getTime() - (20 - (i % 20)) * 60_000).toISOString();
  return { id: newId(), registration_id: registrationId, event_id: eventId, scanned_at: scannedAt, recorded_at: scannedAt, scanned_by: 'usr-anita', method: 'qr' as const, device: 'Seminar Hall door' };
};

const DEPARTMENTS = ['CSE', 'ECE', 'ME', 'CE', 'BBA'];

/** `now` places the live sample event (e8); tests pass their fixed clock. */
export const seedSamples = async (trx: Transaction<Database>, now: Date) => {
  const LIVE_EVENT = liveEvent(now);
  {
    await trx
      .insertInto('organizations')
      .values(ORGANIZATIONS.map(o => ({ ...o, social_links: JSON.stringify(o.social_links), logo_url: null, status: 'active' as const, created_at: SEEDED_AT })))
      .execute();
    await trx.insertInto('venues').values(VENUES).execute();
    await trx.insertInto('organization_members').values(MEMBERSHIPS).execute();

    // Bulk students whose only job is to fill the seats the prototype showed as taken.
    // Hidden from the development sign-in picker (university_id starts with GEN).
    const generated = Array.from({ length: 500 }, (_, i) => {
      const n = String(i + 1).padStart(4, '0');
      return {
        id: `usr-gen-${n}`,
        university_id: `GEN${n}`,
        name: `Sample Student ${n}`,
        email: `sample.${n}@students.example`,
        phone: null,
        campus: 'Bhubaneswar',
        school: null,
        department: DEPARTMENTS[i % DEPARTMENTS.length],
        programme: 'B.Tech',
        year: (i % 4) + 1,
        semester: ((i % 4) + 1) * 2 - 1,
        roles: JSON.stringify(['student']),
        status: 'active' as const,
        created_at: SEEDED_AT,
      };
    });
    for (let i = 0; i < generated.length; i += 100) {
      await trx.insertInto('users').values(generated.slice(i, i + 100)).execute();
    }

    const statusOf = (id: string) => (id === DRAFT_EVENT.id ? 'draft' : id === PENDING_EVENT.id ? 'pending_approval' : 'published');
    const creatorOf = (id: string) => (id === DRAFT_EVENT.id || id === LIVE_EVENT.id ? 'usr-rahul' : id === PENDING_EVENT.id ? 'usr-anita' : 'usr-admin');

    for (const { taken, eligible_departments, eligible_years, requirements, ...e } of [...EVENTS, PAID_EVENT, FULL_EVENT, DRAFT_EVENT, PENDING_EVENT, LIVE_EVENT]) {
      const status = statusOf(e.id);
      await trx
        .insertInto('events')
        .values({
          ...e,
          summary: null,
          mode: 'in_person',
          online_url: null,
          eligible_departments: eligible_departments ? JSON.stringify(eligible_departments) : null,
          eligible_years: eligible_years ? JSON.stringify(eligible_years) : null,
          requirements: JSON.stringify(requirements),
          status,
          created_by: creatorOf(e.id),
          created_at: SEEDED_AT,
          updated_at: SEEDED_AT,
          published_at: status === 'published' ? SEEDED_AT : null,
          cancel_requested_at: null,
          cancel_requested_by: null,
          cancel_request_reason: null,
          ...EVENT_DEFAULTS,
          ...EVENT_OPTIONS[e.id],
          event_type: SAMPLE_TYPES[e.id],
        })
        .execute();

      // Fill seats with eligible generated students.
      const pool = generated.filter(
        u => (!eligible_departments || eligible_departments.includes(u.department)) && (!eligible_years || eligible_years.includes(u.year))
      );
      const regs = pool.slice(0, taken).map(u => ({
        id: newId(),
        event_id: e.id,
        user_id: u.id,
        status: 'confirmed' as RegistrationStatus,
        registration_code: newRegistrationCode(),
        phone: null,
        created_at: e.registration_opens_at,
        cancelled_at: null,
        cancel_reason: null,
        source: 'self' as const,
        team_id: null as string | null,
        answers: null as string | null,
        offer_expires_at: null,
        payment_due_at: null,
      }));

      // The hackathon is a team event: seat-holders are already in teams of four.
      if (e.id === 'e5') {
        for (let t = 0; t * 4 < regs.length; t++) {
          const members = regs.slice(t * 4, t * 4 + 4);
          const teamId = `team-e5-${t + 1}`;
          await trx
            .insertInto('teams')
            .values({ id: teamId, event_id: 'e5', name: HACKATHON_TEAMS[t], leader_id: members[0].user_id, invite_code: `TEAM-HACK${t + 1}`, status: 'complete', created_at: e.registration_opens_at })
            .execute();
          for (const m of members) m.team_id = teamId;
        }
      }
      if (e.id === 'e9') for (const [i, r] of regs.entries()) r.answers = JSON.stringify({ stage: ['Just an idea', 'Prototype', 'Launched'][i % 3] });

      // The AI & ML Workshop has happened: most registrants were checked in at the door.
      const checkIns = [];
      if (e.id === 'e2') {
        for (const [i, r] of regs.entries()) {
          const attended = i % 9 !== 0;
          r.status = attended ? 'attended' : 'no_show';
          if (attended) checkIns.push(checkInRow(r.id, 'e2', e.starts_at, i));
        }
      }
      for (let i = 0; i < regs.length; i += 100) {
        await trx.insertInto('registrations').values(regs.slice(i, i + 100)).execute();
      }
      if (checkIns.length) await trx.insertInto('check_ins').values(checkIns).execute();

      // Paid seats have captured payments from the (mock) gateway.
      if (e.id === 'e9') {
        await trx
          .insertInto('payments')
          .values(regs.map((r, i) => ({
            id: newId(), registration_id: r.id, amount: 15000, currency: 'INR' as const, gateway: 'mock',
            gateway_order_id: `order_seed${i}`, gateway_payment_id: `pay_seed${i}`, status: 'paid' as const,
            created_at: r.created_at, paid_at: r.created_at, refunded_at: null, refund_ref: null,
          })))
          .execute();
      }

      // The mentorship circle is full; two more students are waiting.
      if (e.id === 'e10') {
        const waiting = pool.slice(taken, taken + 2).map((u, i) => ({
          ...regs[0], id: newId(), user_id: u.id, status: 'waitlisted' as RegistrationStatus, registration_code: newRegistrationCode(),
          created_at: new Date(new Date(e.registration_opens_at).getTime() + (i + 1) * 3600_000).toISOString(),
        }));
        await trx.insertInto('registrations').values(waiting).execute();
      }

      // The workshop's attendees have feedback and certificates.
      if (e.id === 'e2') {
        const attendedRegs = regs.filter(r => r.status === 'attended');
        await trx
          .insertInto('feedback')
          .values(attendedRegs.slice(0, 20).map((r, i) => ({
            id: newId(), registration_id: r.id, rating: 4 + (i % 2), comment: i % 2 ? 'Loved the hands-on part.' : 'Great speakers, a little rushed at the end.',
            created_at: e.ends_at, content_rating: 4 + (i % 2), speaker_rating: 5, organization_rating: 4, venue_rating: 3 + (i % 3 === 0 ? 1 : 0),
            registration_rating: 5, would_attend_again: i % 5 === 0 ? 0 : 1,
          })))
          .execute();
        await trx
          .insertInto('certificates')
          .values(attendedRegs.map((r, i) => ({
            id: newId(), code: `CERT-SEED${String(i).padStart(4, '0')}`, registration_id: r.id, kind: 'participation' as const,
            title: `Certificate of Participation — ${e.title}`, issued_at: '2026-09-14T05:00:00.000Z', issued_by: 'usr-anita', revoked_at: null, revoke_reason: null,
          })))
          .execute();
      }
    }

    await trx.insertInto('opportunities').values(OPPORTUNITIES.map(o => ({ ...o, created_by: 'usr-admin', status: 'published' as const, created_at: SEEDED_AT }))).execute();

    // Aarav follows two clubs and likes technical events and competitions, so Home has recommendations.
    await trx
      .insertInto('follows')
      .values([
        { user_id: 'usr-aarav', organization_id: 'org-tech-club', created_at: SEEDED_AT },
        { user_id: 'usr-aarav', organization_id: 'org-coding', created_at: SEEDED_AT },
      ])
      .execute();
    await trx
      .insertInto('user_preferences')
      .values({ user_id: 'usr-aarav', interests: JSON.stringify(['cat-technical', 'cat-competitions']), personalization_enabled: 1, updated_at: SEEDED_AT })
      .execute();

    await trx
      .insertInto('approval_reviews')
      .values({ id: newId(), event_id: PENDING_EVENT.id, actor_id: 'usr-anita', action: 'submitted', comments: 'Guest speaker confirmed.', created_at: '2026-09-20T05:30:00.000Z' })
      .execute();

    // Priya and Rohan are registered for the live talk, so their passes can be scanned.
    for (const userId of ['usr-priya', 'usr-rohan']) {
      await trx
        .insertInto('registrations')
        .values({
          id: newId(),
          event_id: LIVE_EVENT.id,
          user_id: userId,
          status: 'confirmed',
          registration_code: newRegistrationCode(),
          phone: '9876543210',
          created_at: LIVE_EVENT.registration_opens_at,
          cancelled_at: null,
          cancel_reason: null,
          source: 'self',
          team_id: null,
          answers: null,
          offer_expires_at: null,
          payment_due_at: null,
        })
        .execute();
    }

    // Sample history: Aarav (CSE, 3rd year) attended the AI & ML Workshop,
    // so the Past Events → Rate this Event journey works out of the box.
    const aaravReg = {
      id: newId(),
      event_id: 'e2',
      user_id: 'usr-aarav',
      status: 'attended' as const,
      registration_code: newRegistrationCode(),
      phone: '9876543210',
      created_at: '2026-09-01T05:00:00.000Z',
      cancelled_at: null,
      cancel_reason: null,
      source: 'self' as const,
      team_id: null,
      answers: null,
      offer_expires_at: null,
      payment_due_at: null,
    };
    await trx.insertInto('registrations').values(aaravReg).execute();
    await trx.insertInto('check_ins').values(checkInRow(aaravReg.id, 'e2', EVENTS[1].starts_at, 3)).execute();
    // …and has a certificate for it, which anyone can verify at /verify/CERT-AARAV001.
    await trx
      .insertInto('certificates')
      .values({ id: newId(), code: 'CERT-AARAV001', registration_id: aaravReg.id, kind: 'participation', title: 'Certificate of Participation — AI & Machine Learning Workshop', issued_at: '2026-09-14T05:00:00.000Z', issued_by: 'usr-anita', revoked_at: null, revoke_reason: null })
      .execute();
    await trx
      .insertInto('notifications')
      .values({
        id: newId(),
        user_id: 'usr-aarav',
        category: 'registrations',
        title: 'Registration confirmed',
        body: `You're registered for AI & Machine Learning Workshop. Your registration ID is ${aaravReg.registration_code}.`,
        link: '/register-success/e2',
        created_at: aaravReg.created_at,
        read_at: '2026-09-01T06:00:00.000Z',
      })
      .execute();
  }
};
