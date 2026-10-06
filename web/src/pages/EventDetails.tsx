import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { Calendar, Clock, MapPin, Share2, Bookmark, CheckCircle2, AlertCircle, Users, ArrowLeft, Star, Ticket, XCircle, IndianRupee, Trophy, Award, Info } from 'lucide-react';
import ErrorState from '../components/ErrorState';
import { useAuth } from '../context/AuthContext';
import { useEvents } from '../context/EventsContext';
import { useUserEvents } from '../context/UserEventsContext';
import { getEventById } from '../services/eventService';
import { api } from '../services/api';
import { formatRupees, recordEventView } from '../services/studentService';
import type { CurrentUser, EventChange, EventResult, EventType } from '../types/event';
import { downloadIcs, shareEvent } from '../utils/eventActions';
import { eventDateLabel, eventTimeLabel, formatDateTime, formatLongDate, istDayKey, organizerName, venueLabel } from '../utils/format';
import { EVENT_KIND_LABEL } from '../utils/taxonomy';

/** Client-side mirror of the server's eligibility rule, for a helpful message. The server still decides. */
const isEligible = (event: EventType, user: CurrentUser) =>
  (!event.eligibleDepartments || (!!user.department && event.eligibleDepartments.includes(user.department))) &&
  (!event.eligibleYears || (user.year !== null && event.eligibleYears.includes(user.year)));

