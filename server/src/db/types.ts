import type { Insertable, Selectable, Updateable } from 'kysely';

/**
 * Database schema (blueprint §8, phases V1–V5).
 *
 * Portability rules so the same code can move from SQLite to PostgreSQL:
 * - IDs are text (random, generated in app code), never autoincrement.
 * - Timestamps are ISO-8601 UTC strings.
 * - Arrays/objects are stored as JSON text and parsed in the repository layer.
 * - Booleans are stored as 0/1 integers.
 */

export type Role = 'student' | 'organizer' | 'admin';

export interface UsersTable {
  id: string;
  university_id: string;
  name: string;
  email: string;
  phone: string | null;
  campus: string;
  school: string | null;
  department: string | null;
  programme: string | null;
  year: number | null;
  semester: number | null;
  /** JSON array of Role */
  roles: string;
  status: 'active' | 'disabled';
  created_at: string;
}

export interface OrganizationsTable {
  id: string;
  type: 'club' | 'department' | 'cell';
  name: string;
  slug: string;
  description: string | null;
  contact_email: string | null;
  created_at: string;
  /** Inactive organizations are hidden from the directory and can't publish. */
  status: 'active' | 'inactive';
  logo_url: string | null;
  /** JSON object: { website?, instagram?, linkedin? } */
  social_links: string;
  /** "We're recruiting…" text on the club page, or null. */
  recruitment: string | null;
}

export interface FollowsTable {
  user_id: string;
  organization_id: string;
  created_at: string;
}

export interface OrganizationMembersTable {
  organization_id: string;
  user_id: string;
  role: 'lead' | 'organizer' | 'member' | 'volunteer';
}

export interface VenuesTable {
  id: string;
  name: string;
  campus: string;
  capacity: number | null;
  maps_url: string | null;
}

/** The event taxonomy (reference data owned by migrations, not by the seed). Order is `position`. */
export interface CategoriesTable {
  id: string;
  name: string;
  slug: string;
  position: number;
}

/** What kind of happening an event is. Separate from its category (subject area). */
export type EventType =
  | 'workshop'
  | 'competition'
  | 'talk'
  | 'seminar'
  | 'conference'
  | 'fest'
  | 'sports'
  | 'cultural'
  | 'club_activity'
  | 'community_service'
  | 'wellness'
  | 'student_development'
  | 'other';

/**
 * How students take part:
 *   eventease     — register here (capacity, window, pass, check-in)
 *   not_required  — open to all, no registration
 *   unspecified   — the source doesn't say; shown as "Registration details not specified"
 */
export type RegistrationMode = 'eventease' | 'not_required' | 'unspecified';

/**
 * Stored event status (blueprint §3.3). "upcoming / ongoing / completed" is
 * derived from the times, never stored.
 *
 *   draft ─submit→ pending_approval ─approve→ published ─cancel→ cancelled
 *                        ├─request changes→ changes_requested ─resubmit→ pending_approval
 *                        └─reject→ rejected
 */
export type EventStatus = 'draft' | 'pending_approval' | 'changes_requested' | 'rejected' | 'published' | 'cancelled';

/**
 * Facts the organizer (or the source communication) didn't give are null and
 * shown as "Not specified" — never filled with invented values.
 */
