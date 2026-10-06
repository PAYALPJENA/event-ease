import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import ErrorState from '../../components/ErrorState';
import { useAuth } from '../../context/AuthContext';
import { createOrganization, fetchOrganizations, removeMember, setMember, updateOrganization } from '../../services/adminService';
import type { AdminOrganization, OrganizationInput } from '../../services/adminService';
import { ApiError } from '../../services/api';

/**
 * Clubs & organizations (blueprint §6). Admins create clubs, assign roles and
 * deactivate; a club's lead edits its public page (about, recruitment, links).
 */

const blank: OrganizationInput = { name: '', type: 'club', description: null, contactEmail: null, logoUrl: null, socialLinks: {}, recruitment: null };
const SOCIALS = ['website', 'instagram', 'linkedin', 'youtube'] as const;
const ROLE_LABEL = { lead: 'Lead', organizer: 'Organizer', member: 'Member', volunteer: 'Volunteer' };

const OrgForm = ({ initial, isAdmin, onSave, onCancel }: { initial: OrganizationInput; isAdmin: boolean; onSave: (input: OrganizationInput) => Promise<void>; onCancel?: () => void }) => {
  const [f, setF] = useState<OrganizationInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const socialLinks = Object.fromEntries(Object.entries(f.socialLinks).filter(([, v]) => v.trim()));
      await onSave({ ...f, name: f.name.trim(), description: f.description?.trim() || null, recruitment: f.recruitment?.trim() || null, contactEmail: f.contactEmail?.trim() || null, logoUrl: f.logoUrl?.trim() || null, socialLinks });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };
  const key = initial.name || 'new';
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2">
          <label className="label" htmlFor={`name-${key}`}>Name</label>
          <input id={`name-${key}`} className="input-field" required minLength={3} maxLength={120} disabled={!isAdmin} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor={`type-${key}`}>Type</label>
          <select id={`type-${key}`} className="input-field" disabled={!isAdmin} value={f.type} onChange={e => setF({ ...f, type: e.target.value as OrganizationInput['type'] })}>
            <option value="club">Club</option>
            <option value="department">Department</option>
            <option value="cell">Cell</option>
          </select>
        </div>
      </div>
      <div>
        <label className="label" htmlFor={`desc-${key}`}>About</label>
        <textarea id={`desc-${key}`} className="input-field" rows={2} maxLength={2000} value={f.description ?? ''} onChange={e => setF({ ...f, description: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor={`rec-${key}`}>Recruiting (optional; shown on the club page)</label>
        <input id={`rec-${key}`} className="input-field" maxLength={1000} value={f.recruitment ?? ''} onChange={e => setF({ ...f, recruitment: e.target.value })} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor={`email-${key}`}>Contact email</label>
          <input id={`email-${key}`} type="email" className="input-field" value={f.contactEmail ?? ''} onChange={e => setF({ ...f, contactEmail: e.target.value })} />
        </div>
        {SOCIALS.map(s => (
          <div key={s}>
            <label className="label capitalize" htmlFor={`${s}-${key}`}>{s} link</label>
            <input id={`${s}-${key}`} type="url" className="input-field" value={f.socialLinks[s] ?? ''} onChange={e => setF({ ...f, socialLinks: { ...f.socialLinks, [s]: e.target.value } })} />
          </div>
        ))}
      </div>
      {isAdmin && f.status && (
        <label className="inline-flex items-center text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={f.status === 'inactive'} onChange={e => setF({ ...f, status: e.target.checked ? 'inactive' : 'active' })} className="mr-2 h-4 w-4 rounded border-gray-300 text-indigo-600" />
          Deactivated (hidden from the directory)
        </label>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn btn-primary">{busy ? 'Saving…' : 'Save'}</button>
        {onCancel && <button type="button" onClick={onCancel} className="btn btn-secondary">Cancel</button>}
      </div>
    </form>
  );
};

const Members = ({ org, onChange }: { org: AdminOrganization; onChange: (message: string) => Promise<void> }) => {
  const [roll, setRoll] = useState('');
  const [role, setRole] = useState('organizer');
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-gray-100 text-sm">
        {org.members.length === 0 && <li className="py-2 text-gray-600">No members yet.</li>}
        {org.members.map(m => (
          <li key={m.userId} className="py-2 flex items-center justify-between gap-3">
            <span>{m.name} <span className="text-gray-600 font-mono text-xs">{m.universityId}</span> · {ROLE_LABEL[m.role]}</span>
            <button type="button" className="text-red-600 hover:underline" onClick={() => removeMember(org.id, m.userId).then(() => onChange(`${m.name} removed.`)).catch(() => setError('Could not remove.'))}>
              <Trash2 className="w-4 h-4" />
              <span className="sr-only">Remove {m.name}</span>
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-col sm:flex-row gap-2 sm:items-end"
        onSubmit={async e => {
          e.preventDefault();
          setError(null);
          try {
            await setMember(org.id, roll.trim(), role);
            setRoll('');
            await onChange('Role assigned. Leads and organizers can now manage this organization’s events.');
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not assign the role.');
          }
        }}
      >
        <div className="flex-1">
          <label className="label" htmlFor={`roll-${org.id}`}>Roll number</label>
          <input id={`roll-${org.id}`} className="input-field font-mono" required minLength={3} value={roll} onChange={e => setRoll(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor={`role-${org.id}`}>Role</label>
          <select id={`role-${org.id}`} className="input-field" value={role} onChange={e => setRole(e.target.value)}>
            {Object.entries(ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <button type="submit" className="btn btn-secondary">Assign</button>
      </form>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </div>
  );
};

const AdminOrganizations = () => {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('admin');
  const [orgs, setOrgs] = useState<AdminOrganization[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setOrgs(await fetchOrganizations());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load organizations.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const done = async (text: string) => {
    setMessage(text);
    setEditing(null);
    setCreating(false);
    await load();
  };

  return (
    <div className="space-y-8 max-w-4xl">
      <Link to="/admin" className="flex items-center text-sm font-medium text-gray-600 hover:text-indigo-600">
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to Organizer
      </Link>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 mb-2">{isAdmin ? 'Clubs & organizations' : 'My club pages'}</h1>
          <p className="text-gray-600">{isAdmin ? 'Create clubs, assign organizers and edit public club pages.' : 'Edit what students see on your club’s page.'}</p>
        </div>
        {isAdmin && !creating && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus className="w-4 h-4 mr-2" />
            New organization
          </button>
        )}
      </div>
      <p role="status" className="text-sm text-gray-800 bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-3 [&:empty]:hidden">{message}</p>

      {creating && (
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-3">New organization</h2>
          <OrgForm initial={blank} isAdmin onCancel={() => setCreating(false)} onSave={async input => { await createOrganization(input); await done(`${input.name} created.`); }} />
        </section>
      )}

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !orgs ? (
        <p role="status" className="text-gray-500">Loading…</p>
      ) : (
        <ul className="space-y-4">
          {orgs.map(org => (
            <li key={org.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">
                    <Link to={`/clubs/${org.slug}`} className="hover:text-indigo-700">{org.name}</Link>
                    {org.status === 'inactive' && <span className="ml-2 text-xs rounded-full bg-gray-100 px-2 py-0.5 text-gray-700">Inactive</span>}
                  </h2>
                  <p className="text-sm text-gray-600">{org.description}</p>
                </div>
                {editing !== org.id && <button type="button" className="btn btn-secondary" onClick={() => setEditing(org.id)}>Edit page</button>}
              </div>
              {editing === org.id && (
                <OrgForm
                  initial={{ name: org.name, type: org.type, description: org.description, contactEmail: org.contactEmail, logoUrl: org.logoUrl, socialLinks: org.socialLinks, recruitment: org.recruitment, status: org.status }}
                  isAdmin={isAdmin}
                  onCancel={() => setEditing(null)}
                  onSave={async input => { await updateOrganization(org.id, input); await done(`${org.name} saved.`); }}
                />
              )}
              {isAdmin && (
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-indigo-700">Members & roles ({org.members.length})</summary>
                  <div className="mt-3"><Members org={org} onChange={done} /></div>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default AdminOrganizations;
