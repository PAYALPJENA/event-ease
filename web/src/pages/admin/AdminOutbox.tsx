import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import ErrorState from '../../components/ErrorState';
import { fetchOutbox } from '../../services/adminService';
import type { OutboxEmail } from '../../services/adminService';
import { ApiError } from '../../services/api';
import { formatDateTime } from '../../utils/format';

const statusStyle: Record<OutboxEmail['status'], string> = {
  sent: 'text-green-700',
  pending: 'text-amber-700',
  failed: 'text-red-600',
};

const CHANNEL_LABEL: Record<OutboxEmail['channel'], string> = { email: 'Email', push: 'Push', sms: 'SMS', whatsapp: 'WhatsApp' };

/** The last 100 outgoing messages on every channel, and their delivery state (admins only). */
const AdminOutbox = () => {
  const [channel, setChannel] = useState('');
  const [data, setData] = useState<{ mailMode: string; modes: Record<string, string>; emails: OutboxEmail[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await fetchOutbox(channel || undefined));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load the message log.');
    }
  }, [channel]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6 max-w-4xl">
      <Link to="/admin" className="flex items-center text-sm font-medium text-gray-600 hover:text-indigo-600">
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to Organizer
      </Link>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Message log</h1>
          <p className="text-gray-600">
            Confirmations, reminders, changes and announcements sent by email, push, SMS and WhatsApp, following each student's preferences.
            {data && ` Channels: ${Object.entries(data.modes).map(([k, v]) => `${CHANNEL_LABEL[k as OutboxEmail['channel']]} ${v === 'console' ? 'printed in the API terminal (development)' : 'off'}`).join(' · ')}.`}
          </p>
        </div>
        <div className="flex gap-2">
          <label htmlFor="channel" className="sr-only">Channel</label>
          <select id="channel" className="input-field" value={channel} onChange={e => setChannel(e.target.value)}>
            <option value="">All channels</option>
            {Object.entries(CHANNEL_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button type="button" onClick={() => void load()} className="btn btn-secondary">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !data ? (
        <p role="status" className="text-gray-500">Loading…</p>
      ) : data.emails.length === 0 ? (
        <p className="text-gray-600">No messages yet.</p>
      ) : (
        <ul className="space-y-3">
          {data.emails.map(e => (
            <li key={e.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <details>
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1">
                    <p className="font-semibold text-gray-900">{e.subject}</p>
                    <p className={`text-sm font-medium ${statusStyle[e.status]}`}>
                      {e.status === 'sent' ? 'Sent' : e.status === 'pending' ? 'Queued' : 'Failed'}
                      {e.attempts > 1 && ` after ${e.attempts} attempts`}
                    </p>
                  </div>
                  <p className="text-sm text-gray-600">
                    <span className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700 mr-2">{CHANNEL_LABEL[e.channel]}</span>
                    To {e.to} · {formatDateTime(e.createdAt)}
                  </p>
                </summary>
                <pre className="mt-3 whitespace-pre-wrap font-sans text-sm text-gray-800 bg-gray-50 rounded-lg p-3">{e.body}</pre>
                {e.lastError && <p className="mt-2 text-sm text-red-600">Last error: {e.lastError}</p>}
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default AdminOutbox;
