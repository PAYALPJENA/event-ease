import { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Filter, SortDesc } from 'lucide-react';
import EventCard from '../components/EventCard';
import { EventCardSkeletonGrid } from '../components/EventCardSkeleton';
import ErrorState from '../components/ErrorState';
import { useEvents } from '../context/EventsContext';
import { getCategories } from '../services/eventService';
import { fetchCategories } from '../services/studentService';
import type { EventKind } from '../types/event';
import { EVENT_KINDS, EVENT_KIND_LABEL } from '../utils/taxonomy';

type DateFilter = 'all' | 'upcoming' | 'past';

const ExploreEvents = () => {
  // events comes from the shared EventsContext (already fetched via eventService),
  // so search/filtering below runs entirely client-side over in-memory data —
  // no extra requests and no page reloads as the user types or picks filters.
  const { events, loading, error, refetch } = useEvents();
  // A search typed on Home arrives as ?q=... and pre-fills the search box.
  const [searchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') ?? '');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [eventKind, setEventKind] = useState<EventKind | ''>('');

  // The full category taxonomy, in its fixed order (from the API). Until it
  // loads, fall back to the categories the events use.
  const [taxonomy, setTaxonomy] = useState<string[] | null>(null);
  useEffect(() => {
    fetchCategories()
      .then(list => setTaxonomy(list.map(c => c.name)))
      .catch(() => undefined);
  }, []);
  const categories = useMemo(() => taxonomy ?? getCategories(events), [taxonomy, events]);
  const kindsInUse = useMemo(() => EVENT_KINDS.filter(k => events.some(e => e.eventType === k)), [events]);

  const filteredEvents = useMemo(() => {
    return events
      .filter(event => {
        // Search filter
        const query = searchQuery.toLowerCase();
        const matchesSearch = [event.title, event.description, event.organization?.name ?? '', event.category.name, ...event.tags, event.venue?.name ?? '']
          .some(text => text.toLowerCase().includes(query));
        
        // Category and event type filters
        const matchesCategory = selectedCategory ? event.category.name === selectedCategory : true;
        const matchesKind = eventKind ? event.eventType === eventKind : true;
        
        // Date filter
        const isUpcoming = event.phase !== 'completed';
        const matchesDate = dateFilter === 'all' 
          ? true 
          : dateFilter === 'upcoming' 
            ? isUpcoming 
            : !isUpcoming;
            
        return matchesSearch && matchesCategory && matchesKind && matchesDate;
      })
      .sort((a, b) => {
        // Upcoming and ongoing first (soonest first), then past events (most recent first).
        const aPast = a.phase === 'completed', bPast = b.phase === 'completed';
        if (aPast !== bPast) return aPast ? 1 : -1;
        const diff = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
        return aPast ? -diff : diff;
      });
  }, [events, searchQuery, selectedCategory, eventKind, dateFilter]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Explore Events</h1>
        <p className="text-gray-600">Find and register for upcoming CUTM events.</p>
      </div>

      {/* Filters and Search */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
        <div className="relative w-full md:w-96">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-gray-400" />
          </div>
          <input 
            type="text" 
            aria-label="Search events"
            placeholder="Search events by name or keyword..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-field pl-10 w-full"
          />
        </div>
        
        <div className="flex flex-wrap gap-3 w-full md:w-auto">
          <div className="flex items-center space-x-2 bg-gray-50 rounded-lg p-1 border border-gray-200">
            <Filter className="w-4 h-4 text-gray-500 ml-2" />
            <select 
              aria-label="Filter by category"
              className="bg-transparent border-none text-sm focus:ring-0 text-gray-700 py-1.5 pr-8 cursor-pointer"
              value={selectedCategory || ''}
              onChange={(e) => setSelectedCategory(e.target.value || null)}
            >
              <option value="">All Categories</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          
          <div className="flex items-center space-x-2 bg-gray-50 rounded-lg p-1 border border-gray-200">
            <select
              aria-label="Filter by event type"
              className="bg-transparent border-none text-sm focus:ring-0 text-gray-700 py-1.5 pr-8 cursor-pointer"
              value={eventKind}
              onChange={e => setEventKind(e.target.value as EventKind | '')}
            >
              <option value="">All Event Types</option>
              {kindsInUse.map(k => (
                <option key={k} value={k}>{EVENT_KIND_LABEL[k]}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center space-x-2 bg-gray-50 rounded-lg p-1 border border-gray-200">
            <SortDesc className="w-4 h-4 text-gray-500 ml-2" />
            <select 
              aria-label="Filter by date"
              className="bg-transparent border-none text-sm focus:ring-0 text-gray-700 py-1.5 pr-8 cursor-pointer"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as DateFilter)}
            >
              <option value="all">All Dates</option>
              <option value="upcoming">Upcoming Only</option>
              <option value="past">Past Events</option>
            </select>
          </div>
        </div>
      </div>

      {/* Category Pills (Quick Filters): one scrollable row on phones, wrapped on wider screens */}
      <div className="-mx-4 px-4 sm:mx-0 sm:px-0 flex flex-nowrap sm:flex-wrap gap-2 overflow-x-auto pb-1" role="group" aria-label="Categories">
        <button
          type="button"
          aria-pressed={selectedCategory === null}
          onClick={() => setSelectedCategory(null)}
          className={`shrink-0 whitespace-nowrap px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            selectedCategory === null 
              ? 'bg-indigo-600 text-white shadow-sm' 
              : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
          }`}
        >
          All
        </button>
        {categories.map(cat => (
          <button
            key={cat}
            type="button"
            aria-pressed={selectedCategory === cat}
            onClick={() => setSelectedCategory(cat)}
            className={`shrink-0 whitespace-nowrap px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              selectedCategory === cat 
                ? 'bg-indigo-600 text-white shadow-sm' 
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Results */}
      {error ? (
        <ErrorState message={error} onRetry={refetch} />
      ) : loading ? (
        <EventCardSkeletonGrid />
      ) : filteredEvents.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredEvents.map(event => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col items-center justify-center">
          <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
            <Search className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-1">No events found</h3>
          <p className="text-gray-500">Try adjusting your filters or search terms.</p>
          <button
            onClick={() => {
              setSearchQuery('');
              setSelectedCategory(null);
              setDateFilter('all');
            }}
            className="mt-4 text-indigo-600 font-medium hover:text-indigo-800 transition-colors"
          >
            Clear all filters
          </button>
        </div>
      )}
    </div>
  );
};

export default ExploreEvents;