export interface EventsTable {
  id: string;
  slug: string;
  /** null = organizer not specified (only admins can manage such an event) */
  organization_id: string | null;
  category_id: string;
  title: string;
  summary: string | null;
  description: string;
  image: string | null;
  venue_id: string | null;
  mode: 'in_person' | 'online' | 'hybrid';
  online_url: string | null;
  starts_at: string;
  ends_at: string;
  /** Required when registration_mode is 'eventease'. */
  registration_opens_at: string | null;
  registration_closes_at: string | null;
  /** null = no limit / not specified */
  capacity: number | null;
  /** null = eligibility not specified */
  eligibility_text: string | null;
  /** JSON array of department codes, or null for all departments */
  eligible_departments: string | null;
  /** JSON array of years (1-5), or null for all years */
  eligible_years: string | null;
  /** JSON array of strings */
  requirements: string;
  contact_person: string | null;
  contact_email: string | null;
  is_featured: number;
  status: EventStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  /** An organizer asked to cancel an event that has registrations; an admin must confirm (blueprint §5). */
  cancel_requested_at: string | null;
  cancel_requested_by: string | null;
  cancel_request_reason: string | null;
  // ---- V3 ----
  participation: 'individual' | 'team';
  team_min: number | null;
  team_max: number | null;
  /** 1 = when full, students can join a waitlist and get offered freed seats (individual events). */
  waitlist_enabled: number;
  /** How long a waitlist offer stays open. */
  offer_window_hours: number;
  /** JSON array of EventQuestion */
  questions: string;
  /** JSON array of { id, label } documents each registrant must upload */
  required_documents: string;
  /** Hours before the start after which students can no longer cancel; null = until the start. */
  cancellation_cutoff_hours: number | null;
  certificate_rule: 'none' | 'attendance' | 'winners' | 'attendance_and_winners';
  recap: string | null;
  /** JSON array of image URLs shown after the event */
  gallery: string;
  results_published_at: string | null;
  // ---- V5 ----
  /** Fee in paise (₹1 = 100). 0 = free; null = not specified. */
  fee_amount: number | null;
  // ---- Source-based content ----
  event_type: EventType;
  /** JSON array of strings */
  tags: string;
  /** 1 = the date is known but the time isn't (starts/ends span the whole day in IST). */
  time_tbd: number;
  registration_mode: RegistrationMode;
  /** Where the facts came from, e.g. "CUTM communication". Shown to students. */
  source_note: string | null;
  /** 1 = fictional sample data for demos and tests, labelled "Sample" in the app. */
  is_sample: number;
}

export interface EventQuestion {
  id: string;
  label: string;
  type: 'text' | 'choice';
  options?: string[];
  required: boolean;
}

/**
 * Registration states (blueprint §3.3):
 *
 *   pending_payment ─(paid webhook)→ pending_documents | confirmed
 *   pending_documents ─(all documents approved)→ confirmed
 *   confirmed ─(check-in)→ checked_in ─(event end)→ attended
 *   confirmed ─(event end, not checked in)→ no_show
 *   waitlisted ─(seat freed)→ offer_pending ─(accepted in time)→ pending_payment | pending_documents | confirmed
 *                                           └─(expired)→ waitlist_expired
 *   any upcoming state ─student or organizer→ cancelled
 *
 * Seat-holding states are listed in lib/rules.ts (SEAT_STATUSES).
 */
export type RegistrationStatus =
  | 'pending_payment'
  | 'pending_documents'
  | 'confirmed'
  | 'checked_in'
  | 'attended'
  | 'no_show'
  | 'waitlisted'
  | 'offer_pending'
  | 'waitlist_expired'
  | 'cancelled';

export interface RegistrationsTable {
  id: string;
  event_id: string;
  user_id: string;
  status: RegistrationStatus;
  registration_code: string;
  phone: string | null;
  created_at: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
  /** 'self' = the student registered; 'organizer' = added manually by an organizer (with a logged reason). */
  source: 'self' | 'organizer';
  team_id: string | null;
  /** JSON object { questionId: answer } */
  answers: string | null;
  offer_expires_at: string | null;
  payment_due_at: string | null;
}

export interface TeamsTable {
  id: string;
  event_id: string;
  name: string;
  leader_id: string;
  /** Shared with teammates to join. */
  invite_code: string;
  status: 'forming' | 'complete' | 'locked' | 'disbanded';
  created_at: string;
}

