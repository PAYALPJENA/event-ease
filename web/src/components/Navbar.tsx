import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Calendar, Compass, Home, User, Bell, Menu, X, LayoutDashboard, LogOut, LogIn, Users, Briefcase } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { fetchNotifications, markAllNotificationsRead } from '../services/notificationService';
import type { NotificationType } from '../services/notificationService';
import { formatDateTime, initials } from '../utils/format';

const Navbar = () => {
  const { user, isStaff, signOut } = useAuth();
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<NotificationType[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState(false);
  const location = useLocation();

  const loadNotifications = useCallback(async () => {
    setNotificationsLoading(true);
    setNotificationsError(false);
    try {
      const data = await fetchNotifications();
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch {
      setNotificationsError(true);
    } finally {
      setNotificationsLoading(false);
    }
  }, []);

  // Load once when someone signs in (for the unread dot), and again each time
  // the dropdown opens so it shows anything new.
  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setUnreadCount(0);
      setShowNotifications(false);
      return;
    }
    void loadNotifications();
  }, [user, loadNotifications]);

  const toggleNotifications = () => {
    const opening = !showNotifications;
    setShowNotifications(opening);
    if (opening) void loadNotifications();
  };

  const markAllRead = async () => {
    try {
      await markAllNotificationsRead();
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      setNotificationsError(true);
    }
  };

  const handleSignOut = async () => {
    setIsMobileMenuOpen(false);
    await signOut();
    navigate('/');
  };

  const navLinks = [
    { name: 'Home', path: '/', icon: <Home className="w-4 h-4 mr-2" /> },
    { name: 'Explore Events', path: '/explore', icon: <Compass className="w-4 h-4 mr-2" /> },
    { name: 'Calendar', path: '/calendar', icon: <Calendar className="w-4 h-4 mr-2" /> },
    { name: 'Clubs', path: '/clubs', icon: <Users className="w-4 h-4 mr-2" /> },
    { name: 'Opportunities', path: '/opportunities', icon: <Briefcase className="w-4 h-4 mr-2" /> },
    { name: 'My Events', path: '/my-events', icon: <User className="w-4 h-4 mr-2" /> },
    ...(isStaff ? [{ name: 'Organizer', path: '/admin', icon: <LayoutDashboard className="w-4 h-4 mr-2" /> }] : []),
  ];

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname === path || location.pathname.startsWith(`${path}/`);

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          {/* Logo and Desktop Nav */}
          <div className="flex items-center">
            <Link to="/" className="flex-shrink-0 flex items-center">
              <span className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-lavender-600">
                EventEase
              </span>
            </Link>
            <div className="hidden md:ml-8 md:flex md:space-x-2 lg:space-x-4">
              {navLinks.map((link) => (
                <Link
                  key={link.name}
                  to={link.path}
                  className={`inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                    isActive(link.path)
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  {link.icon}
                  {link.name}
                </Link>
              ))}
            </div>
          </div>

          {/* Right side actions */}
          <div className="hidden md:ml-6 md:flex md:items-center space-x-3">
            {user ? (
              <>
                {/* Notifications */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={toggleNotifications}
                    aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
                    aria-expanded={showNotifications}
                    aria-controls="notifications-panel"
                    className="p-2 rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 transition-colors relative"
                  >
                    <Bell className="w-5 h-5" />
                    {unreadCount > 0 && (
                      <span className="absolute top-1.5 right-1.5 block h-2 w-2 rounded-full bg-red-500 ring-2 ring-white"></span>
                    )}
                  </button>

                  {showNotifications && (
                    <div id="notifications-panel" className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-lg border border-gray-100 py-2 z-50">
                      <div className="px-4 py-2 border-b border-gray-100 flex justify-between items-center">
                        <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
                        {unreadCount > 0 && (
                          <button
                            type="button"
                            className="text-xs text-indigo-600 hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                            onClick={markAllRead}
                          >
                            Mark all read
                          </button>
                        )}
                      </div>
                      <div className="max-h-80 overflow-y-auto">
                        {notificationsLoading && notifications.length === 0 && (
                          <p role="status" className="px-4 py-4 text-sm text-gray-500">Loading notifications...</p>
                        )}
                        {notificationsError && (
                          <div aria-live="polite" className="px-4 py-4 text-sm text-gray-500">
                            <p className="mb-2">Unable to load notifications.</p>
                            <button type="button" className="text-indigo-600 font-medium hover:underline" onClick={loadNotifications}>
                              Retry
                            </button>
                          </div>
                        )}
                        {!notificationsLoading && !notificationsError && notifications.length === 0 && (
                          <p className="px-4 py-4 text-sm text-gray-500">You're all caught up.</p>
                        )}
                        {!notificationsError && notifications.map(notification => {
                          const content = (
                            <>
                              <p className={`text-sm text-gray-900 ${notification.read ? 'font-normal' : 'font-semibold'}`}>
                                {!notification.read && <span className="sr-only">Unread: </span>}
                                {notification.title}
                              </p>
                              <p className="text-xs text-gray-600 mt-1">{notification.body}</p>
                              <p className="text-xs text-gray-500 mt-1">{formatDateTime(notification.createdAt)}</p>
                            </>
                          );
                          return notification.link ? (
                            <Link
                              key={notification.id}
                              to={notification.link}
                              onClick={() => setShowNotifications(false)}
                              className="block px-4 py-3 hover:bg-gray-50 focus:outline-none focus-visible:bg-indigo-50"
                            >
                              {content}
                            </Link>
                          ) : (
                            <div key={notification.id} className="px-4 py-3">{content}</div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Profile Link */}
                <Link
                  to="/profile"
                  title={user.name}
                  className="flex items-center space-x-2 p-1.5 rounded-full hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-200"
                >
                  <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-sm">
                    {initials(user.name)}
                  </div>
                </Link>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="text-sm font-medium text-gray-600 hover:text-gray-900 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  Sign out
                </button>
              </>
            ) : (
              <Link to="/sign-in" className="btn btn-primary">
                <LogIn className="w-4 h-4 mr-2" />
                Sign in
              </Link>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="flex items-center md:hidden space-x-2">
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label="Toggle menu"
              aria-expanded={isMobileMenuOpen}
              aria-controls="mobile-menu"
              className="inline-flex items-center justify-center p-2 rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div id="mobile-menu" className="md:hidden border-t border-gray-200">
          <div className="px-2 pt-2 pb-3 space-y-1">
            {navLinks.map((link) => (
              <Link
                key={link.name}
                to={link.path}
                onClick={() => setIsMobileMenuOpen(false)}
                className={`flex items-center px-3 py-2 rounded-md text-base font-medium ${
                  isActive(link.path)
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                {link.icon}
                {link.name}
              </Link>
            ))}
            {user ? (
              <>
                <Link
                  to="/profile"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center px-3 py-2 rounded-md text-base font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                >
                  <User className="w-4 h-4 mr-2" />
                  Student Profile
                </Link>
                <Link to="/certificates" onClick={() => setIsMobileMenuOpen(false)} className="flex items-center px-3 py-2 rounded-md text-base font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900">
                  Certificates
                </Link>
                <Link to="/volunteering" onClick={() => setIsMobileMenuOpen(false)} className="flex items-center px-3 py-2 rounded-md text-base font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900">
                  Volunteering
                </Link>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="w-full flex items-center px-3 py-2 rounded-md text-base font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign out
                </button>
              </>
            ) : (
              <Link
                to="/sign-in"
                onClick={() => setIsMobileMenuOpen(false)}
                className="flex items-center px-3 py-2 rounded-md text-base font-medium text-indigo-700 hover:bg-indigo-50"
              >
                <LogIn className="w-4 h-4 mr-2" />
                Sign in
              </Link>
            )}
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
