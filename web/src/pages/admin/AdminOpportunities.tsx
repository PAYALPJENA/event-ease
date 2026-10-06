import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Plus } from 'lucide-react';
import ErrorState from '../../components/ErrorState';
import { useAuth } from '../../context/AuthContext';
import { createOpportunity, fetchAdminOpportunities, fetchAdminOptions, updateOpportunity } from '../../services/adminService';
import type { OpportunityInput } from '../../services/adminService';
import { ApiError } from '../../services/api';
import type { Opportunity, OpportunityType } from '../../types/event';
import { formatDateTime, isoToIstInput, istInputToIso } from '../../utils/format';

/** Post and manage opportunities (blueprint §4.12). Organizers post for their own organizations. */

const TYPES: OpportunityType[] = ['internship', 'scholarship', 'research', 'fellowship', 'competition', 'conference'];
const DEPARTMENTS = ['CSE', 'ECE', 'ME', 'CE', 'BBA'];

interface FormState {
  type: OpportunityType;
  title: string;
  provider: string;
  description: string;
  deadline: string;
  eligibilityText: string;
  departments: string[];
  years: number[];
  externalUrl: string;
  tags: string;
  organizationId: string;
  status: 'published' | 'archived';
}

const fromOpportunity = (o: Opportunity): FormState => ({
  type: o.type,
  title: o.title,
  provider: o.provider,
  description: o.description,
  deadline: isoToIstInput(o.deadline),
  eligibilityText: o.eligibilityText,
  departments: o.eligibleDepartments ?? [],
  years: o.eligibleYears ?? [],
  externalUrl: o.externalUrl ?? '',
  tags: o.tags.join(', '),
  organizationId: o.organizationId ?? '',
  status: o.status,
});

const toInput = (f: FormState): OpportunityInput => ({
  type: f.type,
  title: f.title.trim(),
  provider: f.provider.trim(),
  description: f.description.trim(),
  deadline: istInputToIso(f.deadline),
  eligibilityText: f.eligibilityText.trim(),
  eligibleDepartments: f.departments.length ? f.departments : null,
  eligibleYears: f.years.length ? f.years : null,
  externalUrl: f.externalUrl.trim() || null,
  tags: f.tags.split(',').map(t => t.trim()).filter(Boolean),
  organizationId: f.organizationId || null,
});

