import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import EventCard from '../components/EventCard';
import { EventCardSkeletonGrid } from '../components/EventCardSkeleton';
import ErrorState from '../components/ErrorState';
import { useEvents } from '../context/EventsContext';
import { useUserEvents } from '../context/UserEventsContext';
import { ApiError } from '../services/api';
import { Award, Calendar as CalendarIcon, CheckCircle2, Star, Ticket } from 'lucide-react';
import type { EventType, MyRegistration } from '../types/event';
import { formatTime } from '../utils/format';
import { registrationStatusLabel } from '../utils/status';

const byStart = (a: { startsAt: string }, b: { startsAt: string }) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();

type Tab = 'upcoming' | 'applications' | 'past' | 'saved';

/** Registrations still in progress (blueprint §4.7 "Applications"). */
const IN_PROGRESS = ['pending_payment', 'pending_documents', 'waitlisted', 'offer_pending'];

/** Cancel with an in-page confirmation step (no browser dialog). */
const CancelRegistration = ({ registration, onError }: { registration: MyRegistration; onError: (message: string) => void }) => {
  const { cancel } = useUserEvents();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="w-full text-sm font-medium text-red-600 hover:text-red-700 py-1">
        Cancel registration
      </button>
    );
  }
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
      <p className="text-red-800 mb-2">Cancel your registration? Your seat will be released.</p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await cancel(registration.id);
            } catch (err) {
              onError(err instanceof ApiError ? err.message : 'Could not cancel. Please try again.');
              setBusy(false);
              setConfirming(false);
            }
          }}
          className="btn bg-red-600 text-white hover:bg-red-700 flex-1"
        >
          {busy ? 'Cancelling…' : 'Yes, cancel'}
        </button>
        <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="btn btn-secondary flex-1">
          Keep it
        </button>
      </div>
    </div>
  );
};

