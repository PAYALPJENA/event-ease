import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Globe, Mail, Megaphone, Users } from 'lucide-react';
import EventCard from '../components/EventCard';
import FollowButton from '../components/FollowButton';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../services/api';
import { fetchClub, fetchFollowedIds } from '../services/studentService';
import type { Club, EventType } from '../types/event';

const SOCIAL_LABEL: Record<string, string> = { website: 'Website', instagram: 'Instagram', linkedin: 'LinkedIn', youtube: 'YouTube' };

/** Club page (blueprint §4.11): about, recruitment, events, contacts, follow. */
const ClubPage = () => {
  const { slug = '' } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const [club, setClub] = useState<Club | null>(null);
  const [events, setEvents] = useState<EventType[]>([]);
  const [following, setFollowingState] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchClub(slug)
      .then(r => {
        setClub(r.club);
        setEvents(r.events);
      })
      .catch(err => setError(err instanceof ApiError ? err.message : 'Unable to load this club.'));
  }, [slug]);

  useEffect(() => {
    if (user && club) fetchFollowedIds().then(ids => setFollowingState(ids.includes(club.id))).catch(() => undefined);
  }, [user, club]);

  if (error) return <p role="alert" className="py-24 text-center text-red-600">{error}</p>;
  if (!club) return <p role="status" className="py-24 text-center text-gray-500">Loading…</p>;

  const upcoming = events.filter(e => e.phase !== 'completed' && e.status === 'published').sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = events.filter(e => e.phase === 'completed' && e.status === 'published');

  return (
    <div className="space-y-8">
      <Link to="/clubs" className="flex items-center text-sm font-medium text-gray-600 hover:text-indigo-600">
        <ArrowLeft className="w-4 h-4 mr-1" />
        All clubs
      </Link>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 sm:p-8 flex flex-col md:flex-row md:items-start gap-6">
        <div className="flex-1 space-y-3">
          <h1 className="text-3xl font-extrabold text-gray-900">{club.name}</h1>
          {club.description && <p className="text-gray-700">{club.description}</p>}
          <p className="text-sm text-gray-600 flex items-center">
            <Users className="w-4 h-4 mr-1" />
            {club.followers} follower{club.followers === 1 ? '' : 's'}
          </p>
          <div className="flex flex-wrap gap-3 text-sm">
            {club.contactEmail && (
              <a href={`mailto:${club.contactEmail}`} className="inline-flex items-center text-indigo-600 hover:underline">
                <Mail className="w-4 h-4 mr-1" />
                {club.contactEmail}
              </a>
            )}
            {Object.entries(club.socialLinks).map(([k, url]) => (
              <a key={k} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center text-indigo-600 hover:underline">
                <Globe className="w-4 h-4 mr-1" />
                {SOCIAL_LABEL[k] ?? k}
              </a>
            ))}
          </div>
          {club.contacts && club.contacts.length > 0 && (
            <p className="text-sm text-gray-700">
              Contacts: {club.contacts.map(c => `${c.name} (${c.role})`).join(', ')}
            </p>
          )}
        </div>
        <FollowButton
          club={club}
          following={following}
          onChange={f => {
            setFollowingState(f);
            setClub(c => (c ? { ...c, followers: c.followers + (f ? 1 : -1) } : c));
          }}
        />
      </div>

      {club.recruitment && (
        <p className="flex items-start rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-indigo-900">
          <Megaphone className="w-5 h-5 mr-3 mt-0.5 shrink-0" />
          <span><span className="font-semibold">Recruiting: </span>{club.recruitment}</span>
        </p>
      )}

      <section aria-labelledby="upcoming-heading" className="space-y-4">
        <h2 id="upcoming-heading" className="text-xl font-bold text-gray-900">Upcoming events</h2>
        {upcoming.length === 0 ? (
          <p className="text-gray-600">No upcoming events right now. Follow {club.name} to hear about the next one.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{upcoming.map(e => <EventCard key={e.id} event={e} />)}</div>
        )}
      </section>

      {past.length > 0 && (
        <section aria-labelledby="past-heading" className="space-y-4">
          <h2 id="past-heading" className="text-xl font-bold text-gray-900">Past events</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{past.map(e => <EventCard key={e.id} event={e} />)}</div>
        </section>
      )}
    </div>
  );
};

export default ClubPage;
