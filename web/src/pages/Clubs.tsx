import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Users } from 'lucide-react';
import ErrorState from '../components/ErrorState';
import FollowButton from '../components/FollowButton';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../services/api';
import { fetchClubs, fetchFollowedIds } from '../services/studentService';
import type { Club } from '../types/event';

const TYPE_LABEL: Record<Club['type'], string> = { club: 'Club', department: 'Department', cell: 'Cell' };

/** Club directory (blueprint §4.11): search, filter by type, follow. */
const Clubs = () => {
  const { user } = useAuth();
  const [clubs, setClubs] = useState<Club[] | null>(null);
  const [followed, setFollowed] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [type, setType] = useState<'' | Club['type']>('');

  const load = () => {
    setError(null);
    fetchClubs()
      .then(setClubs)
      .catch(err => setError(err instanceof ApiError ? err.message : 'Unable to load clubs.'));
  };
  useEffect(load, []);
  useEffect(() => {
    if (user) fetchFollowedIds().then(setFollowed).catch(() => undefined);
  }, [user]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (clubs ?? []).filter(c => (!type || c.type === type) && (!q || c.name.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q)));
  }, [clubs, query, type]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Clubs & departments</h1>
        <p className="text-gray-600">Follow the ones you like: their new events show up on your Home page and in your notifications.</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <label htmlFor="club-search" className="sr-only">Search clubs</label>
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input id="club-search" className="input-field pl-9" placeholder="Search clubs" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <label htmlFor="club-type" className="sr-only">Type</label>
        <select id="club-type" className="input-field sm:w-48" value={type} onChange={e => setType(e.target.value as typeof type)}>
          <option value="">All types</option>
          <option value="club">Clubs</option>
          <option value="department">Departments</option>
          <option value="cell">Cells</option>
        </select>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !clubs ? (
        <p role="status" className="text-gray-500">Loading clubs…</p>
      ) : shown.length === 0 ? (
        <p className="text-gray-600">No clubs match.</p>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {shown.map(club => (
            <li key={club.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col">
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">{TYPE_LABEL[club.type]}</p>
              <h2 className="text-lg font-bold text-gray-900 mt-1">
                <Link to={`/clubs/${club.slug}`} className="hover:text-indigo-700">{club.name}</Link>
              </h2>
              <p className="text-sm text-gray-600 mt-2 flex-1">{club.description}</p>
              <p className="text-xs text-gray-600 mt-3 flex items-center">
                <Users className="w-4 h-4 mr-1" />
                {club.followers} follower{club.followers === 1 ? '' : 's'} · {club.upcomingEvents ?? 0} upcoming event{club.upcomingEvents === 1 ? '' : 's'}
              </p>
              <div className="mt-4">
                <FollowButton
                  club={club}
                  following={followed.includes(club.id)}
                  onChange={f => {
                    setFollowed(ids => (f ? [...ids, club.id] : ids.filter(id => id !== club.id)));
                    setClubs(list => list?.map(c => (c.id === club.id ? { ...c, followers: c.followers + (f ? 1 : -1) } : c)) ?? null);
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default Clubs;
