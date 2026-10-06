import type { CertificateRule, EventChange, EventKind, EventQuestion, EventResult, EventType, Opportunity, OpportunityType, RegistrationMode, RegistrationStatus, UploadedDocument } from '../types/event';
import { api } from './api';

// Organizer/admin API (server/src/routes/admin.ts and operations.ts). Every
// call is scoped on the server to the organizations the signed-in organizer
// manages; approvals and the email log are admin-only.

export interface AdminOptions {
  organizations: { id: string; name: string; type: string }[];
  categories: { id: string; name: string }[];
  venues: { id: string; name: string; campus: string; capacity: number | null }[];
}

export interface EventInput {
  title: string;
  summary: string | null;
  description: string;
  image: string | null;
  /** null = organizer not specified (admins only) */
  organizationId: string | null;
  categoryId: string;
  eventType: EventKind;
  tags: string[];
  timeTbd: boolean;
  registrationMode: RegistrationMode;
  venueId: string | null;
  mode: 'in_person' | 'online' | 'hybrid';
  onlineUrl: string | null;
  startsAt: string;
  endsAt: string;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  /** null = no limit */
  capacity: number | null;
  /** null = not specified */
  eligibilityText: string | null;
  eligibleDepartments: string[] | null;
  eligibleYears: number[] | null;
  requirements: string[];
  contactPerson: string | null;
  contactEmail: string | null;
  isFeatured: boolean;
  participation: 'individual' | 'team';
  teamMin: number | null;
  teamMax: number | null;
  waitlistEnabled: boolean;
  offerWindowHours: number;
  questions: EventQuestion[];
  requiredDocuments: { id: string; label: string }[];
  cancellationCutoffHours: number | null;
  certificateRule: CertificateRule;
  /** Paise */
  feeAmount: number | null;
}

export type ReviewAction = 'submitted' | 'approved' | 'changes_requested' | 'rejected' | 'published' | 'cancel_requested' | 'cancel_declined';

export interface Review {
  action: ReviewAction;
  comments: string | null;
  createdAt: string;
  actorName: string;
}

export interface AdminEvent extends EventType {
  cancelRequest: { reason: string; requestedAt: string } | null;
  latestReview: Review | null;
}

export interface VenueClash {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
}

export interface Participant {
  id: string;
  code: string;
  status: RegistrationStatus;
  source: 'self' | 'organizer';
  createdAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  phone: string | null;
  name: string;
  universityId: string;
  email: string;
  department: string | null;
  year: number | null;
  checkedInAt: string | null;
  checkInMethod: 'qr' | 'manual' | null;
  feedbackRating: number | null;
  answers: Record<string, string> | null;
  teamName: string | null;
  documents: UploadedDocument[];
  payment: { status: string; amount: number } | null;
}

/** The door list for check-in (only what the door needs). */
export interface RosterEntry {
  id: string;
  code: string;
  status: RegistrationStatus;
  name: string;
  universityId: string;
  department: string | null;
  year: number | null;
  checkedInAt: string | null;
}

export interface EventOverview {
  capacity: number;
  registered: number;
  confirmed: number;
  checkedIn: number;
  noShow: number;
  cancelled: number;
  pending: number;
  waitlisted: number;
  documentsToReview: number;
  feedbackCount: number;
  averageRating: number | null;
  registrationsPerDay: { day: string; count: number }[];
  announcementsSent: number;
}

export type CheckInResult = 'checked_in' | 'already_checked_in' | 'cancelled' | 'not_confirmed' | 'not_found' | 'wrong_event' | 'too_early' | 'ended';

export interface CheckInStats {
  checkedIn: number;
  expected: number;
  noShow: number;
}

export interface CheckInOutcome {
  result: CheckInResult;
  registration?: { id: string; code: string; status: string };
  student?: { name: string; universityId: string; department: string | null; year: number | null };
  checkedInAt?: string;
}

export interface ScanInput {
  token?: string;
  registrationId?: string;
  /** ISO time of the scan; set for scans queued while offline. */
  scannedAt?: string;
  device?: string;
}

