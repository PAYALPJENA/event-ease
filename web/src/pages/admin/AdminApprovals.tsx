import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Calendar, MapPin, Users } from 'lucide-react';
import ErrorState from '../../components/ErrorState';
import { useEvents } from '../../context/EventsContext';
import { cancelEvent, declineCancelRequest, fetchApprovals, reviewEvent } from '../../services/adminService';
import type { AdminEvent, VenueClash } from '../../services/adminService';
import { ApiError } from '../../services/api';
import { formatDateTime, formatShortDate, formatTimeRange, organizerName, venueLabel } from '../../utils/format';

type Pending = AdminEvent & { clashes: VenueClash[] };
type CancelRequest = AdminEvent & { requestedBy: string | null };

/** One submitted event: preview, clash and eligibility checks, then a decision (blueprint §6). */
const ReviewCard = ({ event, onDone }: { event: Pending; onDone: (message: string) => Promise<void> }) => {
  const [comments, setComments] = useState('');
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasClash = event.clashes.length > 0;
  const commentsId = `comments-${event.id}`;

  const decide = async (decision: 'approve' | 'request_changes' | 'reject') => {
    if (decision !== 'approve' && comments.trim().length < 3) {
      setError('Add a comment so the organizer knows what to change or why.');
      document.getElementById(commentsId)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await reviewEvent(event.id, decision, comments.trim(), override);
      await onDone(
        decision === 'approve'
          ? `"${event.title}" is published.`
          : decision === 'reject'
            ? `"${event.title}" was not approved. The organizer has been told why.`
            : `Changes requested for "${event.title}".`
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the decision.');
      setBusy(false);
    }
  };

  return (
    <li className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
      <div>
        <p className="text-xs text-gray-600 mb-1">
          {organizerName(event)}
          {event.latestReview?.action === 'submitted' && ` · submitted by ${event.latestReview.actorName}, ${formatDateTime(event.latestReview.createdAt)}`}
        </p>
        <h2 className="text-lg font-bold text-gray-900">{event.title}</h2>
        {event.latestReview?.action === 'submitted' && event.latestReview.comments && (
          <p className="text-sm text-gray-700 mt-1 italic">“{event.latestReview.comments}”</p>
        )}
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <div className="flex items-start">
          <Calendar className="w-4 h-4 mr-2 mt-0.5 text-indigo-500 shrink-0" />
          <div>
            <dt className="sr-only">When</dt>
            <dd className="text-gray-800">{formatShortDate(event.startsAt)}<br />{formatTimeRange(event.startsAt, event.endsAt)}</dd>
          </div>
        </div>
        <div className="flex items-start">
          <MapPin className="w-4 h-4 mr-2 mt-0.5 text-indigo-500 shrink-0" />
          <div>
            <dt className="sr-only">Where</dt>
            <dd className="text-gray-800">{venueLabel(event)}</dd>
          </div>
        </div>
        <div className="flex items-start">
          <Users className="w-4 h-4 mr-2 mt-0.5 text-indigo-500 shrink-0" />
          <div>
            <dt className="sr-only">Who</dt>
            <dd className="text-gray-800">
              {event.capacity === null ? 'No seat limit' : `${event.capacity} seats`} · {event.eligibilityText ?? 'Eligibility not specified'}
              {(event.eligibleDepartments || event.eligibleYears) && (
                <span className="block text-xs text-gray-600">
                  Enforced: {event.eligibleDepartments?.join(', ') ?? 'all departments'} · {event.eligibleYears ? `year ${event.eligibleYears.join(', ')}` : 'all years'}
                </span>
              )}
            </dd>
          </div>
        </div>
      </dl>

      <details className="text-sm text-gray-700">
        <summary className="cursor-pointer font-medium text-indigo-700">Description and registration window</summary>
        <p className="mt-2 whitespace-pre-line">{event.description}</p>
        <p className="mt-2 text-gray-600">
          {event.registrationOpensAt && event.registrationClosesAt
            ? `Registration ${formatDateTime(event.registrationOpensAt)} – ${formatDateTime(event.registrationClosesAt)}`
            : event.registrationMode === 'not_required'
              ? 'No registration needed'
              : 'Registration details not specified'}
        </p>
      </details>

      {hasClash ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-2">
          <p className="flex items-start font-medium">
            <AlertTriangle className="w-4 h-4 mr-2 mt-0.5 shrink-0" />
            Venue clash: {venueLabel(event)} is already booked for
          </p>
          <ul className="list-disc pl-10">
            {event.clashes.map(c => (
              <li key={c.id}>{c.title} ({formatShortDate(c.startsAt)}, {formatTimeRange(c.startsAt, c.endsAt)})</li>
            ))}
          </ul>
          <label className="inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} className="mr-2 h-4 w-4 rounded border-gray-300 text-indigo-600" />
            Approve anyway (recorded in the audit log)
          </label>
        </div>
      ) : (
        <p className="text-sm text-green-700">No venue clash.</p>
      )}

      <div>
        <label htmlFor={commentsId} className="label">Comments for the organizer (required to request changes or reject)</label>
        <textarea id={commentsId} className="input-field" rows={2} maxLength={1000} value={comments} onChange={e => setComments(e.target.value)} />
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || (hasClash && !override)} onClick={() => decide('approve')} className="btn btn-primary">
          Approve and publish
        </button>
        <button type="button" disabled={busy} onClick={() => decide('request_changes')} className="btn btn-secondary">
          Request changes
        </button>
        <button type="button" disabled={busy} onClick={() => decide('reject')} className="btn btn-secondary text-red-600">
          Reject
        </button>
      </div>
    </li>
  );
};

