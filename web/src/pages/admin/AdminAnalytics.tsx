import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { BarList, StatTile, pct } from '../../components/Charts';
import { fetchAdminEvent, fetchAnalytics } from '../../services/adminService';
import type { AdminEvent, EventAnalytics } from '../../services/adminService';
import { ApiError } from '../../services/api';
import { formatShortDate, organizerName } from '../../utils/format';

const DIMENSION_LABEL: Record<string, string> = {
  content: 'Content',
  speaker: 'Speakers',
  organization: 'Organization',
  venue: 'Venue',
  registration: 'Registration experience',
};

/** Organizer analytics for one event (blueprint §5 "Event overview", "Feedback & analytics"; V4 funnel). */
const AdminAnalytics = () => {
  const { id = '' } = useParams<{ id: string }>();
  const [event, setEvent] = useState<AdminEvent | null>(null);
  const [data, setData] = useState<EventAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchAdminEvent(id), fetchAnalytics(id)])
      .then(([e, a]) => {
        setEvent(e.event);
        setData(a);
      })
      .catch(err => setError(err instanceof ApiError ? err.message : 'Unable to load analytics.'));
  }, [id]);

  if (error) return <p role="alert" className="py-12 text-center text-red-600">{error}</p>;
  if (!event || !data) return <p role="status" className="py-12 text-center text-gray-500">Loading analytics…</p>;

  const { funnel, feedback, comparison } = data;
  const dimensions = Object.entries(feedback.dimensions).filter(([, v]) => v !== null) as [string, number][];

  return (
    <div className="space-y-8 max-w-5xl">
      <Link to="/admin" className="flex items-center text-sm font-medium text-gray-600 hover:text-indigo-600">
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to Organizer
      </Link>
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-1">Analytics: {event.title}</h1>
        <p className="text-gray-600">{formatShortDate(event.startsAt)} · {organizerName(event)}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label={`seats filled of ${data.capacity}`} value={pct(data.fillRate)} />
        <StatTile label="on the waitlist" value={data.waitlisted} />
        <StatTile label="no-show rate" value={pct(data.noShowRate)} hint={comparison.pastAttendanceRate !== null ? `Your past events: ${100 - comparison.pastAttendanceRate}%` : undefined} />
        <StatTile
          label="average rating"
          value={feedback.overall === null ? '—' : `${feedback.overall} / 5`}
          hint={comparison.pastAverageRating !== null ? `Your past events: ${comparison.pastAverageRating}` : undefined}
        />
      </div>

      <section aria-labelledby="funnel-heading" className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
        <div>
          <h2 id="funnel-heading" className="text-lg font-bold text-gray-900">Funnel</h2>
          <p className="text-sm text-gray-600">Unique viewers of the event page, and how many went on to register, attend and give feedback.</p>
        </div>
        <BarList
          caption="Event funnel: views, registrations, attendance, feedback"
          data={[
            { label: 'Viewed the event page', value: funnel.views },
            { label: 'Registered', value: funnel.registrations, suffix: funnel.viewToRegistration !== null ? `(${funnel.viewToRegistration}% of viewers)` : undefined },
            { label: 'Attended', value: funnel.attended, suffix: funnel.registrationToAttendance !== null ? `(${funnel.registrationToAttendance}% of registered)` : undefined },
            { label: 'Gave feedback', value: funnel.feedback, suffix: funnel.attendanceToFeedback !== null ? `(${funnel.attendanceToFeedback}% of attendees)` : undefined },
          ]}
        />
        <p className="text-xs text-gray-500">Views are counted once per person per day. Page views before this feature existed aren't included.</p>
      </section>

      <section aria-labelledby="feedback-heading" className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
        <div>
          <h2 id="feedback-heading" className="text-lg font-bold text-gray-900">Feedback by dimension</h2>
          <p className="text-sm text-gray-600">
            {feedback.count} response{feedback.count === 1 ? '' : 's'}
            {feedback.wouldAttendAgain !== null && ` · ${feedback.wouldAttendAgain}% would attend a similar event again`}
          </p>
        </div>
        {dimensions.length === 0 ? (
          <p className="text-sm text-gray-600">No ratings yet. Attendees are asked for feedback the morning after the event.</p>
        ) : (
          <BarList caption="Average rating per feedback dimension, out of 5" max={5} format={v => v.toFixed(1)} data={dimensions.map(([k, v]) => ({ label: DIMENSION_LABEL[k] ?? k, value: v, suffix: '/ 5' }))} />
        )}
      </section>

      {data.viewsPerDay.length > 0 && (
        <section aria-labelledby="views-heading" className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
          <h2 id="views-heading" className="text-lg font-bold text-gray-900">Page views per day</h2>
          <BarList caption="Unique event page views per day" data={data.viewsPerDay.slice(-14).map(d => ({ label: formatShortDate(`${d.day}T06:00:00Z`), value: d.count }))} />
        </section>
      )}
    </div>
  );
};

export default AdminAnalytics;
