import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Send } from 'lucide-react';
import { fetchAdminEvent, fetchAnnouncements, fetchOverview, sendAnnouncement } from '../../services/adminService';
import type { Announcement, AnnouncementAudience, EventOverview } from '../../services/adminService';
import { ApiError } from '../../services/api';
import type { EventType } from '../../types/event';
import { formatDateTime, formatShortDate } from '../../utils/format';

const AUDIENCES: { value: AnnouncementAudience; label: string; count: (o: EventOverview) => number }[] = [
  { value: 'all', label: 'Everyone registered', count: o => o.registered },
  { value: 'not_checked_in', label: 'Not checked in yet', count: o => o.confirmed + o.noShow },
  { value: 'checked_in', label: 'Checked in', count: o => o.checkedIn },
];

const audienceLabel = (a: AnnouncementAudience) => AUDIENCES.find(x => x.value === a)?.label ?? a;

/** Message registrants (blueprint §5 Communication): in-app and email, and every message is logged. */
const AdminAnnouncements = () => {
  const { id = '' } = useParams<{ id: string }>();
  const [event, setEvent] = useState<EventType | null>(null);
  const [overview, setOverview] = useState<EventOverview | null>(null);
  const [history, setHistory] = useState<Announcement[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [audience, setAudience] = useState<AnnouncementAudience>('all');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [e, o, h] = await Promise.all([fetchAdminEvent(id), fetchOverview(id), fetchAnnouncements(id)]);
      setEvent(e.event);
      setOverview(o);
      setHistory(h);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Unable to load announcements.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const sent = await sendAnnouncement(id, { audience, title: title.trim(), body: body.trim() });
      setTitle('');
      setBody('');
      setMessage(`Sent to ${sent.recipientCount} student${sent.recipientCount === 1 ? '' : 's'} (in-app and email).`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the announcement.');
    } finally {
      setSending(false);
    }
  };

  if (loadError) return <p role="alert" className="py-12 text-center text-red-600">{loadError}</p>;
  if (!event || !overview) return <p role="status" className="py-12 text-center text-gray-500">Loading…</p>;

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      <Link to="/admin" className="flex items-center text-sm font-medium text-gray-600 hover:text-indigo-600">
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to Organizer
      </Link>
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-1">Announcements</h1>
        <p className="text-gray-600">{event.title} · {formatShortDate(event.startsAt)}</p>
      </div>

      {event.status !== 'published' ? (
        <p className="text-gray-700">Announcements can be sent once the event is published.</p>
      ) : (
        <form onSubmit={submit} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
          <fieldset>
            <legend className="label">Send to</legend>
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-6">
              {AUDIENCES.map(a => (
                <label key={a.value} className="inline-flex items-center text-sm text-gray-800 cursor-pointer">
                  <input type="radio" name="audience" value={a.value} checked={audience === a.value} onChange={() => setAudience(a.value)} className="mr-2 h-4 w-4 text-indigo-600" />
                  {a.label} ({a.count(overview)})
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="ann-title" className="label">Subject</label>
            <input id="ann-title" className="input-field" required minLength={3} maxLength={120} value={title} onChange={e => setTitle(e.target.value)} />
          </div>
          <div>
            <label htmlFor="ann-body" className="label">Message</label>
            <textarea id="ann-body" className="input-field" rows={4} required minLength={3} maxLength={2000} value={body} onChange={e => setBody(e.target.value)} />
          </div>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <p role="status" className="text-sm text-green-700">{message}</p>
          <button type="submit" disabled={sending} className="btn btn-primary">
            <Send className="w-4 h-4 mr-2" />
            {sending ? 'Sending…' : 'Send announcement'}
          </button>
        </form>
      )}

      <section aria-labelledby="history-heading" className="space-y-3">
        <h2 id="history-heading" className="text-lg font-bold text-gray-900">Sent ({history.length})</h2>
        {history.length === 0 ? (
          <p className="text-gray-600">Nothing sent yet.</p>
        ) : (
          <ul className="space-y-3">
            {history.map(a => (
              <li key={a.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                <p className="font-semibold text-gray-900">{a.title}</p>
                <p className="text-sm text-gray-700 mt-1 whitespace-pre-line">{a.body}</p>
                <p className="text-xs text-gray-600 mt-2">
                  {audienceLabel(a.audience)} · {a.recipientCount} recipients · {a.authorName} · {formatDateTime(a.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

export default AdminAnnouncements;