const CancelRequestCard = ({ event, onDone }: { event: CancelRequest; onDone: (message: string) => Promise<void> }) => {
  const [comments, setComments] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (confirm: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (confirm) await cancelEvent(event.id, event.cancelRequest?.reason ?? 'Cancelled by the organizer');
      else await declineCancelRequest(event.id, comments.trim());
      await onDone(confirm ? `"${event.title}" is cancelled and ${event.seatsTaken} students were notified.` : `Cancellation of "${event.title}" declined.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the decision.');
      setBusy(false);
    }
  };
  return (
    <li className="bg-white rounded-xl border border-red-100 shadow-sm p-5 space-y-3">
      <div>
        <p className="text-xs text-gray-600 mb-1">
          {organizerName(event)} · requested by {event.requestedBy ?? 'an organizer'}
          {event.cancelRequest && `, ${formatDateTime(event.cancelRequest.requestedAt)}`}
        </p>
        <h2 className="text-lg font-bold text-gray-900">{event.title}</h2>
        <p className="text-sm text-gray-700">
          {formatShortDate(event.startsAt)} · <span className="font-semibold">{event.seatsTaken} registered</span> will be notified
        </p>
        <p className="text-sm text-gray-800 mt-2"><span className="font-semibold">Reason:</span> {event.cancelRequest?.reason}</p>
      </div>
      <div>
        <label htmlFor={`decline-${event.id}`} className="label">Reply if declining</label>
        <input id={`decline-${event.id}`} className="input-field" maxLength={500} value={comments} onChange={e => setComments(e.target.value)} />
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => act(true)} className="btn bg-red-600 text-white hover:bg-red-700">Confirm cancellation</button>
        <button type="button" disabled={busy || comments.trim().length < 3} onClick={() => act(false)} className="btn btn-secondary">Decline</button>
      </div>
    </li>
  );
};

const AdminApprovals = () => {
  const { refetch: refetchPublicEvents } = useEvents();
  const [data, setData] = useState<{ pending: Pending[]; cancelRequests: CancelRequest[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await fetchApprovals());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load approvals.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const done = async (text: string) => {
    setMessage(text);
    await Promise.all([load(), refetchPublicEvents()]);
  };

  return (
    <div className="space-y-8 max-w-4xl">
      <Link to="/admin" className="flex items-center text-sm font-medium text-gray-600 hover:text-indigo-600">
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to Organizer
      </Link>
      <div>
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Approvals</h1>
        <p className="text-gray-600">Events waiting for review, and cancellations organizers have asked you to confirm.</p>
      </div>

      <p role="status" className="sr-only">{message}</p>
      {message && <p className="text-sm text-gray-700 bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-3">{message}</p>}

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !data ? (
        <p role="status" className="text-gray-500">Loading…</p>
      ) : (
        <>
          <section aria-labelledby="pending-heading" className="space-y-4">
            <h2 id="pending-heading" className="text-xl font-bold text-gray-900">Waiting for approval ({data.pending.length})</h2>
            {data.pending.length === 0 ? (
              <p className="text-gray-600">Nothing to review.</p>
            ) : (
              <ul className="space-y-4">{data.pending.map(e => <ReviewCard key={e.id} event={e} onDone={done} />)}</ul>
            )}
          </section>
          <section aria-labelledby="cancel-heading" className="space-y-4">
            <h2 id="cancel-heading" className="text-xl font-bold text-gray-900">Cancellation requests ({data.cancelRequests.length})</h2>
            {data.cancelRequests.length === 0 ? (
              <p className="text-gray-600">No cancellation requests.</p>
            ) : (
              <ul className="space-y-4">{data.cancelRequests.map(e => <CancelRequestCard key={e.id} event={e} onDone={done} />)}</ul>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export default AdminApprovals;
