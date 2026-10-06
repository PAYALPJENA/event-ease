import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Users, Send, XCircle, ScanLine, Megaphone, ClipboardCheck, Mail, MessageSquareWarning, Trophy, BarChart3, Building2, Briefcase, LineChart, IndianRupee } from 'lucide-react';
import ErrorState from '../../components/ErrorState';
import { useAuth } from '../../context/AuthContext';
import { useEvents } from '../../context/EventsContext';
import { cancelEvent, fetchAdminEvents, fetchApprovals, publishEvent, submitEvent } from '../../services/adminService';
import type { AdminEvent } from '../../services/adminService';
import { ApiError } from '../../services/api';
import { formatDateTime, formatShortDate, formatTime, organizerName } from '../../utils/format';
import { eventStatusBadge } from '../../utils/status';

/**
 * Cancel with a required reason, confirmed in the page (no browser dialog).
 * Organizers of events with registrations send a request to an admin instead.
 */
const CancelEventForm = ({
  event,
  isAdmin,
  onDone,
  onClose,
}: {
  event: AdminEvent;
  isAdmin: boolean;
  onDone: (status: 'cancelled' | 'cancel_requested') => Promise<void>;
  onClose: () => void;
}) => {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsApproval = !isAdmin && event.seatsTaken > 0;
  return (
    <form
      className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 space-y-2"
      onSubmit={async e => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const { status } = await cancelEvent(event.id, reason.trim());
          await onDone(status);
        } catch (err) {
          setError(err instanceof ApiError ? err.message : 'Could not cancel the event.');
          setBusy(false);
        }
      }}
    >
      <label htmlFor={`cancel-${event.id}`} className="block text-sm font-medium text-red-900">
        {needsApproval
          ? `Reason for cancelling. ${event.seatsTaken} student${event.seatsTaken === 1 ? ' is' : 's are'} registered, so an administrator will confirm before they are notified.`
          : `Reason for cancelling${event.seatsTaken ? ` (sent to the ${event.seatsTaken} registered student${event.seatsTaken === 1 ? '' : 's'})` : ''}`}
      </label>
      <input id={`cancel-${event.id}`} className="input-field" required minLength={3} maxLength={300} value={reason} onChange={e => setReason(e.target.value)} />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn bg-red-600 text-white hover:bg-red-700">
          {busy ? 'Sending…' : needsApproval ? 'Request cancellation' : 'Cancel event'}
        </button>
        <button type="button" disabled={busy} onClick={onClose} className="btn btn-secondary">Keep event</button>
      </div>
    </form>
  );
};

const reviewLabel: Record<string, string> = {
  changes_requested: 'Changes requested',
  rejected: 'Reason',
  cancel_declined: 'Cancellation declined',
};

