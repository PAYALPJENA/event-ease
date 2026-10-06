import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Search, Sparkles, Users, Zap } from 'lucide-react';
import EventCard from '../components/EventCard';
import { EventCardSkeletonGrid } from '../components/EventCardSkeleton';
import ErrorState from '../components/ErrorState';
import { useAuth } from '../context/AuthContext';
import { useEvents } from '../context/EventsContext';
import { getUpcomingEvents, getFeaturedEvents } from '../services/eventService';
import { fetchFollowedIds, fetchRecommendations } from '../services/studentService';
import type { Recommendation } from '../types/event';

/** "Why am I seeing this?" (blueprint §7.5): every suggestion explains itself. */
const WhyThis = ({ reasons }: { reasons: string[] }) => (
  <details className="text-xs text-gray-600">
    <summary className="cursor-pointer text-indigo-700 font-medium">Why am I seeing this?</summary>
    <ul className="mt-1 list-disc pl-4 space-y-0.5">
      {reasons.map(r => <li key={r}>{r}</li>)}
    </ul>
  </details>
);

const Home = () => {
  // Events arrive asynchronously via EventsProvider -> eventService -> fetch('/data/events.json').
  const { events, loading, error, refetch } = useEvents();
  const upcomingEvents = useMemo(() => getUpcomingEvents(events), [events]);
  const featuredEvents = useMemo(() => getFeaturedEvents(events), [events]);
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const { user } = useAuth();
  const [recommended, setRecommended] = useState<Recommendation[]>([]);
  const [followedIds, setFollowedIds] = useState<string[]>([]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchRecommendations()
      .then(r => !cancelled && setRecommended(r.items))
      .catch(() => undefined);
    fetchFollowedIds()
      .then(ids => !cancelled && setFollowedIds(ids))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user]);

  const fromFollowed = useMemo(
    () => (user ? upcomingEvents.filter(e => e.organization !== null && followedIds.includes(e.organization.id)).slice(0, 4) : []),
    [user, upcomingEvents, followedIds]
  );

  // Client-side route change (no full page reload), so the already-fetched
  // events in EventsContext are reused by Explore instead of being re-requested.
  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    const query = searchQuery.trim();
    navigate(query ? `/explore?q=${encodeURIComponent(query)}` : '/explore');
  };

  return (
    <div className="space-y-12 pb-12">
      {/* Hero Section */}
      <section className="relative bg-gradient-to-br from-indigo-900 to-indigo-700 rounded-3xl overflow-hidden shadow-xl mt-4">
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1523580494863-6f3031224c94?ixlib=rb-4.0.3&auto=format&fit=crop&w=2000&q=80')] mix-blend-overlay opacity-20 bg-cover bg-center"></div>
        <div className="relative px-6 py-16 sm:px-12 sm:py-24 max-w-4xl">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight mb-4">
            Discover. Register. <br className="hidden sm:block" />
            <span className="text-teal-400">Never Miss a CUTM Event.</span>
          </h1>
          <p className="text-lg text-indigo-100 mb-8 max-w-2xl">
            The centralized platform for all Centurion University events. Find what interests you, register in seconds, and keep track of your schedule.
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <Link to="/explore" className="btn bg-teal-500 text-indigo-950 font-semibold hover:bg-teal-400 text-base px-8 py-3 rounded-xl shadow-lg hover:shadow-xl transition-all">
              Explore Events
              <ArrowRight className="ml-2 w-5 h-5" />
            </Link>
            <form role="search" onSubmit={handleSearch} className="relative w-full sm:w-auto">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-gray-400" />
              </div>
              <input 
                type="search" 
                aria-label="Search events"
                placeholder="Search events..." 
                className="w-full sm:w-64 pl-10 pr-4 py-3 bg-white/10 border border-white/20 text-white placeholder-indigo-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-400 focus:bg-white/20 backdrop-blur-sm transition-all"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </form>
          </div>
        </div>
      </section>

      {error ? (
        <ErrorState message={error} onRetry={refetch} />
      ) : (
        <>
          {user && recommended.length > 0 && (
            <section aria-labelledby="recommended-heading">
              <div className="flex items-center justify-between mb-6">
                <h2 id="recommended-heading" className="flex items-center text-2xl font-bold text-gray-900">
                  <Sparkles className="w-6 h-6 text-indigo-500 mr-2" />
                  Recommended for you
                </h2>
                <Link to="/profile" className="text-sm font-medium text-indigo-600 hover:text-indigo-800">Edit interests</Link>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {recommended.slice(0, 3).map(r => (
                  <EventCard key={r.event.id} event={r.event} action={<WhyThis reasons={r.reasons} />} />
                ))}
              </div>
            </section>
          )}

          {fromFollowed.length > 0 && (
            <section aria-labelledby="followed-heading">
              <div className="flex items-center justify-between mb-6">
                <h2 id="followed-heading" className="flex items-center text-2xl font-bold text-gray-900">
                  <Users className="w-6 h-6 text-indigo-500 mr-2" />
                  From clubs you follow
                </h2>
                <Link to="/clubs" className="text-sm font-medium text-indigo-600 hover:text-indigo-800">All clubs</Link>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {fromFollowed.map(event => <EventCard key={event.id} event={event} />)}
              </div>
            </section>
          )}

          {/* Featured Events (Optional, small section) */}
          {(loading || featuredEvents.length > 0) && (
            <section>
              <div className="flex items-center mb-6">
                <Zap className="w-6 h-6 text-yellow-500 mr-2" />
                <h2 className="text-2xl font-bold text-gray-900">Featured Events</h2>
              </div>
              {loading ? (
                <EventCardSkeletonGrid count={3} />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {featuredEvents.slice(0, 3).map(event => (
                    <EventCard key={event.id} event={event} />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Upcoming Events Grid (Priority for discoverability) */}
          <section>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-900">Upcoming Events</h2>
              <Link to="/explore" className="text-sm font-medium text-indigo-600 hover:text-indigo-800 transition-colors flex items-center">
                View all
                <ArrowRight className="ml-1 w-4 h-4" />
              </Link>
            </div>

            {loading ? (
              <EventCardSkeletonGrid />
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {upcomingEvents.map(event => (
                    <EventCard key={event.id} event={event} />
                  ))}
                </div>

                {upcomingEvents.length === 0 && (
                  <div className="text-center py-12 bg-white rounded-xl border border-gray-100 shadow-sm">
                    <p className="text-gray-500 text-lg">No upcoming events yet. Check back later!</p>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export default Home;
