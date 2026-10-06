import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorStateProps {
  message?: string;
  onRetry: () => void;
}

// Shown when an async fetch (events, notifications, etc.) fails, with a retry
// action so the user can re-trigger the request without reloading the page.
const ErrorState = ({ message = 'Unable to load events. Please try again.', onRetry }: ErrorStateProps) => {
  return (
    <div
      aria-live="polite"
      className="text-center py-16 bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col items-center justify-center"
    >
      <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-4">
        <AlertTriangle className="w-8 h-8 text-red-500" />
      </div>
      <h3 className="text-lg font-medium text-gray-900 mb-1">Something went wrong</h3>
      <p className="text-gray-500 mb-4">{message}</p>
      <button onClick={onRetry} className="btn btn-primary">
        <RefreshCw className="w-4 h-4 mr-2" />
        Retry
      </button>
    </div>
  );
};

export default ErrorState;