const MyEvents = () => {
  const { events, loading: eventsLoading, error: eventsError, refetch } = useEvents();
  const { registrations, savedEventIds, loading, error, refresh } = useUserEvents();
  const [activeTab, setActiveTab] = useState<Tab>('upcoming');
  const [actionError, setActionError] = useState<string | null>(null);

  const { upcoming, applications, past, saved } = useMemo(() => {
    // A student may have registered, cancelled and registered again; show the latest per event.
    const latest = new Map<string, MyRegistration>();
    for (const r of registrations) if (!latest.has(r.eventId)) latest.set(r.eventId, r);
    const regs = [...latest.values()];
    const savedEvents = events.filter(e => savedEventIds.includes(e.id));
    return {
      upcoming: regs.filter(r => r.event.phase !== 'completed' && !IN_PROGRESS.includes(r.status) && r.status !== 'waitlist_expired').sort((a, b) => byStart(a.event, b.event)),
      applications: regs.filter(r => r.event.phase !== 'completed' && IN_PROGRESS.includes(r.status)).sort((a, b) => byStart(a.event, b.event)),
      past: regs.filter(r => r.event.phase === 'completed' && ['attended', 'checked_in', 'no_show', 'confirmed'].includes(r.status)).sort((a, b) => byStart(b.event, a.event)),
      saved: savedEvents.sort(byStart),
    };
  }, [registrations, events, savedEventIds]);

  const tabs: { id: Tab; label: string; shortLabel: string; count: number }[] = [
    { id: 'upcoming', label: 'Upcoming Registrations', shortLabel: 'Upcoming', count: upcoming.length },
    { id: 'applications', label: 'Applications', shortLabel: 'Pending', count: applications.length },
    { id: 'past', label: 'Past Events', shortLabel: 'Past', count: past.length },
    { id: 'saved', label: 'Saved', shortLabel: 'Saved', count: saved.length },
  ];

  const renderRegistrationCard = (r: MyRegistration) => {
    const isCancelled = r.status === 'cancelled';
    let action = null;
    // Only attendees (checked in at the door) can rate an event (blueprint §8.3 #4).
    const attended = r.status === 'attended' || r.status === 'checked_in';
    if (activeTab === 'past' && !attended) {
      action = <p className="text-center text-sm text-gray-600">You weren't checked in at this event, so it can't be rated.</p>;
    } else if (activeTab === 'past') {
      action = (
        <div className="space-y-2">
          {r.hasFeedback ? (
            <p className="flex items-center justify-center text-sm text-green-700 font-medium">
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Feedback submitted
            </p>
          ) : (
            <Link to={`/feedback/${r.event.id}`} className="btn btn-outline w-full" aria-label={`Rate this Event: ${r.event.title}`}>
              <Star className="w-4 h-4 mr-2" />
              Rate this Event
            </Link>
          )}
          {r.hasCertificate && (
            <Link to="/certificates" className="btn btn-secondary w-full">
              <Award className="w-4 h-4 mr-2" />
              Certificate
            </Link>
          )}
        </div>
      );
    } else if (activeTab === 'applications') {
      const next: Record<string, string> = {
        pending_payment: 'Complete payment',
        pending_documents: 'Upload documents',
        waitlisted: `#${r.waitlistPosition} on the waitlist`,
        offer_pending: 'Confirm your seat',
      };
      action = (
        <Link to={`/register-success/${r.event.id}`} state={{ registrationId: r.id }} className={r.status === 'waitlisted' ? 'btn btn-secondary w-full' : 'btn btn-primary w-full'}>
          {next[r.status] ?? 'View'}
        </Link>
      );
    } else if (!isCancelled) {
      action = (
        <div className="space-y-2">
          <Link to={`/register-success/${r.event.id}`} state={{ registrationId: r.id }} className="btn btn-secondary w-full">
            <Ticket className="w-4 h-4 mr-2" />
            View Pass
          </Link>
          {r.event.phase === 'upcoming' && r.status === 'confirmed' && <CancelRegistration registration={r} onError={setActionError} />}
        </div>
      );
    }
    // Before the end-of-event job runs, a checked-in registration for a finished event reads as attended.
    const status = registrationStatusLabel(r.status === 'checked_in' && r.event.phase === 'completed' ? 'attended' : r.status);
    return (
      <EventCard
        key={r.id}
        event={r.event}
        status={{
          heading: 'Your registration',
          label: r.status === 'checked_in' && r.checkedInAt && r.event.phase !== 'completed' ? `Checked in ${formatTime(r.checkedInAt)}` : status.label,
          className: status.className,
        }}
        action={action}
      />
    );
  };

  const isLoading = loading || (eventsLoading && activeTab === 'saved');
  const loadError = error ?? (activeTab === 'saved' ? eventsError : null);
  const items: (MyRegistration | EventType)[] = activeTab === 'upcoming' ? upcoming : activeTab === 'applications' ? applications : activeTab === 'past' ? past : saved;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">My Events</h1>
        <p className="text-gray-600">Track your registrations and saved events.</p>
      </div>

      <div className="flex border-b border-gray-200 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={activeTab === tab.id}
            className={`pb-4 px-4 sm:px-6 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="sm:hidden">{tab.shortLabel}</span>
            <span className="hidden sm:inline">{tab.label}</span>
            {tab.count > 0 && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{tab.count}</span>}
          </button>
        ))}
      </div>

      {actionError && (
        <p role="alert" className="text-sm text-red-600">{actionError}</p>
      )}

      {loadError ? (
        <ErrorState message={loadError} onRetry={activeTab === 'saved' && !error ? refetch : refresh} />
      ) : isLoading ? (
        <EventCardSkeletonGrid />
      ) : items.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {activeTab === 'saved'
            ? saved.map(event => <EventCard key={event.id} event={event} />)
            : (items as MyRegistration[]).map(renderRegistrationCard)}
        </div>
      ) : (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col items-center justify-center">
          <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
            <CalendarIcon className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-1">No events found</h3>
          <p className="text-gray-500">
            {activeTab === 'upcoming' && "You haven't registered for any upcoming events."}
            {activeTab === 'applications' && 'Registrations waiting for payment, documents or a waitlist seat appear here.'}
            {activeTab === 'past' && "Events you've registered for appear here after they end. If you checked in, you can rate them."}
            {activeTab === 'saved' && "You haven't saved any events yet."}
          </p>
          <Link to="/explore" className="mt-4 text-sm font-medium text-indigo-600 hover:text-indigo-800 transition-colors">
            Browse events
          </Link>
        </div>
      )}
    </div>
  );
};

export default MyEvents;
