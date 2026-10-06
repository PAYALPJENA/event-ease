import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BarChart3, Download, FileText, Megaphone, ScanLine, Trash2, UserPlus } from 'lucide-react';
import {
  addParticipant,
  addVolunteer,
  documentFileUrl,
  fetchAdminEvent,
  fetchOverview,
  fetchParticipants,
  fetchVolunteers,
  removeParticipant,
  removeVolunteer,
  reviewDocument,
} from '../../services/adminService';
import type { EventOverview, Participant, Volunteer } from '../../services/adminService';
import { formatRupees } from '../../services/studentService';
import { ApiError } from '../../services/api';
import type { EventType, RegistrationStatus } from '../../types/event';
import { downloadFile } from '../../utils/eventActions';
import { formatDateTime, formatShortDate, organizerName } from '../../utils/format';
import { registrationStatusLabel } from '../../utils/status';

// Quote every field and neutralise spreadsheet formula injection (=, +, -, @).
const csvCell = (value: string | number | null) => {
  let text = value === null ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

const toCsv = (rows: Participant[], questions: EventType['questions']) => {
  const header = [
    'Registration ID', 'Status', 'Name', 'Roll number', 'Email', 'Phone', 'Department', 'Year', 'Team', 'Registered at', 'Added by',
    'Checked in at', 'Check-in method', 'Payment', 'Rating', ...questions.map(q => q.label),
  ];
  const lines = rows.map(p =>
    [
      p.code,
      registrationStatusLabel(p.status).label,
      p.name,
      p.universityId,
      p.email,
      p.phone,
      p.department,
      p.year,
      p.teamName,
      p.createdAt,
      p.source === 'organizer' ? 'Organizer' : 'Student',
      p.checkedInAt,
      p.checkInMethod,
      p.payment ? `${p.payment.status} ${p.payment.amount / 100}` : null,
      p.feedbackRating,
      ...questions.map(q => p.answers?.[q.id] ?? null),
    ]
      .map(csvCell)
      .join(',')
  );
  return [header.map(csvCell).join(','), ...lines].join('\r\n') + '\r\n';
};

const STATUS_FILTERS: { value: 'active' | RegistrationStatus | 'all'; label: string }[] = [
  { value: 'active', label: 'All registered' },
  { value: 'confirmed', label: 'Not checked in' },
  { value: 'pending_payment', label: 'Payment pending' },
  { value: 'pending_documents', label: 'Documents pending' },
  { value: 'waitlisted', label: 'Waitlisted' },
  { value: 'checked_in', label: 'Checked in' },
  { value: 'attended', label: 'Attended' },
  { value: 'no_show', label: 'Absent' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'Everyone, incl. cancelled' },
];

const Stat = ({ label, value }: { label: string; value: string | number }) => (
  <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3">
    <p className="text-2xl font-extrabold text-gray-900">{value}</p>
    <p className="text-xs text-gray-600">{label}</p>
  </div>
);

const AddParticipantForm = ({ eventId, onDone }: { eventId: string; onDone: (message: string) => Promise<void> }) => {
  const [universityId, setUniversityId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const reg = await addParticipant(eventId, universityId.trim(), reason.trim());
      setUniversityId('');
      setReason('');
      await onDone(`${reg.name} was added (${reg.code}) and notified.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the student.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-3">
      <p className="text-sm text-gray-700">
        Add a student by roll number. This skips the registration window and eligibility, but not the seat limit. The reason is logged.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor="add-roll" className="label">Roll number</label>
          <input id="add-roll" className="input-field font-mono" required minLength={3} maxLength={40} value={universityId} onChange={e => setUniversityId(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="add-reason" className="label">Reason</label>
          <input id="add-reason" className="input-field" required minLength={3} maxLength={300} value={reason} onChange={e => setReason(e.target.value)} />
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={busy} className="btn btn-primary">{busy ? 'Adding…' : 'Add student'}</button>
    </form>
  );
};

const RemoveButton = ({ eventId, participant, onDone }: { eventId: string; participant: Participant; onDone: (message: string) => Promise<void> }) => {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm font-medium text-red-600 hover:text-red-700">
        Remove<span className="sr-only"> {participant.name}</span>
      </button>
    );
  }
  return (
    <form
      className="space-y-2 min-w-[14rem]"
      onSubmit={async e => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await removeParticipant(eventId, participant.id, reason.trim());
          await onDone(`${participant.name}'s registration was cancelled and they were notified.`);
        } catch (err) {
          setError(err instanceof ApiError ? err.message : 'Could not remove.');
          setBusy(false);
        }
      }}
    >
      <label htmlFor={`remove-${participant.id}`} className="sr-only">Reason for removing {participant.name}</label>
      <input id={`remove-${participant.id}`} className="input-field text-sm" placeholder="Reason (sent to the student)" required minLength={3} maxLength={300} value={reason} onChange={e => setReason(e.target.value)} />
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn bg-red-600 text-white hover:bg-red-700 text-xs">Remove</button>
        <button type="button" disabled={busy} onClick={() => setOpen(false)} className="btn btn-secondary text-xs">Keep</button>
      </div>
    </form>
  );
};

