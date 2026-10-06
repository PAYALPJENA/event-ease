import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { EventType } from '../types/event';
import { fetchEvents } from '../services/eventService';

interface EventsContextValue {
  events: EventType[];
  loading: boolean;
  error: string | null;
  /** Re-requests the list (e.g. after a registration changed seat counts). */
  refetch: () => Promise<void>;
}

const EventsContext = createContext<EventsContextValue | undefined>(undefined);

/**
 * Fetches the published events once when the app loads and shares them with
 * every page through context, so navigating between pages never re-requests
 * the data. `refetch()` refreshes in the background: pages keep showing the
 * current list instead of flashing back to skeletons.
 */
export const EventsProvider = ({ children }: { children: ReactNode }) => {
  const [events, setEvents] = useState<EventType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchEvents()
      .then(data => {
        if (!cancelled) setEvents(data);
      })
      .catch(() => {
        if (!cancelled) setError('Unable to load events. Please try again.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refetch = useCallback(async () => {
    setError(null);
    setLoading(current => current || events.length === 0);
    try {
      setEvents(await fetchEvents({ force: true }));
    } catch {
      setError('Unable to load events. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [events.length]);

  const value = useMemo(() => ({ events, loading, error, refetch }), [events, loading, error, refetch]);

  return <EventsContext.Provider value={value}>{children}</EventsContext.Provider>;
};

export const useEvents = (): EventsContextValue => {
  const context = useContext(EventsContext);
  if (!context) {
    throw new Error('useEvents must be used within an EventsProvider');
  }
  return context;
};