export type AnnouncementAudience = 'all' | 'checked_in' | 'not_checked_in';

export interface Announcement {
  id: string;
  audience: AnnouncementAudience;
  title: string;
  body: string;
  recipientCount: number;
  createdAt: string;
  authorName: string;
}

export interface OutboxEmail {
  id: string;
  channel: 'email' | 'push' | 'sms' | 'whatsapp';
  to: string;
  subject: string;
  body: string;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  createdAt: string;
  sentAt: string | null;
  lastError: string | null;
}

const path = (id: string) => `/admin/events/${encodeURIComponent(id)}`;

// ---------- Events and the approval workflow ----------

export const fetchAdminOptions = () => api<AdminOptions>('/admin/options');
export const fetchAdminEvents = () => api<{ events: AdminEvent[] }>('/admin/events').then(r => r.events);
export const fetchAdminEvent = (id: string) =>
  api<{ event: AdminEvent; reviews: Review[]; changes: EventChange[] }>(path(id));

export const createEvent = (input: EventInput) =>
  api<{ event: EventType }>('/admin/events', { method: 'POST', body: input }).then(r => r.event);

export const updateEvent = (id: string, input: EventInput & { changeReason?: string; overrideClash?: boolean }) =>
  api<{ event: EventType }>(path(id), { method: 'PUT', body: input }).then(r => r.event);

export const submitEvent = (id: string, note?: string) => api<{ ok: true }>(`${path(id)}/submit`, { method: 'POST', body: { note } });

export const publishEvent = (id: string, overrideClash = false) =>
  api<{ ok: true }>(`${path(id)}/publish`, { method: 'POST', body: { overrideClash } });

export const reviewEvent = (id: string, decision: 'approve' | 'request_changes' | 'reject', comments: string, overrideClash = false) =>
  api<{ ok: true; status: string }>(`${path(id)}/review`, { method: 'POST', body: { decision, comments: comments || undefined, overrideClash } });

/** Admins cancel directly; an organizer's request is 'cancel_requested' when students are registered. */
export const cancelEvent = (id: string, reason: string) =>
  api<{ ok: true; status: 'cancelled' | 'cancel_requested' }>(`${path(id)}/cancel`, { method: 'POST', body: { reason } });

export const declineCancelRequest = (id: string, comments: string) =>
  api<{ ok: true }>(`${path(id)}/cancel-request/decline`, { method: 'POST', body: { comments } });

export const fetchApprovals = () =>
  api<{ pending: (AdminEvent & { clashes: VenueClash[] })[]; cancelRequests: (AdminEvent & { requestedBy: string | null })[] }>('/admin/approvals');

export const fetchOutbox = (channel?: string) =>
  api<{ mailMode: string; modes: Record<string, string>; emails: OutboxEmail[] }>(`/admin/outbox${channel ? `?channel=${encodeURIComponent(channel)}` : ''}`);

// ---------- Participants ----------

export const fetchParticipants = (id: string) =>
  api<{ registrations: Participant[] }>(`${path(id)}/registrations`).then(r => r.registrations);

export const fetchOverview = (id: string) => api<EventOverview>(`${path(id)}/overview`);

export const addParticipant = (id: string, universityId: string, reason: string) =>
  api<{ registration: { id: string; code: string; name: string } }>(`${path(id)}/registrations`, { method: 'POST', body: { universityId, reason } }).then(
    r => r.registration
  );

export const removeParticipant = (id: string, registrationId: string, reason: string) =>
  api<{ ok: true }>(`${path(id)}/registrations/${encodeURIComponent(registrationId)}/cancel`, { method: 'POST', body: { reason } });

// ---------- Check-in (organizers, admins and the event's volunteers) ----------

const door = (id: string) => `/check-in/events/${encodeURIComponent(id)}`;

export const fetchDoorEvent = (id: string) =>
  api<{ event: { id: string; title: string; startsAt: string; endsAt: string; status: string } }>(door(id)).then(r => r.event);

export const fetchRoster = (id: string) => api<{ roster: RosterEntry[] }>(`${door(id)}/roster`).then(r => r.roster);

