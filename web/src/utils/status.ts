import type { EventType, RegistrationStatus } from '../types/event';

/**
 * Registration status label for an event card or panel. Colours are the
 * WCAG-AA pairs from the prototype's contrast fixes (green-700 / red-600 on white).
 */
export const registrationStatus = (event: EventType): { label: string; className: string } => {
  if (event.status === 'cancelled') return { label: 'Cancelled', className: 'text-red-600' };
  if (event.phase === 'completed') return { label: 'Event ended', className: 'text-gray-600' };
  switch (event.availability) {
    case 'open':
      return { label: 'Open', className: 'text-green-700' };
    case 'closing_soon':
      return { label: 'Closing soon', className: 'text-amber-700' };
    case 'full':
      return { label: 'Full', className: 'text-red-600' };
    case 'not_open':
      return { label: 'Opens soon', className: 'text-indigo-700' };
    case 'no_registration':
      return event.registrationMode === 'not_required'
        ? { label: 'No registration needed', className: 'text-gray-700' }
        : { label: 'Not specified', className: 'text-gray-600' };
    default:
      return { label: 'Closed', className: 'text-red-600' };
  }
};

/** Staff-facing badge for an event's workflow state (blueprint §3.3). */
export const eventStatusBadge = (event: Pick<EventType, 'status' | 'phase'>): { label: string; className: string } => {
  switch (event.status) {
    case 'draft':
      return { label: 'Draft', className: 'bg-gray-100 text-gray-800' };
    case 'pending_approval':
      return { label: 'Awaiting approval', className: 'bg-amber-100 text-amber-900' };
    case 'changes_requested':
      return { label: 'Changes requested', className: 'bg-orange-100 text-orange-900' };
    case 'rejected':
      return { label: 'Not approved', className: 'bg-red-100 text-red-800' };
    case 'cancelled':
      return { label: 'Cancelled', className: 'bg-red-100 text-red-800' };
    default:
      if (event.phase === 'completed') return { label: 'Ended', className: 'bg-gray-100 text-gray-700' };
      if (event.phase === 'ongoing') return { label: 'Happening now', className: 'bg-indigo-100 text-indigo-800' };
      return { label: 'Published', className: 'bg-green-100 text-green-800' };
  }
};

/** A registration's state in words, with a WCAG-AA text colour on white. */
export const registrationStatusLabel = (status: RegistrationStatus): { label: string; className: string } => {
  switch (status) {
    case 'confirmed':
      return { label: 'Confirmed', className: 'text-green-700' };
    case 'checked_in':
      return { label: 'Checked in', className: 'text-indigo-700' };
    case 'attended':
      return { label: 'Attended', className: 'text-green-700' };
    case 'no_show':
      return { label: 'Absent', className: 'text-amber-700' };
    case 'pending_payment':
      return { label: 'Payment pending', className: 'text-amber-700' };
    case 'pending_documents':
      return { label: 'Documents pending', className: 'text-amber-700' };
    case 'waitlisted':
      return { label: 'Waitlisted', className: 'text-amber-700' };
    case 'offer_pending':
      return { label: 'Seat offered', className: 'text-indigo-700' };
    case 'waitlist_expired':
      return { label: 'Offer expired', className: 'text-gray-600' };
    default:
      return { label: 'Cancelled', className: 'text-red-600' };
  }
};