const OpportunityForm = ({ initial, orgs, isAdmin, onSave, onCancel }: { initial: FormState; orgs: { id: string; name: string }[]; isAdmin: boolean; onSave: (f: FormState) => Promise<void>; onCancel: () => void }) => {
  const [f, setF] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await onSave(f);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="label" htmlFor="o-type">Type</label>
          <select id="o-type" className="input-field capitalize" value={f.type} onChange={e => setF({ ...f, type: e.target.value as OpportunityType })}>
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="o-title">Title</label>
          <input id="o-title" className="input-field" required minLength={3} maxLength={150} value={f.title} onChange={e => setF({ ...f, title: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="o-provider">Provider</label>
          <input id="o-provider" className="input-field" required minLength={2} maxLength={120} value={f.provider} onChange={e => setF({ ...f, provider: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="o-deadline">Deadline (IST)</label>
          <input id="o-deadline" type="datetime-local" className="input-field" required value={f.deadline} onChange={e => setF({ ...f, deadline: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="o-org">Posted by</label>
          <select id="o-org" className="input-field" value={f.organizationId} onChange={e => setF({ ...f, organizationId: e.target.value })} required={!isAdmin}>
            {isAdmin && <option value="">Student Affairs (no club)</option>}
            {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="o-desc">Description</label>
        <textarea id="o-desc" className="input-field" rows={3} required minLength={10} maxLength={5000} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="o-elig">Eligibility (shown to students)</label>
          <input id="o-elig" className="input-field" required minLength={3} maxLength={200} value={f.eligibilityText} onChange={e => setF({ ...f, eligibilityText: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="o-url">Application link</label>
          <input id="o-url" type="url" className="input-field" value={f.externalUrl} onChange={e => setF({ ...f, externalUrl: e.target.value })} />
        </div>
      </div>
      <fieldset>
        <legend className="label">Departments (none = all)</legend>
        <div className="flex flex-wrap gap-3">
          {DEPARTMENTS.map(d => (
            <label key={d} className="inline-flex items-center text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={f.departments.includes(d)} onChange={() => setF({ ...f, departments: toggle(f.departments, d) })} className="mr-1.5 h-4 w-4 rounded border-gray-300 text-indigo-600" />
              {d}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="label">Years (none = all)</legend>
        <div className="flex flex-wrap gap-3">
          {[1, 2, 3, 4].map(y => (
            <label key={y} className="inline-flex items-center text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={f.years.includes(y)} onChange={() => setF({ ...f, years: toggle(f.years, y) })} className="mr-1.5 h-4 w-4 rounded border-gray-300 text-indigo-600" />
              Year {y}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label className="label" htmlFor="o-tags">Tags (comma separated)</label>
        <input id="o-tags" className="input-field" value={f.tags} onChange={e => setF({ ...f, tags: e.target.value })} />
      </div>
      <label className="inline-flex items-center text-sm text-gray-700 cursor-pointer">
        <input type="checkbox" checked={f.status === 'archived'} onChange={e => setF({ ...f, status: e.target.checked ? 'archived' : 'published' })} className="mr-2 h-4 w-4 rounded border-gray-300 text-indigo-600" />
        Archived (hidden from students)
      </label>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary">Save</button>
        <button type="button" onClick={onCancel} className="btn btn-secondary">Cancel</button>
      </div>
    </form>
  );
};

const AdminOpportunities = () => {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('admin');
  const [items, setItems] = useState<Opportunity[] | null>(null);
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, options] = await Promise.all([fetchAdminOpportunities(), fetchAdminOptions()]);
      setItems(list);
      setOrgs(options.organizations);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load opportunities.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const blank: FormState = { type: 'internship', title: '', provider: '', description: '', deadline: '', eligibilityText: 'All CUTM students', departments: [], years: [], externalUrl: '', tags: '', organizationId: isAdmin ? '' : orgs[0]?.id ?? '', status: 'published' };

  return (
    <div className="space-y-8 max-w-4xl">
      <Link to="/admin" className="flex items-center text-sm font-medium text-gray-600 hover:text-indigo-600">
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to Organizer
      </Link>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Opportunities</h1>
          <p className="text-gray-600">Internships, scholarships and competitions students can apply to. Students who save one are reminded the day before the deadline.</p>
        </div>
        {editing === null && (
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
            <Plus className="w-4 h-4 mr-2" />
            Post an opportunity
          </button>
        )}
      </div>
      <p role="status" className="text-sm text-gray-800 bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-3 [&:empty]:hidden">{message}</p>

      {editing === 'new' && (
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <OpportunityForm
            initial={blank}
            orgs={orgs}
            isAdmin={isAdmin}
            onCancel={() => setEditing(null)}
            onSave={async f => {
              await createOpportunity(toInput(f));
              setEditing(null);
              setMessage(`"${f.title}" posted.`);
              await load();
            }}
          />
        </section>
      )}

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !items ? (
        <p role="status" className="text-gray-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-gray-600">Nothing posted yet.</p>
      ) : (
        <ul className="space-y-4">
          {items.map(o => (
            <li key={o.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
              {editing === o.id ? (
                <OpportunityForm
                  initial={fromOpportunity(o)}
                  orgs={orgs}
                  isAdmin={isAdmin}
                  onCancel={() => setEditing(null)}
                  onSave={async f => {
                    await updateOpportunity(o.id, { ...toInput(f), status: f.status });
                    setEditing(null);
                    setMessage(`"${f.title}" saved.`);
                    await load();
                  }}
                />
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">{o.type} · {o.provider}{o.status === 'archived' && ' · archived'}</p>
                    <h2 className="font-bold text-gray-900">{o.title}</h2>
                    <p className="text-sm text-gray-600">Deadline {formatDateTime(o.deadline)}</p>
                  </div>
                  <button type="button" className="btn btn-secondary" onClick={() => setEditing(o.id)}>Edit</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default AdminOpportunities;
