import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, FlaskConical } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../services/api';
import type { CurrentUser } from '../types/event';
import { initials } from '../utils/format';

/** Only allow redirects back into this app (no open redirects). */
const safeNext = (value: string | null) => (value && value.startsWith('/') && !value.startsWith('//') ? value : '/');

const roleLabel = (user: CurrentUser) => {
  if (user.roles.includes('admin')) return 'Administrator';
  if (user.roles.includes('organizer')) return user.roles.includes('student') ? 'Student · Organizer' : 'Organizer';
  return 'Student';
};

/**
 * Sign-in page. Until CUTM's single sign-on is connected, the API runs in
 * development mode and this page lets you pick one of the sample accounts.
 */
const SignIn = () => {
  const { user, devSignIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));

  const [authMode, setAuthMode] = useState<'dev' | 'sso' | null>(null);
  const [devUsers, setDevUsers] = useState<CurrentUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    api<{ authMode: 'dev' | 'sso' }>('/auth/config')
      .then(async ({ authMode }) => {
        setAuthMode(authMode);
        if (authMode === 'dev') setDevUsers((await api<{ users: CurrentUser[] }>('/auth/dev-users')).users);
      })
      .catch(() => setError("Can't reach the EventEase server. Is the API running?"));
  }, []);

  if (user) return <Navigate to={next} replace />;

  const signIn = async (userId: string) => {
    setBusyId(userId);
    setError(null);
    try {
      await devSignIn(userId);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed. Please try again.');
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-xl mx-auto py-10 space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Sign in to EventEase</h1>
        <p className="text-gray-600">Welcome to your campus.</p>
      </div>

      {error && (
        <p role="alert" className="flex items-center justify-center text-sm text-red-600">
          <AlertCircle className="w-4 h-4 mr-2 shrink-0" />
          {error}
        </p>
      )}

      {authMode === null && !error && <p role="status" className="text-center text-gray-500">Loading…</p>}

      {authMode === 'sso' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
          <p className="text-gray-700">
            University single sign-on isn't connected yet. Ask the EventEase administrators to finish the SSO setup.
          </p>
        </div>
      )}

      {authMode === 'dev' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="bg-amber-50 border-b border-amber-200 px-6 py-4 flex items-start gap-3">
            <FlaskConical className="w-5 h-5 text-amber-700 mt-0.5 shrink-0" />
            <div className="text-sm text-amber-900">
              <p className="font-semibold">Development sign-in</p>
              <p>
                Choose a sample account. In production this page is replaced by "Continue with CUTM account" (university
                single sign-on), and this option is switched off.
              </p>
            </div>
          </div>
          <ul className="divide-y divide-gray-100">
            {devUsers.map(u => (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => signIn(u.id)}
                  disabled={busyId !== null}
                  className="w-full flex items-center gap-4 px-6 py-4 text-left hover:bg-gray-50 focus:outline-none focus-visible:bg-indigo-50 disabled:opacity-60 transition-colors"
                >
                  <span className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm shrink-0">
                    {initials(u.name)}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium text-gray-900">{u.name}</span>
                    <span className="block text-sm text-gray-600 truncate">
                      {roleLabel(u)}
                      {u.department ? ` · ${u.department}` : ''}
                      {u.year ? ` · Year ${u.year}` : ''}
                    </span>
                  </span>
                  <span className="text-sm font-medium text-indigo-600">{busyId === u.id ? 'Signing in…' : 'Sign in'}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default SignIn;
