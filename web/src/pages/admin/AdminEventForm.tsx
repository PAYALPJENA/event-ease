import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, AlertCircle, MessageSquareWarning, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useEvents } from '../../context/EventsContext';
import { createEvent, fetchAdminEvent, fetchAdminOptions, submitEvent, updateEvent } from '../../services/adminService';
import type { AdminEvent, AdminOptions, EventInput, Review } from '../../services/adminService';
import type { CertificateRule, EventKind, EventQuestion, RegistrationMode } from '../../types/event';
import { EVENT_KINDS, EVENT_KIND_LABEL } from '../../utils/taxonomy';
import { ApiError } from '../../services/api';
import { formatDateTime, isoToIstInput, istInputToIso } from '../../utils/format';

const DEPARTMENTS = ['CSE', 'ECE', 'ME', 'CE', 'BBA'];
const YEARS = [1, 2, 3, 4];

interface FormState {
  title: string;
  description: string;
  image: string;
  /** '' = organizer not specified (admins only) */
  organizationId: string;
  categoryId: string;
  eventType: EventKind;
  /** Comma-separated */
  tags: string;
  timeTbd: boolean;
  registrationMode: RegistrationMode;
  venueId: string;
  mode: EventInput['mode'];
  onlineUrl: string;
  startsAt: string;
  endsAt: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  capacity: string;
  eligibilityText: string;
  departments: string[];
  years: number[];
  requirements: string;
  contactPerson: string;
  contactEmail: string;
  isFeatured: boolean;
  participation: 'individual' | 'team';
  teamMin: string;
  teamMax: string;
  waitlistEnabled: boolean;
  offerWindowHours: string;
  questions: (EventQuestion & { optionsText: string })[];
  documents: { id: string; label: string }[];
  cancellationCutoffHours: string;
  certificateRule: CertificateRule;
  /** Rupees, as typed */
  fee: string;
}

/** Stable-enough ids for questions and documents within one event. */
const newKey = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

const EMPTY: FormState = {
  title: '', description: '', image: '', organizationId: '', categoryId: '', eventType: 'workshop', tags: '', timeTbd: false, registrationMode: 'eventease',
  venueId: '', mode: 'in_person', onlineUrl: '',
  startsAt: '', endsAt: '', registrationOpensAt: '', registrationClosesAt: '', capacity: '50',
  eligibilityText: 'All CUTM students', departments: [], years: [], requirements: '', contactPerson: '', contactEmail: '', isFeatured: false,
  participation: 'individual', teamMin: '2', teamMax: '4', waitlistEnabled: true, offerWindowHours: '12', questions: [], documents: [],
  cancellationCutoffHours: '', certificateRule: 'none', fee: '0',
};

const toInput = (f: FormState): EventInput => ({
  title: f.title.trim(),
  summary: null,
  description: f.description.trim(),
  image: f.image.trim() || null,
  organizationId: f.organizationId || null,
  categoryId: f.categoryId,
  eventType: f.eventType,
  tags: f.tags.split(',').map(t => t.trim()).filter(Boolean),
  timeTbd: f.timeTbd,
  registrationMode: f.registrationMode,
  venueId: f.mode === 'online' ? null : f.venueId || null,
  mode: f.mode,
  onlineUrl: f.mode === 'in_person' ? null : f.onlineUrl.trim() || null,
  startsAt: istInputToIso(f.startsAt),
  endsAt: istInputToIso(f.endsAt),
  registrationOpensAt: f.registrationMode === 'eventease' && f.registrationOpensAt ? istInputToIso(f.registrationOpensAt) : null,
  registrationClosesAt: f.registrationMode === 'eventease' && f.registrationClosesAt ? istInputToIso(f.registrationClosesAt) : null,
  // Blank = no seat limit.
  capacity: f.capacity.trim() === '' ? null : Number(f.capacity),
  eligibilityText: f.eligibilityText.trim() || null,
  eligibleDepartments: f.departments.length ? f.departments : null,
  eligibleYears: f.years.length ? f.years : null,
  requirements: f.requirements.split('\n').map(s => s.trim()).filter(Boolean),
  contactPerson: f.contactPerson.trim() || null,
  contactEmail: f.contactEmail.trim() || null,
  isFeatured: f.isFeatured,
  participation: f.participation,
  teamMin: f.participation === 'team' ? Number(f.teamMin) : null,
  teamMax: f.participation === 'team' ? Number(f.teamMax) : null,
  waitlistEnabled: f.waitlistEnabled,
  offerWindowHours: Number(f.offerWindowHours) || 12,
  questions: f.questions.map(({ optionsText, ...q }) => ({
    ...q,
    label: q.label.trim(),
    options: q.type === 'choice' ? optionsText.split('\n').map(o => o.trim()).filter(Boolean) : undefined,
  })),
  requiredDocuments: f.documents.map(d => ({ id: d.id, label: d.label.trim() })),
  cancellationCutoffHours: f.cancellationCutoffHours === '' ? null : Number(f.cancellationCutoffHours),
  certificateRule: f.certificateRule,
  // Blank = not specified.
  feeAmount: f.fee.trim() === '' ? null : Math.round((Number(f.fee) || 0) * 100),
});

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <fieldset className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
    <legend className="text-lg font-bold text-gray-900 px-1">{title}</legend>
    {children}
  </fieldset>
);

