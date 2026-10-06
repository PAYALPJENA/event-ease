import { useCallback, useEffect, useState } from 'react';
import { useParams, useLocation, Link, useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { CheckCircle2, Calendar, MapPin, Download, XCircle, ScanLine, Clock, CreditCard, FileText, Upload, Users, Copy, Award } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useUserEvents } from '../context/UserEventsContext';
import { ApiError } from '../services/api';
import { acceptOffer, cancelRegistration, fetchRegistration, startPayment, uploadDocument } from '../services/registrationService';
import { formatRupees } from '../services/studentService';
import type { RegistrationDetail } from '../types/event';
import { downloadIcs, downloadPass } from '../utils/eventActions';
import { formatDateTime, formatShortDate, formatTimeRange, venueLabel } from '../utils/format';

/**
 * The student's registration (blueprint §4.6, §4.9): the pass once confirmed,
 * and every step before it — payment, documents, the waitlist and seat
 * offers, and the team. The QR code encodes a pass token signed by the
 * server; scanners verify it live, so a cancelled registration's pass stops
 * working.
 */

const Header = ({ tone, icon: Icon, title, text }: { tone: 'green' | 'indigo' | 'amber' | 'red' | 'gray'; icon: typeof CheckCircle2; title: string; text: string }) => {
  const styles = {
    green: ['bg-green-50 border-green-100', 'bg-green-100 text-green-600', 'text-green-800', 'text-green-700'],
    indigo: ['bg-indigo-50 border-indigo-100', 'bg-indigo-100 text-indigo-600', 'text-indigo-900', 'text-indigo-800'],
    amber: ['bg-amber-50 border-amber-100', 'bg-amber-100 text-amber-700', 'text-amber-900', 'text-amber-800'],
    red: ['bg-red-50 border-red-100', 'bg-red-100 text-red-600', 'text-red-800', 'text-red-700'],
    gray: ['bg-gray-50 border-gray-100', 'bg-gray-100 text-gray-600', 'text-gray-900', 'text-gray-700'],
  }[tone];
  return (
    <div className={`p-8 text-center border-b ${styles[0]}`}>
      <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 ${styles[1]}`}>
        <Icon className="w-10 h-10" />
      </div>
      <h1 className={`text-2xl sm:text-3xl font-extrabold mb-2 ${styles[2]}`}>{title}</h1>
      <p className={styles[3]}>{text}</p>
    </div>
  );
};

const DocumentUploads = ({ detail, onChange }: { detail: RegistrationDetail; onChange: () => Promise<void> }) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <section aria-labelledby="docs-heading" className="mt-6 rounded-2xl border border-gray-200 p-5 space-y-4">
      <h2 id="docs-heading" className="flex items-center font-semibold text-gray-900">
        <FileText className="w-5 h-5 mr-2 text-indigo-600" />
        Documents
      </h2>
      <p className="text-sm text-gray-600">PDF, PNG or JPEG, up to 2 MB each. The organizer reviews them and confirms your seat.</p>
      <ul className="space-y-3">
        {detail.event.requiredDocuments.map(req => {
          const doc = detail.documents.find(d => d.requirementId === req.id);
          const inputId = `doc-${req.id}`;
          return (
            <li key={req.id} className="rounded-lg bg-gray-50 p-3 text-sm">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <p className="font-medium text-gray-900">{req.label}</p>
                  <p className={doc?.status === 'approved' ? 'text-green-700' : doc?.status === 'rejected' ? 'text-red-600' : 'text-gray-600'}>
                    {!doc ? 'Not uploaded yet' : doc.status === 'approved' ? `Approved (${doc.fileName})` : doc.status === 'rejected' ? `Not accepted: ${doc.rejectionReason}` : `Uploaded ${doc.fileName} — waiting for review`}
                  </p>
                </div>
                {doc?.status !== 'approved' && (
                  <label htmlFor={inputId} className="btn btn-secondary cursor-pointer">
                    <Upload className="w-4 h-4 mr-2" />
                    {busy === req.id ? 'Uploading…' : doc ? 'Upload again' : 'Upload'}
                    <input
                      id={inputId}
                      type="file"
                      accept="application/pdf,image/png,image/jpeg"
                      className="sr-only"
                      disabled={busy !== null}
                      onChange={async e => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        if (file.size > 2 * 1024 * 1024) {
                          setError('That file is larger than 2 MB.');
                          return;
                        }
                        setBusy(req.id);
                        setError(null);
                        try {
                          await uploadDocument(detail.id, req.id, file);
                          await onChange();
                        } catch (err) {
                          setError(err instanceof ApiError ? err.message : 'Upload failed. Please try again.');
                        } finally {
                          setBusy(null);
                        }
                      }}
                    />
                  </label>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </section>
  );
};

const RegistrationSuccess = () => {
  const { id: eventId } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { registrations, loading: registrationsLoading, refresh } = useUserEvents();

  // Prefer the id handed over by the registration form; otherwise use the
  // student's latest registration for this event (e.g. after a page reload
  // or a reminder link).
  const stateId = (location.state as { registrationId?: string } | null)?.registrationId;
  const registrationId = stateId ?? registrations.find(r => r.eventId === eventId)?.id;

  const [detail, setDetail] = useState<RegistrationDetail | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const load = useCallback(async () => {
    if (!registrationId) return;
    try {
      const reg = await fetchRegistration(registrationId);
      setDetail(reg);
      setQrDataUrl(reg.passToken ? await QRCode.toDataURL(reg.passToken, { errorCorrectionLevel: 'M', margin: 1, width: 240 }) : null);
    } catch {
      setError('Unable to load your registration. Please try again.');
    }
  }, [registrationId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return <p role="alert" className="py-24 text-center text-red-600">{error}</p>;
  }

  if (!registrationId) {
    if (registrationsLoading) return <p role="status" className="py-24 text-center text-gray-500">Loading…</p>;
    return (
      <div className="max-w-xl mx-auto py-24 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">No registration found</h1>
        <p className="text-gray-600 mb-6">You haven't registered for this event.</p>
        <Link to={`/event/${eventId}`} className="btn btn-primary">View Event</Link>
      </div>
    );
  }

  if (!detail || !user) return <p role="status" className="py-24 text-center text-gray-500">Loading your registration…</p>;

  const { event } = detail;
  const status = detail.status;
  const checkedIn = detail.checkedInAt !== null;
  const ended = event.phase === 'completed';

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await Promise.all([load(), refresh()]);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const pay = () =>
    act(async () => {
      const order = await startPayment(detail.id);
      navigate(`/pay/${order.orderId}`);
    });

  const header = (() => {
    switch (status) {
      case 'cancelled':
        return <Header tone="red" icon={XCircle} title="Registration cancelled" text={detail.cancelReason ?? 'This registration is no longer active.'} />;
      case 'waitlist_expired':
        return <Header tone="gray" icon={Clock} title="Waitlist place expired" text="The seat offer wasn't accepted in time. You can register again if seats remain." />;
      case 'waitlisted':
        return <Header tone="amber" icon={Clock} title={`You're #${detail.waitlistPosition} on the waitlist`} text="We'll notify you if a seat frees up. You'll then have a limited time to confirm it." />;
      case 'offer_pending':
        return <Header tone="indigo" icon={CheckCircle2} title="A seat is yours — confirm it" text={`Confirm by ${formatDateTime(detail.offerExpiresAt!)}, or it goes to the next person.`} />;
      case 'pending_payment':
        return <Header tone="amber" icon={CreditCard} title="Complete your payment" text={`Your seat is held until ${detail.paymentDueAt ? formatDateTime(detail.paymentDueAt) : 'the payment window closes'}.`} />;
      case 'pending_documents':
        return <Header tone="amber" icon={FileText} title="Almost there: upload your documents" text="Your seat is held while the organizer reviews them." />;
      case 'no_show':
        return <Header tone="gray" icon={Clock} title="This event has ended" text="Your pass wasn't scanned at the venue, so you're marked absent." />;
      default:
        if (checkedIn) return <Header tone="indigo" icon={ScanLine} title={ended ? 'You attended' : "You're checked in"} text={`Checked in ${formatDateTime(detail.checkedInAt!)}.`} />;
        return <Header tone="green" icon={CheckCircle2} title="You're registered!" text="Your seat is confirmed." />;
    }
  })();

  const canCancel = ['pending_payment', 'pending_documents', 'waitlisted', 'confirmed'].includes(status) && event.phase === 'upcoming';

  return (
    <div className="max-w-2xl mx-auto py-12">
      <div className="bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-100">
        {header}

        <div className="p-6 sm:p-8">
          {/* Event Pass */}
          <div className="bg-gradient-to-br from-indigo-50 to-white rounded-2xl p-6 border border-indigo-100 relative overflow-hidden">
            <div className="absolute -right-12 -top-12 w-32 h-32 bg-indigo-100 rounded-full opacity-50"></div>
            <div className="relative z-10 flex flex-col md:flex-row justify-between items-center gap-6">
              <div className="flex-1 space-y-4 text-center md:text-left">
                <div>
                  <p className="text-xs text-indigo-600 font-bold uppercase tracking-wider mb-1">{detail.passToken ? 'Event Pass' : 'Registration'}</p>
                  <h2 className="text-xl font-bold text-gray-900">{event.title}</h2>
                  <p className="text-sm text-gray-700 mt-1">{user.name} · {user.universityId}</p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-center md:justify-start text-gray-600 text-sm">
                    <Calendar className="w-4 h-4 mr-2 text-indigo-500 shrink-0" />
                    <span>{formatShortDate(event.startsAt)} · {formatTimeRange(event.startsAt, event.endsAt)}</span>
                  </div>
                  <div className="flex items-center justify-center md:justify-start text-gray-600 text-sm">
                    <MapPin className="w-4 h-4 mr-2 text-indigo-500 shrink-0" />
                    <span>{venueLabel(event)}</span>
                  </div>
                </div>
                <div className="pt-2">
                  <p className="text-xs text-gray-500">Registration ID</p>
                  <p className="font-mono font-bold text-gray-900">{detail.code}</p>
                </div>
              </div>
              {detail.passToken && (
                <div className="bg-white p-3 rounded-xl shadow-sm border border-gray-200 flex flex-col items-center justify-center shrink-0">
                  {qrDataUrl ? (
                    <img src={qrDataUrl} alt={`QR code for pass ${detail.code}`} width={160} height={160} className="w-40 h-40" />
                  ) : (
                    <div className="w-40 h-40 bg-gray-100 animate-pulse rounded" aria-hidden="true" />
                  )}
                  <span className="text-[10px] text-gray-500 mt-1">{checkedIn ? 'Already used at the door' : 'Show this at the venue'}</span>
                </div>
              )}
            </div>
          </div>

          {actionError && <p role="alert" className="mt-4 text-sm text-red-600">{actionError}</p>}

          {status === 'offer_pending' && (
            <div className="mt-6 flex flex-col sm:flex-row gap-3">
              <button type="button" disabled={busy} onClick={() => act(async () => {
                const res = await acceptOffer(detail.id);
                if (res.payment) navigate(`/pay/${res.payment.orderId}`);
              })} className="btn btn-primary flex-1 py-3">
                Confirm my seat{(event.feeAmount ?? 0) > 0 ? ` (${formatRupees(event.feeAmount ?? 0)})` : ''}
              </button>
              <button type="button" disabled={busy} onClick={() => act(() => cancelRegistration(detail.id))} className="btn btn-secondary flex-1 py-3">
                Decline
              </button>
            </div>
          )}

          {status === 'pending_payment' && (
            <div className="mt-6">
              {detail.payment?.status === 'failed' && <p className="text-sm text-red-600 mb-2">Your last payment attempt failed.</p>}
              <button type="button" disabled={busy} onClick={pay} className="btn btn-primary w-full py-3">
                <CreditCard className="w-5 h-5 mr-2" />
                Pay {formatRupees(event.feeAmount ?? 0)}
              </button>
            </div>
          )}

          {status === 'pending_documents' && <DocumentUploads detail={detail} onChange={() => Promise.all([load(), refresh()]).then(() => undefined)} />}

          {detail.team && (
            <section aria-labelledby="team-heading" className="mt-6 rounded-2xl border border-gray-200 p-5 space-y-3">
              <h2 id="team-heading" className="flex items-center font-semibold text-gray-900">
                <Users className="w-5 h-5 mr-2 text-indigo-600" />
                Team {detail.team.name}
                <span className="ml-2 text-xs font-medium rounded-full bg-gray-100 px-2 py-0.5 text-gray-700">
                  {detail.team.status === 'forming' ? `Needs ${Math.max(0, (event.teamMin ?? 1) - detail.team.members.length)} more` : detail.team.status === 'complete' ? 'Complete' : detail.team.status === 'locked' ? 'Locked' : 'Disbanded'}
                </span>
              </h2>
              <ul className="text-sm text-gray-800">
                {detail.team.members.map(m => <li key={m.name}>{m.name}{m.isLeader && <span className="text-gray-500"> · leader</span>}</li>)}
              </ul>
              {detail.team.status !== 'locked' && detail.team.status !== 'disbanded' && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-gray-600">Invite code:</span>
                  <code className="font-mono font-bold text-gray-900">{detail.team.inviteCode}</code>
                  <button
                    type="button"
                    className="inline-flex items-center text-indigo-600 hover:underline"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(detail.team!.inviteCode);
                        setCopied(true);
                      } catch {
                        setCopied(false);
                      }
                    }}
                  >
                    <Copy className="w-4 h-4 mr-1" />
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                  <span className="text-gray-600 w-full">Teammates register for this event and choose “Join a team with its invite code”. Up to {event.teamMax} members; teams below {event.teamMin} when registration closes are not registered.</span>
                </div>
              )}
            </section>
          )}

          {detail.certificates.length > 0 && (
            <section className="mt-6 rounded-2xl border border-gray-200 p-5">
              <h2 className="flex items-center font-semibold text-gray-900 mb-2">
                <Award className="w-5 h-5 mr-2 text-indigo-600" />
                Certificates
              </h2>
              <ul className="text-sm space-y-1">
                {detail.certificates.map(c => (
                  <li key={c.id}>
                    <Link to="/certificates" className="text-indigo-600 hover:underline">{c.title}</Link>
                    {c.revokedAt && <span className="text-red-600"> (revoked)</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {detail.payment && detail.payment.status !== 'created' && detail.payment.status !== 'failed' && (
            <p className="mt-4 text-sm text-gray-600">
              {detail.payment.status === 'paid'
                ? `Paid ${formatRupees(detail.payment.amount)}${detail.payment.paidAt ? ` on ${formatDateTime(detail.payment.paidAt)}` : ''}.`
                : `${formatRupees(detail.payment.amount)} refunded${detail.payment.refundedAt ? ` on ${formatDateTime(detail.payment.refundedAt)}` : ''}.`}
            </p>
          )}

          {detail.passToken && !checkedIn && event.requirements.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">What's next</h3>
              <ul className="text-sm text-gray-700 space-y-1 list-disc pl-5">
                <li>Add the event to your calendar so you don't miss it.</li>
                <li>Bring: {event.requirements.join(', ')}.</li>
                <li>Show this pass at the venue.</li>
              </ul>
            </div>
          )}

          {/* Actions */}
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Link to="/my-events" className="btn btn-primary py-3 text-base">View My Events</Link>
            {detail.passToken && (
              <>
                <button
                  type="button"
                  onClick={() => downloadPass({ event, registrationCode: detail.code, passToken: detail.passToken!, studentName: user.name, universityId: user.universityId })}
                  className="btn btn-secondary py-3 text-base flex justify-center items-center"
                >
                  <Download className="w-5 h-5 mr-2" />
                  Download Pass
                </button>
                <button type="button" onClick={() => downloadIcs(event, `${window.location.origin}/event/${event.id}`)} className="btn btn-secondary py-3 text-base flex justify-center items-center">
                  <Calendar className="w-5 h-5 mr-2" />
                  Add to Calendar
                </button>
              </>
            )}
          </div>

          {canCancel && status !== 'offer_pending' && (
            <div className="mt-6 text-center">
              {confirmingCancel ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-left">
                  <p className="text-red-800 mb-2">
                    {status === 'waitlisted' ? 'Leave the waitlist? You lose your place in line.' : 'Cancel your registration? Your seat goes to the next person.'}
                    {detail.payment?.status === 'paid' && ' Your fee will be refunded.'}
                  </p>
                  <div className="flex gap-2">
                    <button type="button" disabled={busy} onClick={() => act(() => cancelRegistration(detail.id))} className="btn bg-red-600 text-white hover:bg-red-700 flex-1">
                      {busy ? 'Cancelling…' : 'Yes, cancel'}
                    </button>
                    <button type="button" disabled={busy} onClick={() => setConfirmingCancel(false)} className="btn btn-secondary flex-1">Keep it</button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmingCancel(true)} className="text-sm font-medium text-red-600 hover:text-red-700">
                  {status === 'waitlisted' ? 'Leave the waitlist' : 'Cancel registration'}
                </button>
              )}
              {event.cancellationCutoffHours !== null && status !== 'waitlisted' && (
                <p className="text-xs text-gray-500 mt-1">Cancellations close {event.cancellationCutoffHours} hours before the start.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RegistrationSuccess;
