import type { EventChange, EventType } from '../types/event';
import { api } from './api';

/**
 * Event data access. Events now come from the EventEase API
 * (`GET /api/events`) instead of a static JSON file; pages didn't change
 * because they already went through this service.
 *
 * Results are cached in memory so the list is only requested once per
 * session. Concurrent callers during the first load share the same
 * in-flight request. `force` refetches, e.g. after registering changes
 * a seat count.
 */

let cachedEvents: EventType[] | null = null;
let inFlightRequest: Promise<EventType[]> | null = null;

export async function fetchEvents(options?: { force?: boolean }): Promise<EventType[]> {
  if (options?.force) {
    cachedEvents = null;
    inFlightRequest = null;
  }
  if (cachedEvents) return cachedEvents;
  if (inFlightRequest) return inFlightRequest;

  inFlightRequest = api<{ events: EventType[] }>('/events').then(({ events }) => {
    cachedEvents = events;
    return events;
  });

  try {
    return await inFlightRequest;
  } finally {
    inFlightRequest = null;
  }
}

/** Recent time/venue changes for the event page's change banner. */
export const fetchEventChanges = (id: string) =>
  api<{ changes: EventChange[] }>(`/events/${encodeURIComponent(id)}`).then(r => r.changes);

export const getEventById = (events: EventType[], id: string): EventType | undefined => {
  return events.find(event => event.id === id || event.slug === id);
};

const byStart = (a: EventType, b: EventType) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();

export const getUpcomingEvents = (events: EventType[]): EventType[] => {
  return events.filter(event => event.status === 'published' && event.phase !== 'completed').sort(byStart);
};

export const getFeaturedEvents = (events: EventType[]): EventType[] => {
  return events.filter(event => event.isFeatured && event.phase !== 'completed').sort(byStart);
};

export const getCategories = (events: EventType[]): string[] => {
  return Array.from(new Set(events.map(event => event.category.name))).sort();
};