export const checkIn = (id: string, scan: ScanInput) => api<CheckInOutcome & { stats: CheckInStats }>(`${door(id)}/scans`, { method: 'POST', body: scan });

export const syncCheckIns = (id: string, items: (ScanInput & { clientId: string })[]) =>
  api<{ results: (CheckInOutcome & { clientId: string; message?: string; result: CheckInResult | 'error' })[]; stats: CheckInStats }>(`${door(id)}/scans/batch`, {
    method: 'POST',
    body: { items },
  });

export const fetchCheckInStats = (id: string) => api<CheckInStats>(`${door(id)}/stats`);

// ---------- Documents and volunteers ----------

export const reviewDocument = (eventId: string, documentId: string, approve: boolean, reason?: string) =>
  api<{ registrationStatus: string }>(`${path(eventId)}/documents/${encodeURIComponent(documentId)}/review`, { method: 'POST', body: { approve, reason } });

export const documentFileUrl = (eventId: string, documentId: string) => `/api${path(eventId)}/documents/${encodeURIComponent(documentId)}/file`;

export interface Volunteer {
  id: string;
  name: string;
  universityId: string;
  addedAt: string;
}
export const fetchVolunteers = (id: string) => api<{ volunteers: Volunteer[] }>(`${path(id)}/volunteers`).then(r => r.volunteers);
export const addVolunteer = (id: string, universityId: string) => api<{ volunteer: { id: string; name: string } }>(`${path(id)}/volunteers`, { method: 'POST', body: { universityId } });
export const removeVolunteer = (id: string, userId: string) => api<{ ok: true }>(`${path(id)}/volunteers/${encodeURIComponent(userId)}`, { method: 'DELETE' });

// ---------- After the event ----------

export const fetchResults = (id: string) =>
  api<{ results: EventResult[]; published: boolean; teams: { id: string; name: string; status: string }[] }>(`${path(id)}/results`);
export const saveResults = (id: string, results: { position: number; title: string; registrationId?: string; teamId?: string }[]) =>
  api<{ results: EventResult[] }>(`${path(id)}/results`, { method: 'PUT', body: { results } });
export const publishResults = (id: string) => api<{ notified: number; certificatesIssued: number }>(`${path(id)}/results/publish`, { method: 'POST' });

export interface IssuedCertificate {
  id: string;
  code: string;
  kind: 'participation' | 'winner';
  title: string;
  issuedAt: string;
  revokedAt: string | null;
  holderName: string;
  universityId: string;
}
export const fetchEventCertificates = (id: string) => api<{ certificates: IssuedCertificate[] }>(`${path(id)}/certificates`).then(r => r.certificates);
export const issueCertificates = (id: string) => api<{ issued: number }>(`${path(id)}/certificates/issue`, { method: 'POST' });
export const revokeCertificate = (id: string, certificateId: string, reason: string) =>
  api<{ ok: true }>(`${path(id)}/certificates/${encodeURIComponent(certificateId)}/revoke`, { method: 'POST', body: { reason } });
export const saveRecap = (id: string, recap: string | null, gallery: string[]) => api<{ ok: true }>(`${path(id)}/recap`, { method: 'PUT', body: { recap, gallery } });

// ---------- Analytics and insights (V4) ----------

export interface EventAnalytics {
  funnel: { views: number; registrations: number; attended: number; feedback: number; viewToRegistration: number | null; registrationToAttendance: number | null; attendanceToFeedback: number | null };
  capacity: number;
  fillRate: number | null;
  waitlisted: number;
  noShowRate: number | null;
  feedback: { count: number; overall: number | null; dimensions: Record<string, number | null>; wouldAttendAgain: number | null };
  comparison: { pastEvents: number; pastAttendanceRate: number | null; pastAverageRating: number | null };
  viewsPerDay: { day: string; count: number }[];
}
export const fetchAnalytics = (id: string) => api<EventAnalytics>(`${path(id)}/analytics`);

