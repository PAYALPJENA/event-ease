import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { User, Mail, BookOpen, Calendar as CalendarIcon, LogOut, Lock, Building2 } from 'lucide-react';
import { CalendarSettings, ContactAndData, InterestsSettings, NotificationSettings } from '../components/ProfileSettings';
import { useAuth } from '../context/AuthContext';
import { useUserEvents } from '../context/UserEventsContext';
import { initials } from '../utils/format';

const Field = ({ id, label, value, icon }: { id: string; label: string; value: string; icon: ReactNode }) => (
  <div>
    <label className="label" htmlFor={id}>{label}</label>
    <div className="relative">
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">{icon}</div>
      <input id={id} type="text" className="input-field pl-10 bg-gray-50" value={value} readOnly />
    </div>
  </div>
);

const StudentProfile = () => {
  const { user, signOut, hasRole } = useAuth();
  const { registrations, savedEventIds } = useUserEvents();
  const navigate = useNavigate();

  const stats = useMemo(() => {
    return [
      { label: 'Upcoming', value: registrations.filter(r => ['confirmed', 'checked_in'].includes(r.status) && r.event.phase !== 'completed').length },
      { label: 'Attended', value: registrations.filter(r => r.status === 'attended').length },
      { label: 'Certificates', value: registrations.filter(r => r.hasCertificate).length },
      { label: 'Feedback given', value: registrations.filter(r => r.hasFeedback).length },
      { label: 'Saved', value: savedEventIds.length },
    ];
  }, [registrations, savedEventIds]);

  if (!user) return null;

  const roleBadge = hasRole('admin') ? 'Administrator' : hasRole('organizer') ? 'Organizer' : 'Student';
  const yearDept = [user.year ? `Year ${user.year}` : null, user.semester ? `Semester ${user.semester}` : null, user.department]
    .filter(Boolean)
    .join(', ');

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Student Profile</h1>
        <p className="text-gray-600">Your university details and EventEase activity.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">

        {/* Left Column: Profile Card */}
        <div className="md:col-span-1 space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden text-center p-6">
            <div className="w-24 h-24 bg-indigo-100 rounded-full mx-auto flex items-center justify-center mb-4 text-3xl font-bold text-indigo-600">
              {initials(user.name)}
            </div>
            <h2 className="text-xl font-bold text-gray-900">{user.name}</h2>
            <p className="text-gray-500 mb-4 break-all">{user.email}</p>
            <div className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
              {roleBadge}
            </div>
          </div>

          <button type="button" onClick={handleSignOut} className="btn btn-secondary w-full text-red-600">
            <LogOut className="w-5 h-5 mr-2" />
            Sign Out
          </button>
        </div>

        {/* Right Column */}
        <div className="md:col-span-2 space-y-6">

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-1">Personal Information</h3>
            <p className="flex items-center text-sm text-gray-600 mb-4">
              <Lock className="w-4 h-4 mr-2 shrink-0 text-gray-500" />
              Managed by the university. Contact the academic office to correct these details.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field id="profile-name" label="Full Name" value={user.name} icon={<User className="h-4 w-4 text-gray-400" />} />
              <Field id="profile-email" label="Email Address" value={user.email} icon={<Mail className="h-4 w-4 text-gray-400" />} />
              <Field id="profile-roll" label="Roll Number" value={user.universityId} icon={<BookOpen className="h-4 w-4 text-gray-400" />} />
              <Field id="profile-year" label="Year & Department" value={yearDept || '—'} icon={<CalendarIcon className="h-4 w-4 text-gray-400" />} />
              <Field id="profile-campus" label="Campus" value={user.campus} icon={<Building2 className="h-4 w-4 text-gray-400" />} />
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">My Activity</h3>
            <dl className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              {stats.map(s => (
                <div key={s.label} className="rounded-xl bg-gray-50 p-4 text-center">
                  <dt className="text-xs font-medium text-gray-600">{s.label}</dt>
                  <dd className="text-2xl font-bold text-gray-900">{s.value}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap gap-4 mt-4 text-sm font-medium">
              <Link to="/my-events" className="text-indigo-600 hover:text-indigo-800">Go to My Events</Link>
              <Link to="/certificates" className="text-indigo-600 hover:text-indigo-800">My Certificates</Link>
            </div>
          </div>

          <InterestsSettings />
          <NotificationSettings />
          <CalendarSettings />
          <ContactAndData />

        </div>
      </div>
    </div>
  );
};

export default StudentProfile;