export interface RegistrationDocumentsTable {
  id: string;
  registration_id: string;
  requirement_id: string;
  /** File name inside the uploads directory (random; never the user's name). */
  stored_name: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  status: 'submitted' | 'approved' | 'rejected';
  rejection_reason: string | null;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

export interface ResultsTable {
  id: string;
  event_id: string;
  position: number;
  /** e.g. "Winner", "Runner-up", "Best Design" */
  title: string;
  registration_id: string | null;
  team_id: string | null;
  created_at: string;
}

export interface CertificatesTable {
  id: string;
  /** Public ID used on the verification page, e.g. CERT-8F92KD4M */
  code: string;
  registration_id: string;
  kind: 'participation' | 'winner';
  /** e.g. "Certificate of Participation" or "Winner — CUTM TechFest 2026" */
  title: string;
  issued_at: string;
  issued_by: string;
  revoked_at: string | null;
  revoke_reason: string | null;
}

export interface OpportunitiesTable {
  id: string;
  type: 'internship' | 'scholarship' | 'research' | 'fellowship' | 'competition' | 'conference';
  title: string;
  provider: string;
  description: string;
  deadline: string;
  eligibility_text: string;
  eligible_departments: string | null;
  eligible_years: string | null;
  external_url: string | null;
  /** JSON array of strings */
  tags: string;
  organization_id: string | null;
  created_by: string;
  status: 'published' | 'archived';
  created_at: string;
}

export interface SavedOpportunitiesTable {
  user_id: string;
  opportunity_id: string;
  created_at: string;
}

export interface OpportunityRemindersTable {
  opportunity_id: string;
  deadline: string;
  sent_at: string;
}

/** A check-in volunteer: can scan passes for one event and nothing else (blueprint §2.2). */
export interface EventVolunteersTable {
  event_id: string;
  user_id: string;
  added_by: string;
  created_at: string;
}

// ---------- V4 ----------

export interface UserPreferencesTable {
  user_id: string;
  /** JSON array of category ids the student is interested in */
  interests: string;
  personalization_enabled: number;
  updated_at: string;
}

/** One row per viewer per event per day (the top of the analytics funnel). */
export interface EventViewsTable {
  event_id: string;
  /** Hash of the user id, or of an anonymous visitor id. Never the raw id. */
  viewer_key: string;
  day: string;
  created_at: string;
}

// ---------- V5 ----------

export type Channel = 'email' | 'push' | 'sms' | 'whatsapp';

/** Opt-outs per category × channel. No row = the default (on). Critical categories ignore it. */
export interface NotificationPrefsTable {
  user_id: string;
  category: NotificationCategory;
  channel: Channel;
  enabled: number;
}

export interface PushSubscriptionsTable {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
}

export interface PaymentsTable {
  id: string;
  registration_id: string;
  amount: number;
  currency: 'INR';
  gateway: string;
  gateway_order_id: string;
  gateway_payment_id: string | null;
  status: 'created' | 'paid' | 'failed' | 'refunded';
  created_at: string;
  paid_at: string | null;
  refunded_at: string | null;
  refund_ref: string | null;
}

/** Private calendar subscription feed (blueprint §4.8). The URL token is stored hashed. */
export interface CalendarFeedsTable {
  user_id: string;
  token_hash: string;
  created_at: string;
}

export interface SavedEventsTable {
  user_id: string;
  event_id: string;
  created_at: string;
}

export type NotificationCategory =
  | 'registrations'
  | 'reminders'
  | 'changes'
  | 'announcements'
  | 'approvals'
  | 'waitlist'
  | 'results'
  | 'certificates'
  | 'clubs'
  | 'opportunities'
  | 'payments';

export interface NotificationsTable {
  id: string;
  user_id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  link: string | null;
  created_at: string;
  read_at: string | null;
}

export interface FeedbackTable {
  id: string;
  registration_id: string;
  /** Overall, 1–5 */
  rating: number;
  comment: string;
  created_at: string;
  // Dimensions (blueprint §5 Feedback & analytics), each 1–5 or null if skipped.
  content_rating: number | null;
  speaker_rating: number | null;
  organization_rating: number | null;
  venue_rating: number | null;
  registration_rating: number | null;
  would_attend_again: number | null;
}

export interface SessionsTable {
  /** SHA-256 of the session token; the raw token only ever lives in the cookie. */
  id: string;
  user_id: string;
  created_at: string;
  expires_at: string;
}

export interface AuditLogTable {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  /** JSON */
  data: string | null;
  created_at: string;
}

/** One row per step of an event's review (blueprint §5 "Approval status" timeline). */
export type ReviewAction =
  | 'submitted'
  | 'approved'
  | 'changes_requested'
  | 'rejected'
  | 'published'
  | 'cancel_requested'
  | 'cancel_declined';

export interface ApprovalReviewsTable {
  id: string;
  event_id: string;
  actor_id: string;
  action: ReviewAction;
  comments: string | null;
  created_at: string;
}

/** Blueprint §8.3 #8: every change to a published event's time or venue is recorded. */
export interface EventChangesTable {
  id: string;
  event_id: string;
  field: 'time' | 'venue';
  old_value: string;
  new_value: string;
  reason: string;
  changed_by: string;
  created_at: string;
}

export interface CheckInsTable {
  id: string;
  /** Unique: a registration is checked in at most once (§8.3 #6). */
  registration_id: string;
  event_id: string;
  /** When the pass was scanned — from the device, which may have been offline. */
  scanned_at: string;
  /** When the server recorded it. */
  recorded_at: string;
  scanned_by: string;
  method: 'qr' | 'manual';
  device: string | null;
}

export type AnnouncementAudience = 'all' | 'checked_in' | 'not_checked_in';

export interface AnnouncementsTable {
  id: string;
  event_id: string;
  audience: AnnouncementAudience;
  title: string;
  body: string;
  author_id: string;
  recipient_count: number;
  created_at: string;
}

/**
 * Outgoing messages on every external channel (email, push, SMS, WhatsApp).
 * Written in the same transaction as the action that caused them, then
 * delivered by the scheduler — so a message is never lost or sent for a
 * rolled-back action.
 */
export interface MessageOutboxTable {
  id: string;
  channel: Channel;
  user_id: string | null;
  /** Email address, phone number, or push subscription id, depending on the channel. */
  to_address: string;
  subject: string;
  body: string;
  created_at: string;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  sent_at: string | null;
  last_error: string | null;
}

/**
 * Record of scheduled work that has run (reminders, attendance, feedback
 * requests). The unique key makes each run happen once, even if two server
 * processes tick at the same time. See services/scheduler.ts.
 */
export interface SchedulerLogTable {
  id: string;
  kind: string;
  event_id: string;
  /** Includes the event time the run was computed from, so a rescheduled event gets new reminders. */
  run_key: string;
  ran_at: string;
  recipients: number;
}

export interface Database {
  users: UsersTable;
  organizations: OrganizationsTable;
  organization_members: OrganizationMembersTable;
  venues: VenuesTable;
  categories: CategoriesTable;
  events: EventsTable;
  registrations: RegistrationsTable;
  saved_events: SavedEventsTable;
  notifications: NotificationsTable;
  feedback: FeedbackTable;
  sessions: SessionsTable;
  audit_log: AuditLogTable;
  approval_reviews: ApprovalReviewsTable;
  event_changes: EventChangesTable;
  check_ins: CheckInsTable;
  announcements: AnnouncementsTable;
  message_outbox: MessageOutboxTable;
  scheduler_log: SchedulerLogTable;
  follows: FollowsTable;
  teams: TeamsTable;
  registration_documents: RegistrationDocumentsTable;
  results: ResultsTable;
  certificates: CertificatesTable;
  opportunities: OpportunitiesTable;
  saved_opportunities: SavedOpportunitiesTable;
  opportunity_reminders: OpportunityRemindersTable;
  event_volunteers: EventVolunteersTable;
  user_preferences: UserPreferencesTable;
  event_views: EventViewsTable;
  notification_prefs: NotificationPrefsTable;
  push_subscriptions: PushSubscriptionsTable;
  payments: PaymentsTable;
  calendar_feeds: CalendarFeedsTable;
}

export type User = Selectable<UsersTable>;
export type EventRow = Selectable<EventsTable>;
export type NewEvent = Insertable<EventsTable>;
export type EventUpdate = Updateable<EventsTable>;
export type Registration = Selectable<RegistrationsTable>;
