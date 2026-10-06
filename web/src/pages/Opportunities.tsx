import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Bookmark, ExternalLink, Clock } from 'lucide-react';
import ErrorState from '../components/ErrorState';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../services/api';
import { fetchOpportunities, fetchOpportunity, fetchSavedOpportunityIds, setOpportunitySaved } from '../services/studentService';
import type { Opportunity, OpportunityType } from '../types/event';
import { formatDateTime } from '../utils/format';

/**
 * Opportunities (blueprint §4.12): internships, scholarships, research,
 * fellowships, external competitions and conferences. Unlike events they have
 * a deadline instead of a time and place, and usually an external application.
 */

const TYPE_LABEL: Record<OpportunityType, string> = {
  internship: 'Internship',
  scholarship: 'Scholarship',
  research: 'Research',
  fellowship: 'Fellowship',
  competition: 'Competition',
  conference: 'Conference',
};

const daysLeft = (deadline: string) => Math.ceil((new Date(deadline).getTime() - Date.now()) / 86_400_000);

const useSaved = () => {
  const { user } = useAuth();
  const [saved, setSaved] = useState<string[]>([]);
  useEffect(() => {
    if (user) fetchSavedOpportunityIds().then(setSaved).catch(() => undefined);
  }, [user]);
  const toggle = async (id: string) => {
    const next = !saved.includes(id);
    setSaved(s => (next ? [...s, id] : s.filter(x => x !== id)));
    try {
      await setOpportunitySaved(id, next);
    } catch {
      setSaved(s => (next ? s.filter(x => x !== id) : [...s, id]));
    }
  };
  return { saved, toggle, signedIn: !!user };
};

const SaveButton = ({ id, title, saved, onToggle, signedIn }: { id: string; title: string; saved: boolean; onToggle: (id: string) => void; signedIn: boolean }) =>
  signedIn ? (
    <button type="button" aria-pressed={saved} onClick={() => onToggle(id)} className={`btn text-sm ${saved ? 'btn-secondary text-indigo-700' : 'btn-secondary'}`}>
      <Bookmark className={`w-4 h-4 mr-1 ${saved ? 'fill-indigo-600' : ''}`} />
      {saved ? 'Saved' : 'Save'}
      <span className="sr-only"> {title}</span>
    </button>
  ) : null;

const Deadline = ({ deadline }: { deadline: string }) => {
  const days = daysLeft(deadline);
  return (
    <p className={`flex items-center text-sm ${days <= 3 ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
      <Clock className="w-4 h-4 mr-1" />
      Apply by {formatDateTime(deadline)}{days <= 7 && ` · ${days <= 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} left`}`}
    </p>
  );
};

export const Opportunities = () => {
  const [items, setItems] = useState<Opportunity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<'' | OpportunityType>('');
  const [eligibleOnly, setEligibleOnly] = useState(true);
  const { saved, toggle, signedIn } = useSaved();

  const load = () => {
    setError(null);
    fetchOpportunities()
      .then(setItems)
      .catch(err => setError(err instanceof ApiError ? err.message : 'Unable to load opportunities.'));
  };
  useEffect(load, []);

  const shown = useMemo(
    () => (items ?? []).filter(o => (!type || o.type === type) && (!eligibleOnly || !signedIn || o.eligible !== false)),
    [items, type, eligibleOnly, signedIn]
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Opportunities</h1>
        <p className="text-gray-600">Internships, scholarships, research positions and competitions. Save one to get a reminder the day before it closes.</p>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <label htmlFor="opp-type" className="sr-only">Type</label>
        <select id="opp-type" className="input-field sm:w-56" value={type} onChange={e => setType(e.target.value as typeof type)}>
          <option value="">All types</option>
          {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {signedIn && (
          <label className="inline-flex items-center text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={eligibleOnly} onChange={e => setEligibleOnly(e.target.checked)} className="mr-2 h-4 w-4 rounded border-gray-300 text-indigo-600" />
            Only ones I'm eligible for
          </label>
        )}
      </div>

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !items ? (
        <p role="status" className="text-gray-500">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-gray-600">Nothing open right now{eligibleOnly && signedIn ? ' that matches your profile' : ''}.</p>
      ) : (
        <ul className="space-y-4">
          {shown.map(o => (
            <li key={o.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">{TYPE_LABEL[o.type]} · {o.provider}</p>
                <h2 className="text-lg font-bold text-gray-900">
                  <Link to={`/opportunities/${o.id}`} className="hover:text-indigo-700">{o.title}</Link>
                </h2>
                <Deadline deadline={o.deadline} />
                <p className="text-sm text-gray-600">{o.eligibilityText}{o.eligible === false && ' · not matching your profile'}</p>
              </div>
              <SaveButton id={o.id} title={o.title} saved={saved.includes(o.id)} onToggle={toggle} signedIn={signedIn} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const OpportunityDetail = () => {
  const { id = '' } = useParams<{ id: string }>();
  const [o, setO] = useState<Opportunity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { saved, toggle, signedIn } = useSaved();

  useEffect(() => {
    fetchOpportunity(id)
      .then(setO)
      .catch(err => setError(err instanceof ApiError ? err.message : 'Unable to load this opportunity.'));
  }, [id]);

  if (error) return <p role="alert" className="py-24 text-center text-red-600">{error}</p>;
  if (!o) return <p role="status" className="py-24 text-center text-gray-500">Loading…</p>;

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      <Link to="/opportunities" className="flex items-center text-sm font-medium text-gray-600 hover:text-indigo-600">
        <ArrowLeft className="w-4 h-4 mr-1" />
        All opportunities
      </Link>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 sm:p-8 space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">{TYPE_LABEL[o.type]} · {o.provider}</p>
        <h1 className="text-3xl font-extrabold text-gray-900">{o.title}</h1>
        <Deadline deadline={o.deadline} />
        <p className="text-gray-700 whitespace-pre-line">{o.description}</p>
        <p className="text-sm text-gray-700"><span className="font-semibold">Eligibility:</span> {o.eligibilityText}</p>
        {o.eligible === false && <p className="text-sm text-amber-800 bg-amber-50 rounded-lg p-3">Your profile doesn't match the eligibility for this one.</p>}
        {o.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {o.tags.map(t => <span key={t} className="text-xs rounded-full bg-gray-100 px-2 py-1 text-gray-700">{t}</span>)}
          </div>
        )}
        <div className="flex flex-wrap gap-3 pt-2">
          {o.externalUrl && (
            <a href={o.externalUrl} target="_blank" rel="noreferrer" className="btn btn-primary">
              Apply on {new URL(o.externalUrl).hostname}
              <ExternalLink className="w-4 h-4 ml-2" />
            </a>
          )}
          <SaveButton id={o.id} title={o.title} saved={saved.includes(o.id)} onToggle={toggle} signedIn={signedIn} />
        </div>
      </div>
    </div>
  );
};