const AdminEventForm = () => {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const isAdmin = hasRole('admin');
  const { refetch: refetchPublicEvents } = useEvents();
  const [options, setOptions] = useState<AdminOptions | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [original, setOriginal] = useState<AdminEvent | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [changeReason, setChangeReason] = useState('');
  const [clash, setClash] = useState(false);
  const [overrideClash, setOverrideClash] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchAdminOptions(), id ? fetchAdminEvent(id) : Promise.resolve(null)])
      .then(([opts, loaded]) => {
        if (cancelled) return;
        setOptions(opts);
        if (loaded) {
          const { event } = loaded;
          setOriginal(event);
          setReviews(loaded.reviews);
          setForm({
            title: event.title,
            description: event.description,
            image: event.image ?? '',
            organizationId: event.organization?.id ?? '',
            categoryId: event.category.id,
            eventType: event.eventType,
            tags: event.tags.join(', '),
            timeTbd: event.timeTbd,
            registrationMode: event.registrationMode,
            venueId: event.venue?.id ?? '',
            mode: event.mode,
            onlineUrl: event.onlineUrl ?? '',
            startsAt: isoToIstInput(event.startsAt),
            endsAt: isoToIstInput(event.endsAt),
            registrationOpensAt: event.registrationOpensAt ? isoToIstInput(event.registrationOpensAt) : '',
            registrationClosesAt: event.registrationClosesAt ? isoToIstInput(event.registrationClosesAt) : '',
            capacity: event.capacity === null ? '' : String(event.capacity),
            eligibilityText: event.eligibilityText ?? '',
            departments: event.eligibleDepartments ?? [],
            years: event.eligibleYears ?? [],
            requirements: event.requirements.join('\n'),
            contactPerson: event.contactPerson ?? '',
            contactEmail: event.contactEmail ?? '',
            isFeatured: event.isFeatured,
            participation: event.participation,
            teamMin: String(event.teamMin ?? 2),
            teamMax: String(event.teamMax ?? 4),
            waitlistEnabled: event.waitlistEnabled || event.participation === 'team',
            offerWindowHours: String(event.offerWindowHours),
            questions: event.questions.map(q => ({ ...q, optionsText: (q.options ?? []).join('\n') })),
            documents: event.requiredDocuments,
            cancellationCutoffHours: event.cancellationCutoffHours === null ? '' : String(event.cancellationCutoffHours),
            certificateRule: event.certificateRule,
            fee: event.feeAmount === null ? '' : String(event.feeAmount / 100),
          });
        } else {
          setForm(f => ({
            ...f,
            organizationId: opts.organizations[0]?.id ?? '',
            categoryId: opts.categories[0]?.id ?? '',
            venueId: opts.venues[0]?.id ?? '',
          }));
        }
      })
      .catch(err => {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.message : 'Unable to load the form.');
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm(f => ({ ...f, [key]: value }));
  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter(v => v !== value) : [...list, value]);

  // Blueprint §5: changing a published event's time or venue needs a reason, which registrants see.
  const isPublished = original?.status === 'published';
  const timeOrVenueChanged = (() => {
    if (!original || !isPublished || !form.startsAt || !form.endsAt) return false;
    const input = toInput(form);
    return (
      input.startsAt !== original.startsAt ||
      input.endsAt !== original.endsAt ||
      input.mode !== original.mode ||
      (input.mode !== 'online' && input.venueId !== (original.venue?.id ?? null))
    );
  })();
  const canSubmitForApproval = !isAdmin && (!original || original.status === 'draft' || original.status === 'changes_requested');
  const lastRequest = [...reviews].reverse().find(r => r.action === 'changes_requested');

  const save = async (andSubmit: boolean) => {
    setSaving(true);
    setSubmitError(null);
    try {
      const input = toInput(form);
      let eventId = id;
      if (id) {
        await updateEvent(id, {
          ...input,
          changeReason: timeOrVenueChanged ? changeReason.trim() : undefined,
          overrideClash: isAdmin && overrideClash ? true : undefined,
        });
      } else {
        eventId = (await createEvent(input)).id;
      }
      if (andSubmit && eventId) await submitEvent(eventId);
      await refetchPublicEvents();
      navigate('/admin');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'venue_clash') setClash(true);
      setSubmitError(err instanceof ApiError ? err.message : 'Could not save the event.');
      setSaving(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    void save(submitter?.getAttribute('value') === 'submit');
  };

  if (loadError) return <p role="alert" className="py-12 text-center text-red-600">{loadError}</p>;
  if (!options) return <p role="status" className="py-12 text-center text-gray-500">Loading…</p>;
  if (options.organizations.length === 0) {
    return <p className="py-12 text-center text-gray-600">You aren't an organizer for any organization yet.</p>;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      <Link to="/admin" className="flex items-center text-sm font-medium text-gray-600 hover:text-indigo-600">
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to Organizer
      </Link>
      <div>
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">{isEdit ? 'Edit event' : 'New event'}</h1>
        <p className="text-gray-600">
          {isPublished
            ? 'This event is published. Changing its time or venue needs a reason, and everyone registered is notified.'
            : isAdmin
              ? 'Events are saved as drafts. Publish from the Organizer page when ready.'
              : 'Events are saved as drafts. An administrator reviews each event before it is published.'}
        </p>
      </div>

      {original?.status === 'changes_requested' && lastRequest && (
        <div className="flex items-start text-sm text-orange-900 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
          <MessageSquareWarning className="w-5 h-5 mr-3 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Changes requested by {lastRequest.actorName}</p>
            <p className="mt-1">{lastRequest.comments}</p>
            <p className="text-xs mt-1 text-orange-800">{formatDateTime(lastRequest.createdAt)} · Make the changes, then resubmit.</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Section title="Basics">
          <div>
            <label className="label" htmlFor="title">Title</label>
            <input id="title" className="input-field" required minLength={3} maxLength={120} value={form.title} onChange={e => set('title', e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="description">Description</label>
            <textarea id="description" className="input-field" rows={4} required minLength={10} maxLength={5000} value={form.description} onChange={e => set('description', e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="organizationId">Organized by</label>
              <select id="organizationId" className="input-field" value={form.organizationId} onChange={e => set('organizationId', e.target.value)}>
                {isAdmin && <option value="">Not specified</option>}
                {options.organizations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="categoryId">Category</label>
              <select id="categoryId" className="input-field" value={form.categoryId} onChange={e => set('categoryId', e.target.value)}>
                {options.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="eventType">Event type</label>
              <select id="eventType" className="input-field" value={form.eventType} onChange={e => set('eventType', e.target.value as EventKind)}>
                {EVENT_KINDS.map(k => <option key={k} value={k}>{EVENT_KIND_LABEL[k]}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="tags">Tags (comma separated, optional)</label>
              <input id="tags" className="input-field" maxLength={300} value={form.tags} onChange={e => set('tags', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="image">Banner image URL (optional)</label>
            <input id="image" type="url" className="input-field" value={form.image} onChange={e => set('image', e.target.value)} />
          </div>
          <label className="inline-flex items-center text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={form.isFeatured} onChange={e => set('isFeatured', e.target.checked)} className="mr-2 h-4 w-4 rounded border-gray-300 text-indigo-600" />
            Feature on the Home page
          </label>
        </Section>

        <Section title="Schedule (IST)">
          <label className="inline-flex items-center text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={form.timeTbd} onChange={e => set('timeTbd', e.target.checked)} className="mr-2 h-4 w-4 rounded border-gray-300 text-indigo-600" />
            The time isn't announced yet (students see “Time to be announced”)
          </label>
          <div>
            <label className="label" htmlFor="registrationMode">Registration</label>
            <select id="registrationMode" className="input-field sm:w-96" value={form.registrationMode} onChange={e => set('registrationMode', e.target.value as RegistrationMode)}>
              <option value="eventease">Students register on EventEase</option>
              <option value="not_required">No registration needed</option>
              <option value="unspecified">Not specified yet</option>
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="startsAt">Starts</label>
              <input id="startsAt" type="datetime-local" className="input-field" required value={form.startsAt} onChange={e => set('startsAt', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="endsAt">Ends</label>
              <input id="endsAt" type="datetime-local" className="input-field" required value={form.endsAt} onChange={e => set('endsAt', e.target.value)} />
            </div>
            {form.registrationMode === 'eventease' && (
              <>
                <div>
                  <label className="label" htmlFor="registrationOpensAt">Registration opens</label>
                  <input id="registrationOpensAt" type="datetime-local" className="input-field" required value={form.registrationOpensAt} onChange={e => set('registrationOpensAt', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="registrationClosesAt">Registration closes</label>
                  <input id="registrationClosesAt" type="datetime-local" className="input-field" required value={form.registrationClosesAt} onChange={e => set('registrationClosesAt', e.target.value)} />
                </div>
              </>
            )}
          </div>
        </Section>

        <Section title="Venue">
          <div>
            <label className="label" htmlFor="mode">Format</label>
            <select id="mode" className="input-field" value={form.mode} onChange={e => set('mode', e.target.value as EventInput['mode'])}>
              <option value="in_person">In person</option>
              <option value="online">Online</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </div>
          {form.mode !== 'online' && (
            <div>
              <label className="label" htmlFor="venueId">Venue</label>
              <select id="venueId" className="input-field" value={form.venueId} onChange={e => set('venueId', e.target.value)}>
                {options.venues.map(v => (
                  <option key={v.id} value={v.id}>{v.name}{v.capacity ? ` (holds ${v.capacity})` : ''}</option>
                ))}
              </select>
            </div>
          )}
          {form.mode !== 'in_person' && (
            <div>
              <label className="label" htmlFor="onlineUrl">Meeting link</label>
              <input id="onlineUrl" type="url" className="input-field" required value={form.onlineUrl} onChange={e => set('onlineUrl', e.target.value)} />
            </div>
          )}
        </Section>

        <Section title="Who can register">
          <div>
            <label className="label" htmlFor="capacity">Seats (leave blank for no limit)</label>
            <input id="capacity" type="number" min={1} max={100000} className="input-field sm:w-40" value={form.capacity} onChange={e => set('capacity', e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="eligibilityText">Eligibility (shown to students; leave blank if not specified)</label>
            <input id="eligibilityText" className="input-field" minLength={3} maxLength={200} value={form.eligibilityText} onChange={e => set('eligibilityText', e.target.value)} />
          </div>
          <div>
            <p className="label" id="departments-label">Departments (none selected = all)</p>
            <div className="flex flex-wrap gap-3" role="group" aria-labelledby="departments-label">
              {DEPARTMENTS.map(d => (
                <label key={d} className="inline-flex items-center text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={form.departments.includes(d)} onChange={() => set('departments', toggle(form.departments, d))} className="mr-1.5 h-4 w-4 rounded border-gray-300 text-indigo-600" />
                  {d}
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className="label" id="years-label">Years (none selected = all)</p>
            <div className="flex flex-wrap gap-3" role="group" aria-labelledby="years-label">
              {YEARS.map(y => (
                <label key={y} className="inline-flex items-center text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={form.years.includes(y)} onChange={() => set('years', toggle(form.years, y))} className="mr-1.5 h-4 w-4 rounded border-gray-300 text-indigo-600" />
                  Year {y}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="label" htmlFor="requirements">What to bring (one per line)</label>
            <textarea id="requirements" className="input-field" rows={3} value={form.requirements} onChange={e => set('requirements', e.target.value)} />
          </div>
        </Section>

        <Section title="Participation & registration">
          {original && original.seatsTaken > 0 && (
            <p className="text-sm text-gray-600">Students have registered, so the fee, team setting and required documents are locked.</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="label" htmlFor="participation">Participation</label>
              <select id="participation" className="input-field" value={form.participation} onChange={e => set('participation', e.target.value as FormState['participation'])}>
                <option value="individual">Individual</option>
                <option value="team">Teams</option>
              </select>
            </div>
            {form.participation === 'team' && (
              <>
                <div>
                  <label className="label" htmlFor="teamMin">Minimum team size</label>
                  <input id="teamMin" type="number" min={1} max={50} className="input-field" required value={form.teamMin} onChange={e => set('teamMin', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="teamMax">Maximum team size</label>
                  <input id="teamMax" type="number" min={1} max={50} className="input-field" required value={form.teamMax} onChange={e => set('teamMax', e.target.value)} />
                </div>
              </>
            )}
          </div>
          {form.participation === 'individual' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
              <label className="inline-flex items-center text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={form.waitlistEnabled} onChange={e => set('waitlistEnabled', e.target.checked)} className="mr-2 h-4 w-4 rounded border-gray-300 text-indigo-600" />
                Waitlist when full (freed seats are offered in order)
              </label>
              {form.waitlistEnabled && (
                <div>
                  <label className="label" htmlFor="offerWindowHours">Hours to accept a seat offer</label>
                  <input id="offerWindowHours" type="number" min={1} max={72} className="input-field sm:w-40" value={form.offerWindowHours} onChange={e => set('offerWindowHours', e.target.value)} />
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="fee">Fee in ₹ (0 = free, blank = not specified)</label>
              <input id="fee" type="number" min={0} max={10000} step="1" className="input-field" value={form.fee} onChange={e => set('fee', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="cutoff">Cancellations close (hours before the start; blank = any time)</label>
              <input id="cutoff" type="number" min={0} max={720} className="input-field" value={form.cancellationCutoffHours} onChange={e => set('cancellationCutoffHours', e.target.value)} />
            </div>
          </div>
        </Section>

        <Section title="Registration questions">
          <p className="text-sm text-gray-600">Ask for anything the profile doesn't cover (e.g. T-shirt size). Answers appear in Participants and the CSV.</p>
          {form.questions.map((q, i) => (
            <div key={q.id} className="rounded-lg border border-gray-200 p-3 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-end">
                <div>
                  <label className="label" htmlFor={`q-label-${q.id}`}>Question {i + 1}</label>
                  <input id={`q-label-${q.id}`} className="input-field" required minLength={2} maxLength={200} value={q.label} onChange={e => set('questions', form.questions.map(x => (x.id === q.id ? { ...x, label: e.target.value } : x)))} />
                </div>
                <div>
                  <label className="label" htmlFor={`q-type-${q.id}`}>Answer</label>
                  <select id={`q-type-${q.id}`} className="input-field" value={q.type} onChange={e => set('questions', form.questions.map(x => (x.id === q.id ? { ...x, type: e.target.value as 'text' | 'choice' } : x)))}>
                    <option value="text">Text</option>
                    <option value="choice">Choice</option>
                  </select>
                </div>
                <button type="button" className="btn btn-secondary text-red-600" onClick={() => set('questions', form.questions.filter(x => x.id !== q.id))}>
                  <Trash2 className="w-4 h-4" />
                  <span className="sr-only">Remove question {i + 1}</span>
                </button>
              </div>
              {q.type === 'choice' && (
                <div>
                  <label className="label" htmlFor={`q-opts-${q.id}`}>Options (one per line)</label>
                  <textarea id={`q-opts-${q.id}`} className="input-field" rows={3} required value={q.optionsText} onChange={e => set('questions', form.questions.map(x => (x.id === q.id ? { ...x, optionsText: e.target.value } : x)))} />
                </div>
              )}
              <label className="inline-flex items-center text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={q.required} onChange={e => set('questions', form.questions.map(x => (x.id === q.id ? { ...x, required: e.target.checked } : x)))} className="mr-2 h-4 w-4 rounded border-gray-300 text-indigo-600" />
                Required
              </label>
            </div>
          ))}
          {form.questions.length < 10 && (
            <button type="button" className="btn btn-secondary" onClick={() => set('questions', [...form.questions, { id: newKey('q'), label: '', type: 'text', required: false, optionsText: '' }])}>
              <Plus className="w-4 h-4 mr-2" />
              Add a question
            </button>
          )}
        </Section>

        <Section title="Documents & certificates">
          <p className="text-sm text-gray-600">Students upload these after registering (PDF or image, up to 2 MB); their seat is confirmed once you approve them.</p>
          {form.documents.map((d, i) => (
            <div key={d.id} className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="label" htmlFor={`doc-${d.id}`}>Document {i + 1}</label>
                <input id={`doc-${d.id}`} className="input-field" required minLength={2} maxLength={120} placeholder="e.g. College ID card" value={d.label} onChange={e => set('documents', form.documents.map(x => (x.id === d.id ? { ...x, label: e.target.value } : x)))} />
              </div>
              <button type="button" className="btn btn-secondary text-red-600" onClick={() => set('documents', form.documents.filter(x => x.id !== d.id))}>
                <Trash2 className="w-4 h-4" />
                <span className="sr-only">Remove document {i + 1}</span>
              </button>
            </div>
          ))}
          {form.documents.length < 5 && (
            <button type="button" className="btn btn-secondary" onClick={() => set('documents', [...form.documents, { id: newKey('doc'), label: '' }])}>
              <Plus className="w-4 h-4 mr-2" />
              Require a document
            </button>
          )}
          <div>
            <label className="label" htmlFor="certificateRule">Certificates</label>
            <select id="certificateRule" className="input-field sm:w-80" value={form.certificateRule} onChange={e => set('certificateRule', e.target.value as CertificateRule)}>
              <option value="none">No certificates</option>
              <option value="attendance">Participation, for everyone who attended</option>
              <option value="winners">Only for winners in the results</option>
              <option value="attendance_and_winners">Participation for attendees, plus winners</option>
            </select>
          </div>
        </Section>

        <Section title="Contact">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="contactPerson">Contact person</label>
              <input id="contactPerson" className="input-field" maxLength={120} value={form.contactPerson} onChange={e => set('contactPerson', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="contactEmail">Contact email</label>
              <input id="contactEmail" type="email" className="input-field" value={form.contactEmail} onChange={e => set('contactEmail', e.target.value)} />
            </div>
          </div>
        </Section>

        {timeOrVenueChanged && (
          <Section title="Reason for the change">
            <div>
              <label className="label" htmlFor="changeReason">Why is the time or venue changing? (sent to everyone registered)</label>
              <input id="changeReason" className="input-field" required minLength={3} maxLength={300} value={changeReason} onChange={e => setChangeReason(e.target.value)} />
            </div>
          </Section>
        )}

        {submitError && (
          <p role="alert" className="text-sm text-red-600 flex items-center">
            <AlertCircle className="w-4 h-4 mr-2 shrink-0" />
            {submitError}
          </p>
        )}
        {clash && isAdmin && (
          <label className="flex items-center text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 cursor-pointer">
            <input type="checkbox" checked={overrideClash} onChange={e => setOverrideClash(e.target.checked)} className="mr-2 h-4 w-4 rounded border-gray-300 text-indigo-600" />
            Save anyway and double-book the venue (recorded in the audit log)
          </label>
        )}
        <div className="flex flex-col sm:flex-row gap-3">
          <button type="submit" name="action" value="save" disabled={saving} className={`btn py-3 sm:px-8 ${canSubmitForApproval ? 'btn-secondary' : 'btn-primary'}`}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Save draft'}
          </button>
          {canSubmitForApproval && (
            <button type="submit" name="action" value="submit" disabled={saving} className="btn btn-primary py-3 sm:px-8">
              {original?.status === 'changes_requested' ? 'Save and resubmit' : 'Save and submit for approval'}
            </button>
          )}
          <Link to="/admin" className="btn btn-secondary py-3">Cancel</Link>
        </div>
      </form>
    </div>
  );
};

export default AdminEventForm;
