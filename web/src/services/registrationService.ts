import type { MyRegistration, PaymentOrder, RegistrationDetail, RegistrationSummary } from '../types/event';
import { api } from './api';

/**
 * Registration API calls. The server enforces every rule (seat limit, one
 * registration per student, eligibility, registration window, waitlist,
 * teams, payment and documents); the UI only reflects the result.
 */

export interface RegistrationPayload {
  phone: string;
  agree: true;
  answers?: Record<string, string>;
  team?: { create: { name: string } } | { join: { code: string } };
  /** Join the waitlist if the event is full. */
  waitlist?: boolean;
}

export const registerForEvent = (eventId: string, payload: RegistrationPayload) =>
  api<{ registration: RegistrationSummary; payment: PaymentOrder | null }>(`/events/${encodeURIComponent(eventId)}/registrations`, {
    method: 'POST',
    body: payload,
  });

export const fetchMyRegistrations = () =>
  api<{ registrations: MyRegistration[] }>('/me/registrations').then(r => r.registrations);

export const fetchRegistration = (registrationId: string) =>
  api<{ registration: RegistrationDetail }>(`/me/registrations/${encodeURIComponent(registrationId)}`).then(r => r.registration);

export const cancelRegistration = (registrationId: string) =>
  api<{ ok: true }>(`/me/registrations/${encodeURIComponent(registrationId)}/cancel`, { method: 'POST' });

export const acceptOffer = (registrationId: string) =>
  api<{ registration: RegistrationSummary; payment: PaymentOrder | null }>(`/me/registrations/${encodeURIComponent(registrationId)}/accept-offer`, { method: 'POST' });

/** A new payment order while the seat is held (e.g. after a failed attempt). */
export const startPayment = (registrationId: string) =>
  api<{ payment: PaymentOrder }>(`/me/registrations/${encodeURIComponent(registrationId)}/payment`, { method: 'POST' }).then(r => r.payment);

export const uploadDocument = (registrationId: string, requirementId: string, file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  }).then(dataBase64 =>
    api<{ document: { id: string; status: string } }>(`/me/registrations/${encodeURIComponent(registrationId)}/documents`, {
      method: 'POST',
      body: { requirementId, fileName: file.name, dataBase64 },
    })
  );

export interface FeedbackInput {
  rating: number;
  comment: string;
  content?: number;
  speaker?: number;
  organization?: number;
  venue?: number;
  registrationExperience?: number;
  wouldAttendAgain?: boolean;
}

export const submitFeedback = (registrationId: string, feedback: FeedbackInput) =>
  api<{ ok: true }>(`/me/registrations/${encodeURIComponent(registrationId)}/feedback`, { method: 'POST', body: feedback });

export const fetchSavedEventIds = () => api<{ eventIds: string[] }>('/me/saved').then(r => r.eventIds);

export const setEventSaved = (eventId: string, saved: boolean) =>
  api<{ ok: true }>(`/me/saved/${encodeURIComponent(eventId)}`, { method: saved ? 'PUT' : 'DELETE' });
