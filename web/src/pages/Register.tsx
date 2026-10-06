import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, AlertCircle, CheckCircle2, Lock, Users, FileText, IndianRupee, Clock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useEvents } from '../context/EventsContext';
import { useUserEvents } from '../context/UserEventsContext';
import { ApiError } from '../services/api';
import { getEventById } from '../services/eventService';
import { formatRupees } from '../services/studentService';
import { formatShortDate, formatTimeRange, venueLabel } from '../utils/format';

// Indian mobile number: 10 digits starting 6-9, optionally prefixed with
// +91 or 0, with an optional space/hyphen after the prefix and after the 5th digit.
// Written for the HTML `pattern` attribute (compiled with the `v` flag, so `-` is escaped).
// The server applies the same rule.
const PHONE_PATTERN = String.raw`(?:\+91[\s\-]?|0)?[6-9][0-9]{4}[\s\-]?[0-9]{5}`;
const PHONE_ERROR = 'Enter a valid 10-digit Indian mobile number, e.g. 98765 43210 or +91 98765 43210.';

const ReadOnlyField = ({ id, label, value }: { id: string; label: string; value: string }) => (
  <div>
    <label className="label" htmlFor={id}>{label}</label>
    <input id={id} type="text" readOnly value={value} className="input-field bg-gray-50 text-gray-700 cursor-default" />
  </div>
);

