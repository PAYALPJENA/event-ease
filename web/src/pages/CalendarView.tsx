import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import ErrorState from '../components/ErrorState';
import { useEvents } from '../context/EventsContext';
import { useUserEvents } from '../context/UserEventsContext';
import { formatTime, istDayKey } from '../utils/format';

const CalendarView = () => {
  // Reuses the events already fetched by EventsProvider — no separate
  // request is made just because this page mounts.
  const { events, loading, error, refetch } = useEvents();
  const { isRegistered } = useUserEvents();
  const [currentDate, setCurrentDate] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (year: number, month: number) => {
    return new Date(year, month, 1).getDay();
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const daysInMonth = getDaysInMonth(currentDate.getFullYear(), currentDate.getMonth());
  const firstDay = getFirstDayOfMonth(currentDate.getFullYear(), currentDate.getMonth());
  
  const blanks = Array.from({ length: firstDay }).map((_, i) => <div key={`blank-${i}`} className="p-2 border border-gray-100 bg-gray-50/50 min-h-[100px]"></div>);
  
  const days = Array.from({ length: daysInMonth }).map((_, i) => {
    const day = i + 1;
    const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    
    // Find events for this day
    const dayEvents = events.filter(event => istDayKey(event.startsAt) === dateStr);
    
    return (
      <div key={`day-${day}`} className={`p-2 border border-gray-100 min-h-[100px] flex flex-col ${dayEvents.length > 0 ? 'bg-indigo-50/30' : 'bg-white'}`}>
        <span className={`text-sm font-medium mb-1 ${dayEvents.length > 0 ? 'text-indigo-600' : 'text-gray-500'}`}>{day}</span>
        <div className="flex flex-col gap-1 overflow-y-auto max-h-[80px]">
          {dayEvents.map(event => (
            <Link 
              key={event.id}
              to={`/event/${event.id}`}
              className={`text-xs p-1 rounded truncate transition-colors ${
                isRegistered(event.id)
                  ? 'bg-indigo-600 text-white font-semibold hover:bg-indigo-700'
                  : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
              }`}
              title={isRegistered(event.id) ? `${event.title} (you're registered)` : event.title}
            >
              {formatTime(event.startsAt)} {event.title}
            </Link>
          ))}
        </div>
      </div>
    );
  });

  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Event Calendar</h1>
          <p className="text-gray-600">View events across the month. Events you're registered for are highlighted.</p>
        </div>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={refetch} />
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-4 flex items-center justify-between border-b border-gray-200">
            <button type="button" onClick={prevMonth} aria-label="Previous month" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <ChevronLeft className="w-5 h-5 text-gray-600" />
            </button>
            <h2 className="text-lg font-bold text-gray-900">
              {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
            </h2>
            <button type="button" onClick={nextMonth} aria-label="Next month" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <ChevronRight className="w-5 h-5 text-gray-600" />
            </button>
          </div>

          <div className="grid grid-cols-7 bg-gray-50 border-b border-gray-200">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="py-2 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {day}
              </div>
            ))}
          </div>

          {loading ? (
            <div className="grid grid-cols-7 animate-pulse" aria-hidden="true">
              {Array.from({ length: 35 }).map((_, i) => (
                <div key={i} className="p-2 border border-gray-100 min-h-[100px] bg-gray-50" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-7">
              {blanks}
              {days}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CalendarView;