const AdminEvents = () => {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('admin');
  const { refetch: refetchPublicEvents } = useEvents();
  const [events, setEvents] = useState<AdminEvent[] | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [clashId, setClashId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, approvals] = await Promise.all([fetchAdminEvents(), isAdmin ? fetchApprovals() : Promise.resolve(null)]);
      setEvents(list);
      if (approvals) setPendingCount(approvals.pending.length + approvals.cancelRequests.length);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load events.');
    }
  }, [isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const afterChange = async (text: string) => {
    setMessage(text);
    setCancellingId(null);
    setClashId(null);
    await Promise.all([load(), refetchPublicEvents()]);
  };

  const run = async (action: () => Promise<unknown>, success: string, eventId?: string) => {
    try {
      await action();
      await afterChange(success);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'venue_clash' && isAdmin && eventId) setClashId(eventId);
      setMessage(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    }
  };

  const canEdit = (e: AdminEvent) =>
    ['draft', 'changes_requested'].includes(e.status) ||
    (e.status === 'pending_approval' && isAdmin) ||
    (e.status === 'published' && e.phase !== 'completed');
  const isLive = (e: AdminEvent) => e.status === 'published' && e.phase !== 'completed';

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Organizer</h1>
          <p className="text-gray-600">
            {isAdmin
              ? 'Review, publish and manage events across the university.'
              : "Create events, submit them for approval, and run them on the day."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/admin/organizations" className="btn btn-secondary">
            <Building2 className="w-4 h-4 mr-2" />
            {isAdmin ? 'Clubs' : 'Club pages'}
          </Link>
          <Link to="/admin/opportunities" className="btn btn-secondary">
            <Briefcase className="w-4 h-4 mr-2" />
            Opportunities
          </Link>
          {isAdmin && (
            <>
              <Link to="/admin/insights" className="btn btn-secondary">
                <LineChart className="w-4 h-4 mr-2" />
                Insights
              </Link>
              <Link to="/admin/payments" className="btn btn-secondary">
                <IndianRupee className="w-4 h-4 mr-2" />
                Payments
              </Link>
              <Link to="/admin/approvals" className="btn btn-secondary">
                <ClipboardCheck className="w-4 h-4 mr-2" />
                Approvals
                {pendingCount > 0 && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">{pendingCount}</span>}
              </Link>
              <Link to="/admin/outbox" className="btn btn-secondary">
                <Mail className="w-4 h-4 mr-2" />
                Message log
              </Link>
            </>
          )}
          <Link to="/admin/events/new" className="btn btn-primary">
            <Plus className="w-4 h-4 mr-2" />
            New event
          </Link>
        </div>
      </div>

      <p role="status" className="sr-only">{message}</p>
      {message && <p className="text-sm text-gray-700 bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-3">{message}</p>}

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : events === null ? (
        <p role="status" className="text-gray-500">Loading events…</p>
      ) : events.length === 0 ? (
        <p className="text-gray-600">No events yet. Create your first one.</p>
      ) : (
        <ul className="space-y-4">
          {events.map(event => {
            const badge = eventStatusBadge(event);
            const review = event.latestReview;
            const showReview = review && review.comments && reviewLabel[review.action] && (event.status !== 'published' || review.action === 'cancel_declined');
            return (
              <li key={event.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${badge.className}`}>{badge.label}</span>
                      {event.cancelRequest && (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800">Cancellation requested</span>
                      )}
                      <span className="text-xs text-gray-600">{organizerName(event)}</span>
                    </div>
                    <h2 className="text-lg font-bold text-gray-900 truncate">
                      {event.status === 'published' || event.status === 'cancelled' ? (
                        <Link to={`/event/${event.id}`} className="hover:text-indigo-700">{event.title}</Link>
                      ) : (
                        event.title
                      )}
                    </h2>
                    <p className="text-sm text-gray-600">
                      {formatShortDate(event.startsAt)} · {formatTime(event.startsAt)} · {event.seatsTaken} / {event.capacity} registered
                    </p>
                    {showReview && (
                      <p className="mt-2 flex items-start text-sm text-orange-900 bg-orange-50 border border-orange-100 rounded-lg px-3 py-2">
                        <MessageSquareWarning className="w-4 h-4 mr-2 mt-0.5 shrink-0" />
                        <span>
                          <span className="font-semibold">{reviewLabel[review.action]}:</span> {review.comments}
                          <span className="block text-xs text-orange-800 mt-0.5">{review.actorName} · {formatDateTime(review.createdAt)}</span>
                        </span>
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(event.status === 'draft' || event.status === 'changes_requested') &&
                      (isAdmin ? (
                        <button type="button" onClick={() => run(() => publishEvent(event.id), `"${event.title}" is now published.`, event.id)} className="btn btn-primary">
                          <Send className="w-4 h-4 mr-2" />
                          Publish
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => run(() => submitEvent(event.id), `"${event.title}" was sent for approval. You'll be notified when it's reviewed.`)}
                          className="btn btn-primary"
                        >
                          <Send className="w-4 h-4 mr-2" />
                          {event.status === 'changes_requested' ? 'Resubmit' : 'Submit for approval'}
                        </button>
                      ))}
                    {isAdmin && event.status === 'pending_approval' && (
                      <Link to="/admin/approvals" className="btn btn-primary">
                        <ClipboardCheck className="w-4 h-4 mr-2" />
                        Review
                      </Link>
                    )}
                    {canEdit(event) && (
                      <Link to={`/admin/events/${event.id}/edit`} className="btn btn-secondary">
                        <Pencil className="w-4 h-4 mr-2" />
                        Edit
                      </Link>
                    )}
                    {isLive(event) && (
                      <Link to={`/admin/events/${event.id}/check-in`} className="btn btn-secondary">
                        <ScanLine className="w-4 h-4 mr-2" />
                        Check-in
                      </Link>
                    )}
                    {(event.status === 'published' || event.status === 'cancelled') && (
                      <Link to={`/admin/events/${event.id}/participants`} className="btn btn-secondary">
                        <Users className="w-4 h-4 mr-2" />
                        Participants
                      </Link>
                    )}
                    {event.status === 'published' && event.phase === 'completed' && (
                      <Link to={`/admin/events/${event.id}/wrap-up`} className="btn btn-primary">
                        <Trophy className="w-4 h-4 mr-2" />
                        Results & certificates
                      </Link>
                    )}
                    {(event.status === 'published' || event.status === 'cancelled') && (
                      <Link to={`/admin/events/${event.id}/analytics`} className="btn btn-secondary">
                        <BarChart3 className="w-4 h-4 mr-2" />
                        Analytics
                      </Link>
                    )}
                    {event.status === 'published' && (
                      <Link to={`/admin/events/${event.id}/announcements`} className="btn btn-secondary">
                        <Megaphone className="w-4 h-4 mr-2" />
                        Announce
                      </Link>
                    )}
                    {!['cancelled', 'rejected'].includes(event.status) && event.phase !== 'completed' && !event.cancelRequest && (
                      <button
                        type="button"
                        onClick={() => setCancellingId(cancellingId === event.id ? null : event.id)}
                        aria-expanded={cancellingId === event.id}
                        className="btn btn-secondary text-red-600"
                      >
                        <XCircle className="w-4 h-4 mr-2" />
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
                {clashId === event.id && (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex flex-col sm:flex-row sm:items-center gap-3">
                    <p className="flex-1">Publishing anyway double-books the venue. The override is recorded in the audit log.</p>
                    <button type="button" className="btn btn-secondary" onClick={() => run(() => publishEvent(event.id, true), `"${event.title}" is now published (venue clash overridden).`)}>
                      Publish anyway
                    </button>
                  </div>
                )}
                {cancellingId === event.id && (
                  <CancelEventForm
                    event={event}
                    isAdmin={isAdmin}
                    onClose={() => setCancellingId(null)}
                    onDone={status =>
                      afterChange(
                        status === 'cancelled'
                          ? `"${event.title}" was cancelled${event.seatsTaken ? ' and registered students were notified' : ''}.`
                          : `Cancellation of "${event.title}" was sent to an administrator to confirm.`
                      )
                    }
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default AdminEvents;
