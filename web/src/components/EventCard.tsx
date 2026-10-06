import React from 'react';
import { Calendar, Clock, MapPin, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { EventType } from '../types/event';
import { eventDateLabel, eventTimeLabel, venueLabel } from '../utils/format';
import { EVENT_KIND_LABEL } from '../utils/taxonomy';
import { registrationStatus } from '../utils/status';

interface EventCardProps {
  event: EventType;
  /** Optional extra action rendered at the bottom of the card (e.g. "Rate this Event" in My Events). */
  action?: React.ReactNode;
  /** Replaces the registration-status line, e.g. with the student's own status in My Events. */
  status?: { heading: string; label: string; className: string };
}

const EventCard: React.FC<EventCardProps> = ({ event, action, status }) => {
  const shown = status ?? { heading: 'Registration', ...registrationStatus(event) };

  return (
    <div className="card flex flex-col group h-full">
      <div className="relative h-48 w-full overflow-hidden bg-gradient-to-br from-indigo-50 to-lavender-50">
        {!event.image && (
          // No photo in the source: a quiet placeholder rather than an unrelated stock image.
          <div className="absolute inset-0 flex items-center justify-center text-indigo-300 font-semibold text-lg" aria-hidden="true">
            {EVENT_KIND_LABEL[event.eventType]}
          </div>
        )}
        {event.image && (
          <img
            src={event.image}
            alt={event.title}
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        )}
        <div className="absolute top-4 left-4 flex gap-2">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-white text-indigo-800 shadow-sm">
            {event.category.name}
          </span>
          {event.isSample && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-900 shadow-sm" title="Fictional sample data">
              Sample
            </span>
          )}
        </div>
      </div>

      <div className="p-5 flex flex-col flex-grow">
        <h3 className="text-lg font-bold text-gray-900 mb-2 line-clamp-2 min-h-[3.5rem]" title={event.title}>{event.title}</h3>

        <div className="space-y-2 mb-4 flex-grow">
          <div className="flex items-center text-sm text-gray-600">
            <Calendar className="w-4 h-4 mr-2 text-indigo-500 shrink-0" />
            <span className="truncate">{eventDateLabel(event)}</span>
          </div>
          <div className="flex items-center text-sm text-gray-600">
            <Clock className="w-4 h-4 mr-2 text-indigo-500 shrink-0" />
            <span className="truncate">{eventTimeLabel(event)}</span>
          </div>
          <div className="flex items-center text-sm text-gray-600">
            <MapPin className="w-4 h-4 mr-2 text-indigo-500 shrink-0" />
            <span className="truncate">{venueLabel(event)}</span>
          </div>
        </div>

        <div className="pt-4 border-t border-gray-100 flex items-center justify-between mt-auto">
          <div className="flex flex-col">
            <span className="text-xs text-gray-500">{shown.heading}</span>
            <span className={`text-sm font-medium ${shown.className}`}>{shown.label}</span>
          </div>

          <Link
            to={`/event/${event.id}`}
            className="inline-flex items-center text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
          >
            View Details
            <ArrowRight className="ml-1 w-4 h-4" />
          </Link>
        </div>
        {action && <div className="pt-4">{action}</div>}
      </div>
    </div>
  );
};

export default EventCard;
