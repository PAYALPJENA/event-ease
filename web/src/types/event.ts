// Shapes returned by the EventEase API (server/src/services/events.ts and routes).

export type EventPhase = 'upcoming' | 'ongoing' | 'completed';
/** Blueprint §3.3. Students only ever see published and cancelled events. */
export type EventStatus = 'draft' | 'pending_approval' | 'changes_requested' | 'rejected' | 'published' | 'cancelled';
/** `no_registration`: students don't register through EventEase (not required, or not specified by the source). */
export type Availability = 'not_open' | 'open' | 'closing_soon' | 'full' | 'closed' | 'no_registration';
export type EventKind =
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
export type RegistrationMode = 'eventease' | 'not_required' | 'unspecified';
export type CertificateRule = 'none' | 'attendance' | 'winners' | 'attendance_and_winners';

export interface EventQuestion {
  id: string;
  label: string;
  type: 'text' | 'choice';
  options?: string[];
  required: boolean;
}

/** `null` fields are "not specified" — show that, never a guess. */
export interface EventType {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  description: string;
  image: string | null;
  category: { id: string; name: string };
  organization: { id: string; name: string } | null;
  eventType: EventKind;
  tags: string[];
  /** The date is known; the time isn't announced. */
  timeTbd: boolean;
  registrationMode: RegistrationMode;
  sourceNote: string | null;
  /** Fictional sample data. */
  isSample: boolean;
  venue: { id: string; name: string; mapsUrl: string | null } | null;
  mode: 'in_person' | 'online' | 'hybrid';
  onlineUrl: string | null;
  /** ISO-8601 UTC */
  startsAt: string;
  endsAt: string;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  /** null = no limit / not specified */
  capacity: number | null;
  seatsTaken: number;
  seatsAvailable: number | null;
  eligibilityText: string | null;
  eligibleDepartments: string[] | null;
  eligibleYears: number[] | null;
  requirements: string[];
  contactPerson: string | null;
  contactEmail: string | null;
  isFeatured: boolean;
  status: EventStatus;
  phase: EventPhase;
  availability: Availability;
  participation: 'individual' | 'team';
  teamMin: number | null;
  teamMax: number | null;
  waitlistEnabled: boolean;
  waitlistCount: number;
  offerWindowHours: number;
  questions: EventQuestion[];
  requiredDocuments: { id: string; label: string }[];
  cancellationCutoffHours: number | null;
  certificateRule: CertificateRule;
  /** In paise; 0 = free; null = not specified. */
  feeAmount: number | null;
  recap: string | null;
  gallery: string[];
  resultsPublished: boolean;
}

export type Role = 'student' | 'organizer' | 'admin';

export interface CurrentUser {
  id: string;
  universityId: string;
  name: string;
  email: string;
  campus: string;
  school: string | null;
  department: string | null;
  programme: string | null;
  year: number | null;
  semester: number | null;
  roles: Role[];
}

/**
 * Blueprint §3.3. Seat-holding: pending_payment, pending_documents,
 * offer_pending, confirmed, checked_in, attended, no_show.
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

export interface RegistrationSummary {
  id: string;
  eventId: string;
  code: string;
  status: RegistrationStatus;
  source: 'self' | 'organizer';
  createdAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  checkedInAt: string | null;
  teamId: string | null;
  answers: Record<string, string> | null;
  offerExpiresAt: string | null;
  paymentDueAt: string | null;
}

/** A time or venue change to a published event (the change banner, blueprint §7.1). */
export interface EventChange {
  field: 'time' | 'venue';
  oldValue: string;
  newValue: string;
  reason: string;
  createdAt: string;
}

export interface EventResult {
  id: string;
  position: number;
  title: string;
  registrationId: string | null;
  teamId: string | null;
  name: string;
}

export interface MyRegistration extends RegistrationSummary {
  hasFeedback: boolean;
  hasCertificate: boolean;
  waitlistPosition: number | null;
  event: EventType;
}

export interface UploadedDocument {
  id: string;
  requirementId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: 'submitted' | 'approved' | 'rejected';
  rejectionReason: string | null;
  submittedAt: string;
}

export interface Certificate {
  id: string;
  code: string;
  kind: 'participation' | 'winner';
  title: string;
  issuedAt: string;
  revokedAt: string | null;
  holderName: string;
  universityId: string;
  event: { id: string; title: string; startsAt: string };
  issuer: string;
}

export interface RegistrationDetail extends RegistrationSummary {
  event: EventType;
  passToken: string | null;
  waitlistPosition: number | null;
  documents: UploadedDocument[];
  payment: { status: 'created' | 'paid' | 'failed' | 'refunded'; amount: number; orderId: string; paidAt: string | null; refundedAt: string | null } | null;
  team: {
    id: string;
    name: string;
    status: 'forming' | 'complete' | 'locked' | 'disbanded';
    inviteCode: string;
    isLeader: boolean;
    members: { name: string; isLeader: boolean }[];
  } | null;
  certificates: Certificate[];
}

export interface PaymentOrder {
  orderId: string;
  amount: number;
  currency?: 'INR';
  dueAt?: string | null;
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

export interface NotificationType {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
  read: boolean;
}

export interface Club {
  id: string;
  type: 'club' | 'department' | 'cell';
  name: string;
  slug: string;
  description: string | null;
  contactEmail: string | null;
  logoUrl: string | null;
  socialLinks: Record<string, string>;
  recruitment: string | null;
  followers: number;
  upcomingEvents?: number;
  contacts?: { name: string; role: string }[];
}

export type OpportunityType = 'internship' | 'scholarship' | 'research' | 'fellowship' | 'competition' | 'conference';

export interface Opportunity {
  id: string;
  type: OpportunityType;
  title: string;
  provider: string;
  description: string;
  deadline: string;
  eligibilityText: string;
  eligibleDepartments: string[] | null;
  eligibleYears: number[] | null;
  externalUrl: string | null;
  tags: string[];
  organizationId: string | null;
  status: 'published' | 'archived';
  eligible?: boolean | null;
}

export interface Recommendation {
  event: EventType;
  score: number;
  reasons: string[];
}