const Register = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { events, loading } = useEvents();
  const { isRegistered, register } = useUserEvents();
  const event = getEventById(events, id || '');

  const [phone, setPhone] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [teamMode, setTeamMode] = useState<'create' | 'join'>('create');
  const [teamName, setTeamName] = useState('');
  const [teamCode, setTeamCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (loading) return <p role="status" className="py-24 text-center text-gray-500">Loading…</p>;
  if (!event || !user) {
    return (
      <div className="text-center py-24">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Event Not Found</h1>
        <Link to="/explore" className="btn btn-primary">Back to Explore</Link>
      </div>
    );
  }

  // Prevent duplicate registrations (e.g. /register/:id opened directly or via
  // browser back). While a submission is in flight the form stays mounted so
  // the success navigation isn't interrupted. The server also rejects duplicates.
  if (isRegistered(event.id) && !isSubmitting) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-8 h-8 text-green-700" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">You're already registered</h1>
        <p className="text-gray-600 mb-6">
          You have already registered for <span className="font-semibold text-gray-900">{event.title}</span>.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link to={`/register-success/${event.id}`} className="btn btn-primary">View My Registration</Link>
          <Link to={`/event/${event.id}`} className="btn btn-secondary">Back to Event Details</Link>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const { registration, payment } = await register(event.id, {
        phone: phone.trim(),
        agree: true,
        answers: event.questions.length ? answers : undefined,
        team: isTeam ? (teamMode === 'create' ? { create: { name: teamName.trim() } } : { join: { code: teamCode.trim() } }) : undefined,
        waitlist: joiningWaitlist || undefined,
      });
      // Paid events go to the gateway; the webhook confirms the seat (never the redirect).
      if (payment) navigate(`/pay/${payment.orderId}`);
      else navigate(`/register-success/${event.id}`, { state: { registrationId: registration.id } });
    } catch (err) {
      // The server's message says exactly why (full, closed, not eligible…).
      setSubmitError(err instanceof ApiError ? err.message : 'Registration could not be completed. Please try again.');
      setIsSubmitting(false);
    }
  };

  const isTeam = event.participation === 'team';
  const joiningWaitlist = event.availability === 'full' && event.waitlistEnabled;
  const yearLabel = user.year ? `Year ${user.year}${user.semester ? ` · Semester ${user.semester}` : ''}` : '—';

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="flex items-center text-sm font-medium text-gray-600 hover:text-indigo-600 transition-colors"
      >
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to Event Details
      </button>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="bg-indigo-600 p-6 sm:p-10 text-white">
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">{joiningWaitlist ? 'Join the Waitlist' : 'Event Registration'}</h1>
          <p className="text-indigo-100 opacity-90">You are registering for:</p>
          <div className="mt-4 p-4 bg-white/10 rounded-xl backdrop-blur-sm">
            <h2 className="text-xl font-bold">{event.title}</h2>
            <p className="text-sm mt-1">
              {formatShortDate(event.startsAt)} · {formatTimeRange(event.startsAt, event.endsAt)} · {venueLabel(event)}
            </p>
          </div>
        </div>

        <div className="p-6 sm:p-10">
          <form onSubmit={handleSubmit} className="space-y-6">
            {(joiningWaitlist || (event.feeAmount ?? 0) > 0 || event.requiredDocuments.length > 0) && (
              <ul className="space-y-2 text-sm rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-indigo-900">
                {joiningWaitlist && (
                  <li className="flex items-start">
                    <Clock className="w-4 h-4 mr-2 mt-0.5 shrink-0" />
                    This event is full. You'll join the waitlist ({event.waitlistCount} ahead of you). If a seat frees up you'll have {event.offerWindowHours} hours to confirm it.
                  </li>
                )}
                {(event.feeAmount ?? 0) > 0 && (
                  <li className="flex items-start">
                    <IndianRupee className="w-4 h-4 mr-2 mt-0.5 shrink-0" />
                    Fee: {formatRupees(event.feeAmount ?? 0)}. {joiningWaitlist ? 'You pay only if you get a seat.' : 'You pay on the next screen; your seat is held for 30 minutes.'}
                    {event.cancellationCutoffHours !== null && ` Cancel up to ${event.cancellationCutoffHours} hours before the start for a full refund.`}
                  </li>
                )}
                {event.requiredDocuments.length > 0 && (
                  <li className="flex items-start">
                    <FileText className="w-4 h-4 mr-2 mt-0.5 shrink-0" />
                    After registering, upload: {event.requiredDocuments.map(d => d.label).join(', ')}. The organizer confirms your seat once it's approved.
                  </li>
                )}
              </ul>
            )}
            <p className="flex items-center text-sm text-gray-600">
              <Lock className="w-4 h-4 mr-2 shrink-0 text-gray-500" />
              These details come from your university profile.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <ReadOnlyField id="fullName" label="Full Name" value={user.name} />
              <ReadOnlyField id="rollNumber" label="University Roll Number" value={user.universityId} />
              <ReadOnlyField id="email" label="Email Address" value={user.email} />
              <ReadOnlyField id="department" label="Department" value={user.department ?? '—'} />
              <ReadOnlyField id="year" label="Year / Semester" value={yearLabel} />
              <div>
                <label className="label" htmlFor="phone">Phone Number</label>
                <input
                  type="tel"
                  id="phone"
                  name="phone"
                  required
                  inputMode="tel"
                  autoComplete="tel"
                  pattern={PHONE_PATTERN}
                  maxLength={15}
                  title={PHONE_ERROR}
                  className="input-field"
                  placeholder="+91 9876543210"
                  value={phone}
                  onChange={(e) => {
                    e.target.setCustomValidity('');
                    setPhone(e.target.value);
                  }}
                  onInvalid={(e) => {
                    if (e.currentTarget.validity.patternMismatch) {
                      e.currentTarget.setCustomValidity(PHONE_ERROR);
                    }
                  }}
                />
              </div>
            </div>

            {isTeam && (
              <fieldset className="pt-4 border-t border-gray-100 space-y-3">
                <legend className="flex items-center text-base font-semibold text-gray-900">
                  <Users className="w-5 h-5 mr-2 text-indigo-600" />
                  Your team ({event.teamMin}–{event.teamMax} members)
                </legend>
                <div className="flex flex-col sm:flex-row gap-3 text-sm">
                  <label className="inline-flex items-center cursor-pointer">
                    <input type="radio" name="teamMode" checked={teamMode === 'create'} onChange={() => setTeamMode('create')} className="mr-2 h-4 w-4 text-indigo-600" />
                    Start a new team
                  </label>
                  <label className="inline-flex items-center cursor-pointer">
                    <input type="radio" name="teamMode" checked={teamMode === 'join'} onChange={() => setTeamMode('join')} className="mr-2 h-4 w-4 text-indigo-600" />
                    Join a team with its invite code
                  </label>
                </div>
                {teamMode === 'create' ? (
                  <div>
                    <label className="label" htmlFor="teamName">Team name</label>
                    <input id="teamName" className="input-field" required minLength={2} maxLength={60} value={teamName} onChange={e => setTeamName(e.target.value)} />
                    <p className="text-xs text-gray-600 mt-1">You'll get an invite code to share with your teammates.</p>
                  </div>
                ) : (
                  <div>
                    <label className="label" htmlFor="teamCode">Invite code</label>
                    <input id="teamCode" className="input-field font-mono uppercase" required minLength={4} maxLength={20} placeholder="TEAM-XXXXXX" value={teamCode} onChange={e => setTeamCode(e.target.value)} />
                  </div>
                )}
              </fieldset>
            )}

            {event.questions.length > 0 && (
              <fieldset className="pt-4 border-t border-gray-100 space-y-4">
                <legend className="text-base font-semibold text-gray-900">A few questions from the organizer</legend>
                {event.questions.map(q => (
                  <div key={q.id}>
                    <label className="label" htmlFor={`q-${q.id}`}>
                      {q.label}
                      {!q.required && <span className="font-normal text-gray-500"> (optional)</span>}
                    </label>
                    {q.type === 'choice' ? (
                      <select id={`q-${q.id}`} className="input-field" required={q.required} value={answers[q.id] ?? ''} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))}>
                        <option value="">Choose…</option>
                        {(q.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input id={`q-${q.id}`} className="input-field" required={q.required} maxLength={1000} value={answers[q.id] ?? ''} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))} />
                    )}
                  </div>
                ))}
              </fieldset>
            )}

            <div className="pt-4 border-t border-gray-100">
              <label htmlFor="agree" className="text-sm text-gray-600 mb-4 flex items-start cursor-pointer">
                <input
                  type="checkbox"
                  id="agree"
                  name="agree"
                  required
                  className="mt-0.5 mr-2 h-4 w-4 shrink-0 rounded border-gray-300 text-indigo-600 focus:ring-2 focus:ring-indigo-500"
                />
                I agree to the event guidelines and requirements.
              </label>
              {submitError && (
                <p role="alert" className="text-sm text-red-600 mb-4 flex items-center">
                  <AlertCircle className="w-4 h-4 mr-2 shrink-0" />
                  {submitError}
                </p>
              )}
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full btn btn-primary py-3 text-base flex justify-center items-center"
              >
                {isSubmitting ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Processing Registration...
                  </>
                ) : joiningWaitlist ? (
                  'Join the Waitlist'
                ) : (event.feeAmount ?? 0) > 0 ? (
                  `Continue to Payment (${formatRupees(event.feeAmount ?? 0)})`
                ) : (
                  'Complete Registration'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Register;
