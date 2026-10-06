import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Star, MessageSquare, ArrowLeft, CheckCircle2, AlertCircle } from 'lucide-react';
import { useUserEvents } from '../context/UserEventsContext';
import { ApiError } from '../services/api';
import { submitFeedback } from '../services/registrationService';

type Dimension = 'content' | 'speaker' | 'organization' | 'venue' | 'registrationExperience';

/** Rating dimensions from the blueprint (§5 Feedback & analytics). */
const DIMENSIONS: [Dimension, string][] = [
  ['content', 'Content'],
  ['speaker', 'Speakers'],
  ['organization', 'Organization'],
  ['venue', 'Venue'],
  ['registrationExperience', 'Registration experience'],
];

const FeedbackForm = () => {
  const { id: eventId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { registrations, loading, refresh } = useUserEvents();
  // Only an attended registration (checked in at the door) for an event that
  // has ended can be rated; the server enforces the same rule.
  const registration = registrations.find(
    r => r.eventId === eventId && (r.status === 'attended' || r.status === 'checked_in') && r.event.phase === 'completed'
  );

  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<Record<Dimension, number>>({ content: 0, speaker: 0, organization: 0, venue: 0, registrationExperience: 0 });
  const [again, setAgain] = useState<boolean | null>(null);

  if (loading) return <p role="status" className="py-24 text-center text-gray-500">Loading…</p>;

  if (isSubmitted) {
    return (
      <div className="max-w-xl mx-auto py-24 text-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-10 h-10 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Thank you for your feedback!</h2>
        <p className="text-gray-600 mb-6">Your response helps organizers improve future events.</p>
        <Link to="/my-events" className="btn btn-primary">Back to My Events</Link>
      </div>
    );
  }

  if (!registration || registration.hasFeedback) {
    return (
      <div className="max-w-xl mx-auto py-24 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          {registration?.hasFeedback ? "You've already rated this event" : 'Feedback not available'}
        </h1>
        <p className="text-gray-600 mb-6">
          {registration?.hasFeedback
            ? 'Thanks — your feedback has been recorded.'
            : 'You can rate events you checked in at, once they have ended.'}
        </p>
        <Link to="/my-events" className="btn btn-primary">Go to My Events</Link>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const rated = Object.fromEntries(Object.entries(dimensions).filter(([, v]) => v > 0));
      await submitFeedback(registration.id, { rating, comment: feedback.trim(), ...rated, wouldAttendAgain: again ?? undefined });
      await refresh();
      setIsSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Could not submit your feedback. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-12">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="flex items-center text-sm font-medium text-gray-600 hover:text-indigo-600 transition-colors"
      >
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back
      </button>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <div className="text-center mb-8">
          <MessageSquare className="w-12 h-12 text-indigo-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Event Feedback</h1>
          <p className="text-gray-600">How was your experience at <span className="font-semibold text-gray-900">{registration.event.title}</span>?</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">

          <div className="flex flex-col items-center">
            {/* Not a <label>: the rating is a group of buttons, not a single input. */}
            <p id="rating-label" className="text-sm font-medium text-gray-700 mb-4">Overall Rating</p>
            <div className="flex space-x-2" role="group" aria-labelledby="rating-label">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
                  aria-pressed={rating === star}
                  className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 transition-transform hover:scale-110"
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  onClick={() => setRating(star)}
                >
                  <Star
                    className={`w-10 h-10 ${
                      star <= (hoverRating || rating)
                        ? 'fill-yellow-400 text-yellow-400'
                        : 'text-gray-300'
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>

          <fieldset>
            <legend className="text-sm font-medium text-gray-700 mb-3">More detail (optional)</legend>
            <div className="space-y-3">
              {DIMENSIONS.map(([key, label]) => (
                <div key={key} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                  <p id={`dim-${key}`} className="text-sm text-gray-700">{label}</p>
                  <div className="flex gap-1" role="group" aria-labelledby={`dim-${key}`}>
                    {[1, 2, 3, 4, 5].map(star => (
                      <button
                        key={star}
                        type="button"
                        aria-label={`${label}: ${star} star${star > 1 ? 's' : ''}`}
                        aria-pressed={dimensions[key] === star}
                        onClick={() => setDimensions(d => ({ ...d, [key]: d[key] === star ? 0 : star }))}
                        className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      >
                        <Star className={`w-6 h-6 ${star <= dimensions[key] ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`} />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 pt-1">
                <p id="again-label" className="text-sm text-gray-700">Would you attend a similar event again?</p>
                <div className="flex gap-2" role="group" aria-labelledby="again-label">
                  {([['Yes', true], ['No', false]] as const).map(([text, value]) => (
                    <button
                      key={text}
                      type="button"
                      aria-pressed={again === value}
                      onClick={() => setAgain(again === value ? null : value)}
                      className={`px-3 py-1 rounded-full border text-sm ${again === value ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                    >
                      {text}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </fieldset>

          <div>
            <label className="label mb-2" htmlFor="feedback-text">Tell us more about your experience</label>
            <textarea
              id="feedback-text"
              name="feedback"
              rows={4}
              maxLength={2000}
              className="input-field resize-none"
              placeholder="What did you like? What could be improved?"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              required
            ></textarea>
          </div>

          {submitError && (
            <p role="alert" className="text-sm text-red-600 flex items-center">
              <AlertCircle className="w-4 h-4 mr-2 shrink-0" />
              {submitError}
            </p>
          )}

          <button
            type="submit"
            disabled={rating === 0 || isSubmitting}
            className="w-full btn btn-primary py-3 text-base disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Submitting…' : 'Submit Feedback'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default FeedbackForm;
