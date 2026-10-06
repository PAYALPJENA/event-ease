import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  cancelRegistration,
  fetchMyRegistrations,
  fetchSavedEventIds,
  registerForEvent,
  setEventSaved,
} from '../services/registrationService';
import type { RegistrationPayload } from '../services/registrationService';
import type { MyRegistration, PaymentOrder, RegistrationSummary } from '../types/event';
import { useAuth } from './AuthContext';
import { useEvents } from './EventsContext';

/**
 * The signed-in student's own activity — registrations and saved events —
 * loaded from the API. The server is the source of truth; this context keeps
 * a copy so every page (Event Details, My Events, Calendar, Navbar) agrees.
 */

interface UserEventsContextValue {
  registrations: MyRegistration[];
  savedEventIds: string[];
  loading: boolean;
  error: string | null;
  /** The student's active registration for an event (anything but cancelled or an expired waitlist place). */
  activeRegistrationFor: (eventId: string) => MyRegistration | undefined;
  isRegistered: (eventId: string) => boolean;
  isSaved: (eventId: string) => boolean;
  register: (eventId: string, payload: RegistrationPayload) => Promise<{ registration: RegistrationSummary; payment: PaymentOrder | null }>;
  cancel: (registrationId: string) => Promise<void>;
  toggleSaved: (eventId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const UserEventsContext = createContext<UserEventsContextValue | undefined>(undefined);

export const UserEventsProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const { refetch: refetchEvents } = useEvents();
  const [registrations, setRegistrations] = useState<MyRegistration[]>([]);
  const [savedEventIds, setSavedEventIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [regs, saved] = await Promise.all([fetchMyRegistrations(), fetchSavedEventIds()]);
    setRegistrations(regs);
    setSavedEventIds(saved);
  }, []);

  useEffect(() => {
    if (!user) {
      setRegistrations([]);
      setSavedEventIds([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchMyRegistrations(), fetchSavedEventIds()])
      .then(([regs, saved]) => {
        if (cancelled) return;
        setRegistrations(regs);
        setSavedEventIds(saved);
      })
      .catch(() => {
        if (!cancelled) setError('Unable to load your events. Please try again.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      await load();
    } catch {
      setError('Unable to load your events. Please try again.');
    }
  }, [load]);

  const register = useCallback(
    async (eventId: string, payload: RegistrationPayload) => {
      const result = await registerForEvent(eventId, payload);
      // Seat counts changed; refresh both the student's list and the event list.
      await Promise.all([load(), refetchEvents()]);
      return result;
    },
    [load, refetchEvents]
  );

  const cancel = useCallback(
    async (registrationId: string) => {
      await cancelRegistration(registrationId);
      await Promise.all([load(), refetchEvents()]);
    },
    [load, refetchEvents]
  );

  const toggleSaved = useCallback(
    async (eventId: string) => {
      const saved = !savedEventIds.includes(eventId);
      // Optimistic update; roll back if the server rejects it.
      setSavedEventIds(ids => (saved ? [...ids, eventId] : ids.filter(id => id !== eventId)));
      try {
        await setEventSaved(eventId, saved);
      } catch (err) {
        setSavedEventIds(ids => (saved ? ids.filter(id => id !== eventId) : [...ids, eventId]));
        throw err;
      }
    },
    [savedEventIds]
  );

  const value = useMemo(() => {
    const activeRegistrationFor = (eventId: string) =>
      registrations.find(r => r.eventId === eventId && r.status !== 'cancelled' && r.status !== 'waitlist_expired');
    return {
      registrations,
      savedEventIds,
      loading,
      error,
      activeRegistrationFor,
      isRegistered: (eventId: string) => !!activeRegistrationFor(eventId),
      isSaved: (eventId: string) => savedEventIds.includes(eventId),
      register,
      cancel,
      toggleSaved,
      refresh,
    };
  }, [registrations, savedEventIds, loading, error, register, cancel, toggleSaved, refresh]);

  return <UserEventsContext.Provider value={value}>{children}</UserEventsContext.Provider>;
};

export const useUserEvents = (): UserEventsContextValue => {
  const context = useContext(UserEventsContext);
  if (!context) throw new Error('useUserEvents must be used within a UserEventsProvider');
  return context;
};