export interface InsightGroup {
  name: string;
  events: number;
  capacity: number;
  registrations: number;
  waitlisted: number;
  attended: number;
  noShow: number;
  fillRate: number | null;
  attendanceRate: number | null;
  noShowRate: number | null;
  averageRating: number | null;
}
export interface Insights {
  range: { from: string; to: string };
  totals: { events: number; registrations: number; uniqueStudents: number; attended: number; noShowRate: number | null; averageRating: number | null };
  byCohort: { department: string; year: number | null; registrations: number; attended: number; students: number; attendanceRate: number | null }[];
  byCategory: InsightGroup[];
  byOrganization: InsightGroup[];
}
export const fetchInsights = (from: string, to: string) => api<Insights>(`/admin/insights?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
export const coCurricularExportUrl = (from: string, to: string) => `/api/admin/exports/co-curricular?format=csv&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

// ---------- Payments ----------

export interface PaymentRow {
  id: string;
  amount: number;
  status: 'created' | 'paid' | 'failed' | 'refunded';
  gateway: string;
  orderId: string;
  paymentId: string | null;
  refundRef: string | null;
  createdAt: string;
  paidAt: string | null;
  refundedAt: string | null;
  registrationCode: string;
  registrationStatus: RegistrationStatus;
  name: string;
  universityId: string;
  eventTitle: string;
}
export const fetchPayments = () => api<{ payments: PaymentRow[]; totals: { collected: number; refunded: number; pending: number } }>('/admin/payments');

// ---------- Organizations ----------

export interface AdminOrganization {
  id: string;
  name: string;
  slug: string;
  type: 'club' | 'department' | 'cell';
  status: 'active' | 'inactive';
  description: string | null;
  contactEmail: string | null;
  logoUrl: string | null;
  socialLinks: Record<string, string>;
  recruitment: string | null;
  members: { userId: string; name: string; universityId: string; role: 'lead' | 'organizer' | 'member' | 'volunteer' }[];
}
export interface OrganizationInput {
  name: string;
  type: 'club' | 'department' | 'cell';
  description: string | null;
  contactEmail: string | null;
  logoUrl: string | null;
  socialLinks: Record<string, string>;
  recruitment: string | null;
  status?: 'active' | 'inactive';
}
export const fetchOrganizations = () => api<{ organizations: AdminOrganization[] }>('/admin/organizations').then(r => r.organizations);
export const createOrganization = (input: OrganizationInput) => api<{ organization: { id: string } }>('/admin/organizations', { method: 'POST', body: input });
export const updateOrganization = (id: string, input: OrganizationInput) => api<{ ok: true }>(`/admin/organizations/${encodeURIComponent(id)}`, { method: 'PUT', body: input });
export const setMember = (id: string, universityId: string, role: string) => api<{ ok: true }>(`/admin/organizations/${encodeURIComponent(id)}/members`, { method: 'POST', body: { universityId, role } });
export const removeMember = (id: string, userId: string) => api<{ ok: true }>(`/admin/organizations/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' });

// ---------- Opportunities ----------

export interface OpportunityInput {
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
  status?: 'published' | 'archived';
}
export const fetchAdminOpportunities = () => api<{ opportunities: Opportunity[] }>('/admin/opportunities').then(r => r.opportunities);
export const createOpportunity = (input: OpportunityInput) => api<{ opportunity: { id: string } }>('/admin/opportunities', { method: 'POST', body: input });
export const updateOpportunity = (id: string, input: OpportunityInput & { status: 'published' | 'archived' }) =>
  api<{ ok: true }>(`/admin/opportunities/${encodeURIComponent(id)}`, { method: 'PUT', body: input });

// ---------- Announcements ----------

export const fetchAnnouncements = (id: string) =>
  api<{ announcements: Announcement[] }>(`${path(id)}/announcements`).then(r => r.announcements);

export const sendAnnouncement = (id: string, input: { audience: AnnouncementAudience; title: string; body: string }) =>
  api<{ announcement: { id: string; recipientCount: number } }>(`${path(id)}/announcements`, { method: 'POST', body: input }).then(r => r.announcement);