const EventDetails = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { events, loading, error, refetch } = useEvents();
  const event = getEventById(events, id || '');
  const [timeLeft, setTimeLeft] = useState<{ days: number, hours: number, mins: number }>({ days: 0, hours: 0, mins: 0 });
  const { isSaved: isEventSaved, toggleSaved, activeRegistrationFor, registrations } = useUserEvents();
  const isSaved = event ? isEventSaved(event.id) : false;
  // Short confirmation shown after Share / Add to Calendar / Save (announced to screen readers).
  const [actionMessage, setActionMessage] = useState('');
  const [changes, setChanges] = useState<EventChange[]>([]);
  const [results, setResults] = useState<EventResult[]>([]);
  const eventId = event?.id;

  // Recent time/venue changes (the change banner) and published results;
  // also counts the view for the organizer's analytics funnel.
  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    api<{ changes: EventChange[]; results: EventResult[] }>(`/events/${encodeURIComponent(eventId)}`)
      .then(r => {
        if (cancelled) return;
        setChanges(r.changes);
        setResults(r.results);
      })
      .catch(() => undefined);
    void recordEventView(eventId);
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  useEffect(() => {
    if (!actionMessage) return;
    const timer = setTimeout(() => setActionMessage(''), 3000);
    return () => clearTimeout(timer);
  }, [actionMessage]);

  useEffect(() => {
    if (event?.registrationClosesAt) {
      const closesAt = event.registrationClosesAt;
      const calculateTimeLeft = () => {
        const difference = new Date(closesAt).getTime() - new Date().getTime();
        if (difference > 0) {
          setTimeLeft({
            days: Math.floor(difference / (1000 * 60 * 60 * 24)),
            hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
            mins: Math.floor((difference / 1000 / 60) % 60)
          });
        } else {
          setTimeLeft({ days: 0, hours: 0, mins: 0 });
        }
      };

      calculateTimeLeft();
      const timer = setInterval(calculateTimeLeft, 60000); // update every minute
      return () => clearInterval(timer);
    }
  }, [event]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-8 pb-12 animate-pulse">
        <p className="sr-only" role="status">Loading event details…</p>
        <div className="h-64 md:h-96 w-full rounded-2xl bg-gray-200" />
        <div className="h-8 w-2/3 bg-gray-200 rounded" />
        <div className="h-4 w-full bg-gray-200 rounded" />
        <div className="h-4 w-5/6 bg-gray-200 rounded" />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={refetch} />;
  }

  if (!event) {
    return (
      <div className="text-center py-24">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Event Not Found</h2>
        <p className="text-gray-600 mb-6">The event you are looking for does not exist or has been removed.</p>
        <Link to="/explore" className="btn btn-primary">Back to Explore</Link>
      </div>
    );
  }

  const registration = activeRegistrationFor(event.id);
  // Only attendees can rate (blueprint §8.3 #4).
  const pastRegistration = registrations.find(r => r.eventId === event.id && (r.status === 'attended' || r.status === 'checked_in'));
  const recentChanges = event.phase === 'completed' ? [] : changes;
  const eventUrl = `${window.location.origin}/event/${event.id}`;
  const signInUrl = `/sign-in?next=${encodeURIComponent(location.pathname)}`;
  const eligible = !user || isEligible(event, user);
  const canRegister = (event.availability === 'open' || event.availability === 'closing_soon') && event.phase === 'upcoming';
  const showCountdown = canRegister && !registration;
  const canJoinWaitlist = event.availability === 'full' && event.waitlistEnabled && event.phase === 'upcoming';

  const handleShare = async () => {
    const outcome = await shareEvent(event, eventUrl);
    if (outcome === 'copied') setActionMessage('Event link copied to clipboard.');
    else if (outcome === 'failed') setActionMessage(`Couldn't share automatically. Link: ${eventUrl}`);
  };

  const handleAddToCalendar = () => {
    downloadIcs(event, eventUrl);
    setActionMessage('Calendar file downloaded — open it to add the event to your calendar.');
  };

  const handleSave = async () => {
    if (!user) {
      navigate(signInUrl);
      return;
    }
    try {
      await toggleSaved(event.id);
    } catch {
      setActionMessage("Couldn't update your saved events. Please try again.");
    }
  };

  const disabledButton = (label: string) => (
    <p className="w-full flex justify-center py-3 px-4 rounded-xl text-base font-medium text-white bg-gray-500 cursor-not-allowed">
      {label}
    </p>
  );

  const renderRegistrationAction = () => {
    if (event.status === 'cancelled') {
      return (
        <p className="w-full flex justify-center items-center py-3 px-4 rounded-xl border border-red-200 bg-red-50 text-base font-medium text-red-700">
          <XCircle className="w-5 h-5 mr-2" />
          Event cancelled
        </p>
      );
    }
    if (event.phase === 'completed') {
      return (
        <div className="space-y-3">
          {disabledButton('This event has ended')}
          {pastRegistration && !pastRegistration.hasFeedback && (
            <Link to={`/feedback/${event.id}`} className="btn btn-outline w-full">
              <Star className="w-4 h-4 mr-2" />
              Rate this Event
            </Link>
          )}
        </div>
      );
    }
    if (registration) {
      // Blueprint §4.4: the panel follows the registration's own state.
      const label: Record<string, [string, string]> = {
        waitlisted: [`#${registrations.find(r => r.id === registration.id)?.waitlistPosition ?? '?'} on the waitlist`, 'border-amber-200 bg-amber-50 text-amber-900'],
        offer_pending: ['A seat is waiting for you', 'border-indigo-200 bg-indigo-50 text-indigo-900'],
        pending_payment: ['Payment pending', 'border-amber-200 bg-amber-50 text-amber-900'],
        pending_documents: ['Documents pending', 'border-amber-200 bg-amber-50 text-amber-900'],
        checked_in: ['Checked in', 'border-green-200 bg-green-50 text-green-800'],
      };
      const [text, style] = label[registration.status] ?? ['Already Registered', 'border-green-200 bg-green-50 text-green-800'];
      const action = registration.status === 'offer_pending' ? 'Confirm my seat' : registration.status.startsWith('pending') ? 'Continue registration' : registration.status === 'waitlisted' ? 'View waitlist place' : 'View My Pass';
      return (
        <div className="space-y-3">
          <p className={`w-full flex justify-center items-center py-3 px-4 rounded-xl border text-base font-medium ${style}`}>
            <CheckCircle2 className="w-5 h-5 mr-2" />
            {text}
          </p>
          <Link
            to={`/register-success/${event.id}`}
            className="w-full flex justify-center items-center py-2 px-4 border border-indigo-600 rounded-xl text-sm font-medium text-indigo-600 hover:bg-indigo-50 transition-colors"
          >
            <Ticket className="w-4 h-4 mr-2" />
            {action}
          </Link>
        </div>
      );
    }
    if (event.availability === 'no_registration') {
      return (
        <p className="w-full text-center py-3 px-4 rounded-xl border border-gray-200 bg-gray-50 text-base font-medium text-gray-700">
          {event.registrationMode === 'not_required' ? 'No registration needed' : 'Registration details not specified'}
        </p>
      );
    }
    if (event.availability === 'not_open') return disabledButton(event.registrationOpensAt ? `Opens ${formatDateTime(event.registrationOpensAt)}` : 'Registration not open');
    if (event.availability === 'full' && !canJoinWaitlist) return disabledButton('Event Full');
    if (!canRegister && !canJoinWaitlist) return disabledButton('Registration Closed');
    if (!user) {
      return (
        <Link
          to={signInUrl}
          className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-base font-medium text-white bg-indigo-600 hover:bg-indigo-700 hover:shadow-md transition-all"
        >
          Sign in to Register
        </Link>
      );
    }
    if (!eligible) {
      return (
        <div className="space-y-2">
          {disabledButton('Not eligible')}
          <p className="text-sm text-gray-600 text-center">Open to: {event.eligibilityText}</p>
        </div>
      );
    }
    return (
      <Link
        to={`/register/${event.id}`}
        className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-base font-medium text-white bg-indigo-600 hover:bg-indigo-700 hover:shadow-md transition-all"
      >
        {canJoinWaitlist ? `Join Waitlist (${event.waitlistCount} waiting)` : (event.feeAmount ?? 0) > 0 ? `Register · ${formatRupees(event.feeAmount ?? 0)}` : 'Register Now'}
      </Link>
    );
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="flex items-center text-sm font-medium text-gray-600 hover:text-indigo-600 transition-colors"
      >
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back
      </button>

      {event.status === 'cancelled' && (
        <p role="alert" className="flex items-center p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 font-medium">
          <XCircle className="w-5 h-5 mr-2 shrink-0" />
          This event has been cancelled.
        </p>
      )}

      {recentChanges.length > 0 && event.status === 'published' && (
        <div role="note" className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900">
          <p className="flex items-center font-semibold">
            <AlertCircle className="w-5 h-5 mr-2 shrink-0" />
            This event has changed
          </p>
          <ul className="mt-2 space-y-1 text-sm pl-7">
            {recentChanges.slice(0, 2).map(c => (
              <li key={c.createdAt + c.field}>
                <span className="font-medium">{c.field === 'time' ? 'New time' : 'New venue'}:</span> {c.newValue}{' '}
                <span className="text-amber-800">(was {c.oldValue})</span>. {c.reason} · {formatDateTime(c.createdAt)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Hero Banner */}
      <div className={`relative ${event.image ? 'h-64 md:h-96' : 'h-40 md:h-48'} w-full rounded-2xl overflow-hidden shadow-lg bg-gray-100`}>
        {event.image ? (
          <img src={event.image} alt={event.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-indigo-50 to-lavender-50 flex items-center justify-center text-indigo-300 text-2xl font-semibold" aria-hidden="true">
            {EVENT_KIND_LABEL[event.eventType]}
          </div>
        )}
        <div className="absolute top-4 left-4 flex gap-2">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-white/90 backdrop-blur-sm text-indigo-800 shadow-sm">
            {event.category.name}
          </span>
          {event.isSample && (
            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-amber-100 text-amber-900 shadow-sm">Sample event</span>
          )}
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-8">
        {/* Main Content */}
        <div className="w-full md:w-2/3 space-y-8">
          <div>
            <h1 className="text-3xl md:text-4xl font-extrabold text-gray-900 mb-2">{event.title}</h1>
            <p className="text-sm text-gray-600 mb-4">{EVENT_KIND_LABEL[event.eventType]} · {organizerName(event)}</p>
            <p className="text-lg text-gray-700 leading-relaxed">{event.description}</p>
            {event.tags.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="Tags">
                {event.tags.map(t => <li key={t} className="text-xs rounded-full bg-gray-100 px-2.5 py-1 text-gray-700">{t}</li>)}
              </ul>
            )}
            {event.sourceNote && (
              <p className="mt-4 flex items-start text-sm text-gray-600">
                <Info className="w-4 h-4 mr-2 mt-0.5 shrink-0 text-gray-500" />
                {event.sourceNote}
              </p>
            )}
            {event.isSample && <p className="mt-4 text-sm text-amber-800">Sample event: fictional data for trying out EventEase.</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-start space-x-3 p-4 bg-white rounded-xl border border-gray-100 shadow-sm">
              <Calendar className="w-6 h-6 text-indigo-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-gray-500 font-medium">Date</p>
                <p className="font-semibold text-gray-900">{istDayKey(event.startsAt) === istDayKey(event.endsAt) ? formatLongDate(event.startsAt) : eventDateLabel(event)}</p>
              </div>
            </div>

            <div className="flex items-start space-x-3 p-4 bg-white rounded-xl border border-gray-100 shadow-sm">
              <Clock className="w-6 h-6 text-indigo-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-gray-500 font-medium">Time (IST)</p>
                <p className="font-semibold text-gray-900">{eventTimeLabel(event)}</p>
              </div>
            </div>

            <div className="flex items-start space-x-3 p-4 bg-white rounded-xl border border-gray-100 shadow-sm sm:col-span-2">
              <MapPin className="w-6 h-6 text-indigo-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-gray-500 font-medium">Venue</p>
                <p className="font-semibold text-gray-900">{venueLabel(event)}</p>
                {event.venue?.mapsUrl && (
                  <a href={event.venue.mapsUrl} target="_blank" rel="noreferrer" className="text-sm text-indigo-600 hover:underline">
                    Open in Maps
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm space-y-6">
            <div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Who can participate</h3>
              <p className="text-gray-700 flex items-center">
                {event.eligibilityText && <CheckCircle2 className="w-5 h-5 text-green-500 mr-2 shrink-0" />}
                {event.eligibilityText ?? 'Not specified'}
              </p>
            </div>

            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div className="flex justify-between sm:block">
                <dt className="text-gray-500">Registration</dt>
                <dd className="text-gray-900 font-medium">
                  {event.registrationMode === 'eventease'
                    ? event.registrationClosesAt
                      ? `Closes ${formatDateTime(event.registrationClosesAt)}`
                      : 'Through EventEase'
                    : event.registrationMode === 'not_required'
                      ? 'Not required'
                      : 'Not specified'}
                </dd>
              </div>
              <div className="flex justify-between sm:block">
                <dt className="text-gray-500">Fee</dt>
                <dd className="text-gray-900 font-medium">{event.feeAmount === null ? 'Not specified' : event.feeAmount === 0 ? 'Free' : formatRupees(event.feeAmount)}</dd>
              </div>
            </dl>

            {((event.feeAmount ?? 0) > 0 || event.participation === 'team') && (
              <div className="flex flex-wrap gap-2">
                {(event.feeAmount ?? 0) > 0 && (
                  <span className="inline-flex items-center rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-sm font-medium text-amber-900">
                    <IndianRupee className="w-4 h-4 mr-1" />
                    Fee {formatRupees(event.feeAmount ?? 0)}
                  </span>
                )}
                {event.participation === 'team' && (
                  <span className="inline-flex items-center rounded-full bg-indigo-50 border border-indigo-200 px-3 py-1 text-sm font-medium text-indigo-900">
                    <Users className="w-4 h-4 mr-1" />
                    Teams of {event.teamMin}–{event.teamMax}
                  </span>
                )}
                {event.certificateRule !== 'none' && (
                  <span className="inline-flex items-center rounded-full bg-green-50 border border-green-200 px-3 py-1 text-sm font-medium text-green-900">
                    <Award className="w-4 h-4 mr-1" />
                    {event.certificateRule === 'winners' ? 'Certificates for winners' : 'Certificate of participation'}
                  </span>
                )}
              </div>
            )}

            {event.requirements.length > 0 && (
              <div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">What to bring</h3>
                <ul className="list-disc pl-5 space-y-1 text-gray-700">
                  {event.requirements.map((req, idx) => (
                    <li key={idx}>{req}</li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Organizer & Contact</h3>
              <p className="text-gray-700 mb-1"><span className="font-medium">Organized by:</span> {organizerName(event)}</p>
              {event.contactPerson && (
                <p className="text-gray-700 mb-1"><span className="font-medium">Contact Person:</span> {event.contactPerson}</p>
              )}
              {event.contactEmail && (
                <p className="text-gray-700"><span className="font-medium">Email:</span> <a href={`mailto:${event.contactEmail}`} className="text-indigo-600 hover:underline">{event.contactEmail}</a></p>
              )}
            </div>
          </div>

          {results.length > 0 && (
            <section aria-labelledby="results-heading" className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm">
              <h3 id="results-heading" className="flex items-center text-lg font-bold text-gray-900 mb-3">
                <Trophy className="w-5 h-5 mr-2 text-amber-500" />
                Results
              </h3>
              <ol className="space-y-2">
                {results.map(r => (
                  <li key={r.id} className="flex items-baseline gap-3">
                    <span className="font-mono text-sm text-gray-500 w-6">#{r.position}</span>
                    <span className="font-semibold text-gray-900">{r.name}</span>
                    <span className="text-sm text-gray-600">{r.title}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {(event.recap || event.gallery.length > 0) && (
            <section aria-labelledby="recap-heading" className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm space-y-4">
              <h3 id="recap-heading" className="text-lg font-bold text-gray-900">Recap</h3>
              {event.recap && <p className="text-gray-700 whitespace-pre-line">{event.recap}</p>}
              {event.gallery.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {event.gallery.map((url, i) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer">
                      <img src={url} alt={`${event.title} photo ${i + 1}`} loading="lazy" className="w-full h-32 object-cover rounded-lg" />
                    </a>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>

        {/* Sidebar / Registration Panel */}
        <div className="w-full md:w-1/3 space-y-6">
          <div className="bg-white rounded-xl border border-indigo-100 shadow-lg p-6 sticky top-24">

            {showCountdown ? (
              <div className="mb-6">
                <p className="text-sm font-semibold text-red-600 uppercase tracking-wider mb-2 flex items-center">
                  <AlertCircle className="w-4 h-4 mr-1" />
                  Registration Closes In
                </p>
                <div className="flex space-x-2 text-center">
                  <div className="bg-red-50 text-red-700 rounded-lg p-2 w-16">
                    <span className="block text-2xl font-bold">{timeLeft.days}</span>
                    <span className="text-xs uppercase">Days</span>
                  </div>
                  <div className="bg-red-50 text-red-700 rounded-lg p-2 w-16">
                    <span className="block text-2xl font-bold">{timeLeft.hours}</span>
                    <span className="text-xs uppercase">Hrs</span>
                  </div>
                  <div className="bg-red-50 text-red-700 rounded-lg p-2 w-16">
                    <span className="block text-2xl font-bold">{timeLeft.mins}</span>
                    <span className="text-xs uppercase">Mins</span>
                  </div>
                </div>
              </div>
            ) : event.availability === 'not_open' && event.phase === 'upcoming' ? (
              <p className="mb-6 text-sm text-gray-700">
                Registration opens <span className="font-semibold">{event.registrationOpensAt ? formatDateTime(event.registrationOpensAt) : 'soon'}</span>.
              </p>
            ) : null}

            {event.registrationMode === 'eventease' && event.capacity !== null && (
              <>
                <div className="flex items-center justify-between mb-6 text-sm text-gray-600">
                  <span className="flex items-center">
                    <Users className="w-4 h-4 mr-1" />
                    Seats taken
                  </span>
                  <span className="font-bold text-gray-900">{event.seatsTaken} / {event.capacity}</span>
                </div>
                {/* Registration Progress Bar */}
                <div className="w-full bg-gray-200 rounded-full h-2 mb-6">
                  <div className="bg-indigo-600 h-2 rounded-full" style={{ width: `${Math.min(100, (event.seatsTaken / event.capacity) * 100)}%` }}></div>
                </div>
              </>
            )}
            {event.registrationMode === 'eventease' && event.capacity === null && <p className="mb-6 text-sm text-gray-600">No seat limit</p>}

            {renderRegistrationAction()}

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={handleSave}
                aria-pressed={isSaved}
                className={`flex items-center justify-center py-2 px-3 border rounded-lg text-sm font-medium transition-colors ${
                  isSaved ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Bookmark className={`w-4 h-4 mr-2 shrink-0 ${isSaved ? 'fill-indigo-600' : ''}`} />
                {isSaved ? 'Saved' : 'Save'}
              </button>
              <button
                type="button"
                onClick={handleShare}
                className="flex items-center justify-center py-2 px-3 border border-gray-300 rounded-lg text-sm font-medium bg-white text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Share2 className="w-4 h-4 mr-2" />
                Share
              </button>
            </div>

            <button
              type="button"
              onClick={handleAddToCalendar}
              className="w-full mt-3 flex items-center justify-center py-2 px-3 text-sm font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
            >
              <Calendar className="w-4 h-4 mr-2" />
              Add to Calendar
            </button>
            <p role="status" className="text-center text-xs text-gray-600 break-words [&:not(:empty)]:mt-2">
              {actionMessage}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EventDetails;
