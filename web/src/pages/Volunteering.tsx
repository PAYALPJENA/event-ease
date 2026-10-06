import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ScanLine } from 'lucide-react';
import { fetchVolunteering } from '../services/studentService';
import type { EventType } from '../types/event';
import { formatShortDate, formatTimeRange, venueLabel } from '../utils/format';

/** Events the student volunteers at as check-in staff (blueprint §2.2). */
const Volunteering = () => {
  const [events, setEvents] = useState<EventType[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchVolunteering().then(setEvents).catch(() => setError(true));
  }, []);

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Volunteering</h1>
        <p className="text-gray-600">Events where you're on the check-in team. Open the scanner at the door; it keeps working offline.</p>
      </div>
      {error ? (
        <p role="alert" className="text-red-600">Unable to load your volunteering.</p>
      ) : !events ? (
        <p role="status" className="text-gray-500">Loading…</p>
      ) : events.length === 0 ? (
        <p className="text-gray-600">You're not on a check-in team for any upcoming event. Organizers add volunteers from their Participants page.</p>
      ) : (
        <ul className="space-y-4">
          {events.map(e => (
            <li key={e.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex-1">
                <h2 className="font-bold text-gray-900">{e.title}</h2>
                <p className="text-sm text-gray-600">{formatShortDate(e.startsAt)} · {formatTimeRange(e.startsAt, e.endsAt)} · {venueLabel(e)}</p>
              </div>
              <Link to={`/check-in/${e.id}`} className="btn btn-primary">
                <ScanLine className="w-4 h-4 mr-2" />
                Open scanner
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default Volunteering;
