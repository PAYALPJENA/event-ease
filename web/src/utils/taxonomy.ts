import type { EventKind } from '../types/event';

/** Labels for event types (what kind of happening it is; the category is the subject area). */
export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  workshop: 'Workshop',
  competition: 'Competition',
  talk: 'Talk',
  seminar: 'Seminar',
  conference: 'Conference',
  fest: 'Fest',
  sports: 'Sports',
  cultural: 'Cultural',
  club_activity: 'Club activity',
  community_service: 'Community service',
  wellness: 'Wellness',
  student_development: 'Student development',
  other: 'Other',
};

export const EVENT_KINDS = Object.keys(EVENT_KIND_LABEL) as EventKind[];