/** Review one uploaded document: open it, then approve or reject with a reason the student sees. */
const DocumentReview = ({ eventId, doc, label, onDone }: { eventId: string; doc: Participant['documents'][number]; label: string; onDone: (message: string) => Promise<void> }) => {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const decide = async (approve: boolean) => {
    setError(null);
    try {
      const res = await reviewDocument(eventId, doc.id, approve, approve ? undefined : reason.trim());
      await onDone(approve ? (res.registrationStatus === 'confirmed' ? 'Approved — the registration is now confirmed.' : 'Document approved.') : 'Document rejected; the student has been told why.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the review.');
    }
  };
  return (
    <div className="text-xs space-y-1">
      <a href={documentFileUrl(eventId, doc.id)} className="inline-flex items-center text-indigo-600 hover:underline">
        <FileText className="w-3.5 h-3.5 mr-1" />
        {label}: {doc.fileName}
      </a>
      {doc.status === 'submitted' ? (
        rejecting ? (
          <form className="flex gap-1" onSubmit={e => { e.preventDefault(); void decide(false); }}>
            <label htmlFor={`rej-${doc.id}`} className="sr-only">Reason</label>
            <input id={`rej-${doc.id}`} className="input-field text-xs py-1" required minLength={3} placeholder="Reason" value={reason} onChange={e => setReason(e.target.value)} />
            <button type="submit" className="btn bg-red-600 text-white text-xs py-1">Reject</button>
          </form>
        ) : (
          <div className="flex gap-2">
            <button type="button" className="text-green-700 font-medium hover:underline" onClick={() => decide(true)}>Approve</button>
            <button type="button" className="text-red-600 font-medium hover:underline" onClick={() => setRejecting(true)}>Reject</button>
          </div>
        )
      ) : (
        <p className={doc.status === 'approved' ? 'text-green-700' : 'text-red-600'}>{doc.status === 'approved' ? 'Approved' : `Rejected: ${doc.rejectionReason}`}</p>
      )}
      {error && <p role="alert" className="text-red-600">{error}</p>}
    </div>
  );
};

