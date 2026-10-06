import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Checking = () => (
  <p role="status" className="py-24 text-center text-gray-500">
    Checking your sign-in…
  </p>
);

/** Pages that need a signed-in student send visitors to sign in, then back. */
export const RequireAuth = () => {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Checking />;
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/sign-in?next=${next}`} replace />;
  }
  return <Outlet />;
};

/** Admin-only pages inside the organizer area (approvals, email log). Nested under RequireStaff. */
export const RequireAdmin = () => {
  const { hasRole } = useAuth();
  if (!hasRole('admin')) {
    return (
      <div className="max-w-xl mx-auto py-24 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Administrators only</h1>
        <p className="text-gray-600 mb-6">This page is for university administrators.</p>
        <Link to="/admin" className="btn btn-primary">Back to Organizer</Link>
      </div>
    );
  }
  return <Outlet />;
};

/** Organizer/admin area. The server enforces the same rule on every request. */
export const RequireStaff = () => {
  const { user, loading, isStaff } = useAuth();
  const location = useLocation();
  if (loading) return <Checking />;
  if (!user) return <Navigate to={`/sign-in?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (!isStaff) {
    return (
      <div className="max-w-xl mx-auto py-24 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Organizers only</h1>
        <p className="text-gray-600 mb-6">This area is for event organizers and university administrators.</p>
        <Link to="/" className="btn btn-primary">Back to Home</Link>
      </div>
    );
  }
  return <Outlet />;
};
