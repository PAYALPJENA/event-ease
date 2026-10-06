import type { Certificate, Club, EventType, NotificationCategory, Opportunity, Recommendation } from '../types/event';
import { api } from './api';

// Student-facing features beyond registration: clubs, opportunities,
// certificates, recommendations, preferences, push, the calendar feed and
// payments (server/src/routes/public.ts and me.ts).

const enc = encodeURIComponent;

// ---------- Clubs ----------

export const fetchClubs = () => api<{ clubs: Club[] }>('/clubs').then(r => r.clubs);
export const fetchClub = (slug: string) => api<{ club: Club; events: EventType[] }>(`/clubs/${enc(slug)}`);
export const fetchFollowedIds = () => api<{ organizationIds: string[] }>('/me/follows').then(r => r.organizationIds);
export const setFollowing = (organizationId: string, follow: boolean) =>
  api<{ ok: true }>(`/me/follows/${enc(organizationId)}`, { method: follow ? 'PUT' : 'DELETE' });

// ---------- Opportunities ----------

export const fetchOpportunities = () => api<{ opportunities: Opportunity[] }>('/opportunities').then(r => r.opportunities);
export const fetchOpportunity = (id: string) => api<{ opportunity: Opportunity }>(`/opportunities/${enc(id)}`).then(r => r.opportunity);
export const fetchSavedOpportunityIds = () => api<{ opportunityIds: string[] }>('/me/saved-opportunities').then(r => r.opportunityIds);
export const setOpportunitySaved = (id: string, saved: boolean) =>
  api<{ ok: true }>(`/me/saved-opportunities/${enc(id)}`, { method: saved ? 'PUT' : 'DELETE' });

// ---------- Certificates ----------

export const fetchMyCertificates = () => api<{ certificates: Certificate[] }>('/me/certificates').then(r => r.certificates);

export interface Verification {
  valid: boolean;
  revoked?: boolean;
  revokeReason?: string | null;
  certificate?: { code: string; kind: string; title: string; issuedAt: string; holderName: string; eventTitle: string; eventDate: string; issuer: string };
}
export const verifyCertificate = (code: string) => api<Verification>(`/verify/${enc(code)}`);

// ---------- Interests and recommendations ----------

export const fetchPreferences = () => api<{ interests: string[]; personalizationEnabled: boolean }>('/me/preferences');
export const savePreferences = (prefs: { interests: string[]; personalizationEnabled: boolean }) =>
  api<{ interests: string[]; personalizationEnabled: boolean }>('/me/preferences', { method: 'PUT', body: prefs });
export const fetchRecommendations = () => api<{ personalizationEnabled: boolean; items: Recommendation[] }>('/me/recommendations');
export const fetchCategories = () => api<{ categories: { id: string; name: string; slug: string }[] }>('/categories').then(r => r.categories);

/** Counts a view for the organizer's analytics (fire and forget). */
export const recordEventView = (eventId: string) => api(`/events/${enc(eventId)}/views`, { method: 'POST' }).catch(() => undefined);

// ---------- Notification preferences ----------

export type Channel = 'email' | 'push' | 'sms' | 'whatsapp';
export interface NotificationPreferences {
  channels: Channel[];
  categories: { category: NotificationCategory; critical: boolean; channels: Partial<Record<Channel, boolean>> }[];
}
export const fetchNotificationPreferences = () => api<NotificationPreferences>('/me/notification-preferences');
export const saveNotificationPreference = (category: NotificationCategory, channel: Channel, enabled: boolean) =>
  api<{ ok: true }>('/me/notification-preferences', { method: 'PUT', body: { changes: [{ category, channel, enabled }] } });

// ---------- Push ----------

export const fetchPushKey = () => api<{ publicKey: string; enabled: boolean }>('/push/public-key');
export const savePushSubscription = (sub: PushSubscriptionJSON) => api<{ ok: true }>('/me/push-subscriptions', { method: 'POST', body: sub });
export const deletePushSubscription = (endpoint: string) => api<{ ok: true }>('/me/push-subscriptions', { method: 'DELETE', body: { endpoint } });

// ---------- Calendar feed ----------

export const fetchCalendarFeed = () => api<{ active: boolean; createdAt: string | null }>('/me/calendar-feed');
export const createCalendarFeed = () => api<{ url: string; webcalUrl: string }>('/me/calendar-feed', { method: 'POST' });
export const revokeCalendarFeed = () => api<{ ok: true }>('/me/calendar-feed', { method: 'DELETE' });

// ---------- Profile ----------

export const saveContact = (phone: string | null) => api<{ ok: true }>('/me/contact', { method: 'PUT', body: { phone } });
export const fetchVolunteering = () => api<{ events: EventType[] }>('/me/volunteering').then(r => r.events);

// ---------- Payments ----------

export interface OrderSummary {
  orderId: string;
  amount: number;
  status: 'created' | 'paid' | 'failed' | 'refunded';
  dueAt: string | null;
  event: { id: string; title: string };
}
export const fetchOrder = (orderId: string) => api<{ order: OrderSummary }>(`/payments/orders/${enc(orderId)}`).then(r => r.order);
/** Development gateway only. */
export const mockCheckout = (orderId: string, outcome: 'success' | 'failure') =>
  api<{ applied: boolean; status?: string; reason?: string }>(`/payments/mock-checkout/${enc(orderId)}`, { method: 'POST', body: { outcome } });

export const formatRupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0 })}`;