/** Check-in volunteers for this event (blueprint §2.2): they can scan passes here and nothing else. */
const Volunteers = ({ eventId }: { eventId: string }) => {
  const [list, setList] = useState<Volunteer[]>([]);
  const [roll, setRoll] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(() => fetchVolunteers(eventId).then(setList).catch(() => undefined), [eventId]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section aria-labelledby="volunteers-heading" className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-3">
      <h2 id="volunteers-heading" className="font-bold text-gray-900">Check-in volunteers</h2>
      <p className="text-sm text-gray-600">Volunteers can scan passes for this event and see the door list — nothing else.</p>
      <ul className="text-sm divide-y divide-gray-100">
        {list.map(v => (
          <li key={v.id} className="py-2 flex items-center justify-between">
            <span>{v.name} <span className="font-mono text-xs text-gray-600">{v.universityId}</span></span>
            <button type="button" className="text-red-600" onClick={() => removeVolunteer(eventId, v.id).then(load)}>
              <Trash2 className="w-4 h-4" />
              <span className="sr-only">Remove {v.name}</span>
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2 items-end"
        onSubmit={async e => {
          e.preventDefault();
          setMessage(null);
          try {
            const r = await addVolunteer(eventId, roll.trim());
            setRoll('');
            setMessage(`${r.volunteer.name} added and notified.`);
            await load();
          } catch (err) {
            setMessage(err instanceof ApiError ? err.message : 'Could not add the volunteer.');
          }
        }}
      >
        <div className="flex-1">
          <label htmlFor="vol-roll" className="label">Roll number</label>
          <input id="vol-roll" className="input-field font-mono" required minLength={3} value={roll} onChange={e => setRoll(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-secondary">Add volunteer</button>
      </form>
      <p role="status" className="text-sm text-gray-700 [&:empty]:hidden">{message}</p>
    </section>
  );
};

const AdminParticipants = () => {
  const { id = '' } = useParams<{ id: string }>();
  const [event, setEvent] = useState<EventType | null>(null);
  const [participants, setParticipants] = useState<Participant[] | null>(null);
  const [overview, setOverview] = useState<EventOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]['value']>('active');
  const [department, setDepartment] = useState('');
  const [year, setYear] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    try {
      const [e, p, o] = await Promise.all([fetchAdminEvent(id), fetchParticipants(id), fetchOverview(id)]);
      setEvent(e.event);
      setParticipants(p);
      setOverview(o);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load participants.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const done = async (text: string) => {
    setMessage(text);
    await load();
  };

  const departments = useMemo(() => [...new Set((participants ?? []).map(p => p.department).filter(Boolean) as string[])].sort(), [participants]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (participants ?? []).filter(p => {
      if (statusFilter === 'active' && p.status === 'cancelled') return false;
      if (statusFilter !== 'active' && statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (department && p.department !== department) return false;
      if (year && String(p.year) !== year) return false;
      if (q && !(p.name.toLowerCase().includes(q) || p.universityId.toLowerCase().includes(q) || p.code.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))) {
        return false;
      }
      return true;
    });
  }, [participants, query, statusFilter, department, year]);

  if (error) return <p role="alert" className="py-12 text-center text-red-600">{error}</p>;
  if (!event || !participants || !overview) return <p role="status" className="py-12 text-center text-gray-500">Loading participants…</p>;

  const live = event.status === 'published' && event.phase !== 'completed';
  const ended = event.phase === 'completed';

  return (
    <div className="space-y-6">
      <Link to="/admin" className="flex items-center text-sm font-medium text-gray-600 hover:text-indigo-600">
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to Organizer
      </Link>

      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-1">{event.title}</h1>
          <p className="text-gray-600">{formatShortDate(event.startsAt)} · {organizerName(event)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {live && (
            <Link to={`/admin/events/${event.id}/check-in`} className="btn btn-secondary">
              <ScanLine className="w-4 h-4 mr-2" />
              Check-in
            </Link>
          )}
          <Link to={`/admin/events/${event.id}/analytics`} className="btn btn-secondary">
            <BarChart3 className="w-4 h-4 mr-2" />
            Analytics
          </Link>
          {event.status === 'published' && (
            <Link to={`/admin/events/${event.id}/announcements`} className="btn btn-secondary">
              <Megaphone className="w-4 h-4 mr-2" />
              Announce
            </Link>
          )}
          {live && (
            <button type="button" onClick={() => setShowAdd(s => !s)} aria-expanded={showAdd} className="btn btn-secondary">
              <UserPlus className="w-4 h-4 mr-2" />
              Add student
            </button>
          )}
          <button
            type="button"
            onClick={() => downloadFile(`${event.slug}-participants.csv`, toCsv(shown, event.questions), 'text/csv;charset=utf-8')}
            disabled={shown.length === 0}
            className="btn btn-secondary"
          >
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Event overview (blueprint §5) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <Stat label={`registered of ${overview.capacity} seats`} value={overview.registered} />
        <Stat label="checked in" value={overview.checkedIn} />
        <Stat label={ended ? 'absent' : 'not yet checked in'} value={ended ? overview.noShow : overview.confirmed} />
        <Stat label={overview.documentsToReview ? `pending · ${overview.documentsToReview} documents to review` : 'pending payment/documents'} value={overview.pending} />
        <Stat label="waitlisted" value={overview.waitlisted} />
        <Stat label="feedback responses" value={overview.feedbackCount} />
        <Stat label="average rating" value={overview.averageRating === null ? '—' : `${overview.averageRating} / 5`} />
      </div>

      <p role="status" className="sr-only">{message}</p>
      {message && <p className="text-sm text-gray-700 bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-3">{message}</p>}
      {showAdd && <AddParticipantForm eventId={event.id} onDone={done} />}

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="sm:col-span-2">
          <label htmlFor="participant-search" className="label">Search</label>
          <input id="participant-search" className="input-field" placeholder="Name, roll number, registration ID or email" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <div>
          <label htmlFor="status-filter" className="label">Status</label>
          <select id="status-filter" className="input-field" value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}>
            {STATUS_FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="dept-filter" className="label">Dept</label>
            <select id="dept-filter" className="input-field" value={department} onChange={e => setDepartment(e.target.value)}>
              <option value="">All</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="year-filter" className="label">Year</label>
            <select id="year-filter" className="input-field" value={year} onChange={e => setYear(e.target.value)}>
              <option value="">All</option>
              {[1, 2, 3, 4, 5].map(y => <option key={y} value={String(y)}>{y}</option>)}
            </select>
          </div>
        </div>
      </div>

      <p className="text-sm text-gray-600" aria-live="polite">Showing {shown.length} of {participants.length}. The CSV exports what's shown.</p>

      {shown.length === 0 ? (
        <p className="text-gray-600">No registrations match.</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
          <table className="min-w-full text-sm">
            <caption className="sr-only">Participants for {event.title}</caption>
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Name</th>
                <th scope="col" className="px-4 py-3 font-medium">Roll number</th>
                <th scope="col" className="px-4 py-3 font-medium">Dept · Year</th>
                <th scope="col" className="px-4 py-3 font-medium">Registration ID</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium">Registered</th>
                {live && <th scope="col" className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shown.map(p => {
                const status = registrationStatusLabel(p.status);
                return (
                  <tr key={p.id}>
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-900">{p.name}</span>
                      <span className="block text-xs text-gray-600">{p.email}</span>
                      {p.teamName && <span className="block text-xs text-gray-600">Team {p.teamName}</span>}
                      {p.answers && Object.keys(p.answers).length > 0 && (
                        <details className="text-xs text-gray-700 mt-1">
                          <summary className="cursor-pointer text-indigo-700">Answers</summary>
                          <dl className="mt-1 space-y-0.5">
                            {event.questions.filter(q => p.answers?.[q.id]).map(q => (
                              <div key={q.id}><dt className="inline text-gray-600">{q.label}: </dt><dd className="inline">{p.answers![q.id]}</dd></div>
                            ))}
                          </dl>
                        </details>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-700">{p.universityId}</td>
                    <td className="px-4 py-3 text-gray-700">{[p.department, p.year ? `Y${p.year}` : null].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="px-4 py-3 font-mono text-gray-900">{p.code}</td>
                    <td className="px-4 py-3">
                      <span className={`font-medium ${status.className}`}>{status.label}</span>
                      {p.checkedInAt && (
                        <span className="block text-xs text-gray-600">
                          In {formatDateTime(p.checkedInAt)}{p.checkInMethod === 'manual' ? ' (manual)' : ''}
                        </span>
                      )}
                      {p.status === 'cancelled' && p.cancelReason && <span className="block text-xs text-gray-600">{p.cancelReason}</span>}
                      {p.payment && p.payment.status !== 'created' && (
                        <span className="block text-xs text-gray-600">{p.payment.status === 'paid' ? 'Paid' : p.payment.status === 'refunded' ? 'Refunded' : 'Payment failed'} {formatRupees(p.payment.amount)}</span>
                      )}
                      {p.documents.map(d => (
                        <DocumentReview key={d.id} eventId={event.id} doc={d} label={event.requiredDocuments.find(r => r.id === d.requirementId)?.label ?? 'Document'} onDone={done} />
                      ))}
                    </td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {formatDateTime(p.createdAt)}
                      {p.source === 'organizer' && <span className="block text-xs text-gray-600">Added by organizer</span>}
                    </td>
                    {live && (
                      <td className="px-4 py-3 text-right">
                        {['confirmed', 'pending_payment', 'pending_documents', 'waitlisted', 'offer_pending'].includes(p.status) && <RemoveButton eventId={event.id} participant={p} onDone={done} />}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {live && <Volunteers eventId={event.id} />}
    </div>
  );
};

export default AdminParticipants;
