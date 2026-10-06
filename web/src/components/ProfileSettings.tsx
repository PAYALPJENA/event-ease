import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Bell, CalendarPlus, Copy, Download, Heart, Phone } from 'lucide-react';
import { ApiError, api } from '../services/api';
import {
  createCalendarFeed,
  fetchCalendarFeed,
  fetchCategories,
  fetchNotificationPreferences,
  fetchPreferences,
  revokeCalendarFeed,
  saveContact,
  saveNotificationPreference,
  savePreferences,
} from '../services/studentService';
import type { Channel, NotificationPreferences } from '../services/studentService';
import type { NotificationCategory } from '../types/event';
import { downloadFile } from '../utils/eventActions';
import { currentPushSubscription, disablePush, enablePush, pushSupported } from '../utils/push';

/** Profile → Settings (blueprint §4.14): interests, notifications, calendar, contact, data. */

const Card = ({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) => (
  <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
    <h3 className="flex items-center text-lg font-bold text-gray-900">
      {icon}
      {title}
    </h3>
    {children}
  </section>
);

const Status = ({ text }: { text: string | null }) => <p role="status" className="text-sm text-gray-700 [&:empty]:hidden">{text}</p>;

// ---------- Interests (blueprint §4.1, §7.5) ----------

export const InterestsSettings = () => {
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [interests, setInterests] = useState<string[]>([]);
  const [personalization, setPersonalization] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchCategories(), fetchPreferences()])
      .then(([cats, prefs]) => {
        setCategories(cats);
        setInterests(prefs.interests);
        setPersonalization(prefs.personalizationEnabled);
      })
      .catch(() => setMessage('Unable to load your interests.'));
  }, []);

  const save = async (next: { interests: string[]; personalizationEnabled: boolean }) => {
    setInterests(next.interests);
    setPersonalization(next.personalizationEnabled);
    try {
      await savePreferences(next);
      setMessage('Saved.');
    } catch {
      setMessage('Could not save. Please try again.');
    }
  };

  return (
    <Card title="Interests & recommendations" icon={<Heart className="w-5 h-5 mr-2 text-indigo-600" />}>
      <p className="text-sm text-gray-600">Pick what you like. Home suggests events from these, the clubs you follow and what students in your year sign up for — always with the reason.</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Interests">
        {categories.map(c => {
          const on = interests.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              onClick={() => save({ interests: on ? interests.filter(i => i !== c.id) : [...interests, c.id], personalizationEnabled: personalization })}
              className={`px-3 py-1.5 rounded-full border text-sm ${on ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
            >
              {c.name}
            </button>
          );
        })}
      </div>
      <label className="inline-flex items-center text-sm text-gray-800 cursor-pointer">
        <input type="checkbox" checked={personalization} onChange={e => save({ interests, personalizationEnabled: e.target.checked })} className="mr-2 h-4 w-4 rounded border-gray-300 text-indigo-600" />
        Show personalized recommendations
      </label>
      <Status text={message} />
    </Card>
  );
};

// ---------- Notifications (blueprint §4.10) ----------

const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  registrations: 'Registrations',
  reminders: 'Reminders',
  changes: 'Changes & cancellations',
  waitlist: 'Waitlist offers',
  announcements: 'Announcements',
  results: 'Results',
  certificates: 'Certificates',
  clubs: 'Clubs you follow',
  opportunities: 'Opportunities',
  payments: 'Payments & refunds',
  approvals: 'Event approvals (organizers)',
};
const CHANNEL_LABEL: Record<Channel, string> = { email: 'Email', push: 'Push', sms: 'SMS', whatsapp: 'WhatsApp' };

export const NotificationSettings = () => {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [pushOn, setPushOn] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchNotificationPreferences().then(setPrefs).catch(() => setMessage('Unable to load your notification settings.'));
    currentPushSubscription().then(sub => setPushOn(!!sub)).catch(() => undefined);
  }, []);

  const toggle = async (category: NotificationCategory, channel: Channel, enabled: boolean) => {
    setPrefs(p => p && { ...p, categories: p.categories.map(c => (c.category === category ? { ...c, channels: { ...c.channels, [channel]: enabled } } : c)) });
    try {
      await saveNotificationPreference(category, channel, enabled);
    } catch {
      setMessage('Could not save. Please try again.');
    }
  };

  const togglePush = async () => {
    setMessage(null);
    try {
      if (pushOn) await disablePush();
      else await enablePush();
      setPushOn(!pushOn);
      setMessage(pushOn ? 'Push notifications are off on this device.' : 'Push notifications are on for this device.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not change push notifications.');
    }
  };

  return (
    <Card title="Notifications" icon={<Bell className="w-5 h-5 mr-2 text-indigo-600" />}>
      <p className="text-sm text-gray-600">In-app notifications are always on. Choose where else each kind reaches you. Changes to events you're registered for are always sent.</p>
      {pushSupported() && (
        <button type="button" onClick={togglePush} className="btn btn-secondary">
          {pushOn ? 'Turn off push on this device' : 'Turn on push on this device'}
        </button>
      )}
      {prefs && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <caption className="sr-only">Notification channels per category</caption>
            <thead>
              <tr className="text-left text-gray-600">
                <th scope="col" className="py-2 pr-4 font-medium">Category</th>
                {prefs.channels.map(ch => <th key={ch} scope="col" className="py-2 px-2 font-medium text-center">{CHANNEL_LABEL[ch]}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {prefs.categories.map(row => (
                <tr key={row.category}>
                  <th scope="row" className="py-2 pr-4 font-normal text-gray-800 text-left">
                    {CATEGORY_LABEL[row.category]}
                    {row.critical && <span className="block text-xs text-gray-500">Always on</span>}
                  </th>
                  {prefs.channels.map(ch => (
                    <td key={ch} className="py-2 px-2 text-center">
                      <input
                        type="checkbox"
                        aria-label={`${CATEGORY_LABEL[row.category]} by ${CHANNEL_LABEL[ch]}`}
                        checked={!!row.channels[ch]}
                        disabled={row.critical}
                        onChange={e => toggle(row.category, ch, e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 disabled:opacity-60"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Status text={message} />
    </Card>
  );
};

// ---------- Calendar subscription (blueprint §4.8) ----------

export const CalendarSettings = () => {
  const [active, setActive] = useState(false);
  const [urls, setUrls] = useState<{ url: string; webcalUrl: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchCalendarFeed().then(f => setActive(f.active)).catch(() => undefined);
  }, []);

  const create = async () => {
    try {
      setUrls(await createCalendarFeed());
      setActive(true);
      setMessage(active ? 'New link created. The old one no longer works.' : null);
    } catch {
      setMessage('Could not create the link.');
    }
  };

  return (
    <Card title="Calendar sync" icon={<CalendarPlus className="w-5 h-5 mr-2 text-indigo-600" />}>
      <p className="text-sm text-gray-600">Subscribe from Google Calendar or Outlook and your registered events stay up to date there, including time and venue changes. Keep the link private.</p>
      {urls ? (
        <div className="space-y-2 text-sm">
          <a href={urls.webcalUrl} className="btn btn-primary">Open in calendar app</a>
          <div className="flex items-center gap-2">
            <label htmlFor="feed-url" className="sr-only">Subscription link</label>
            <input id="feed-url" readOnly value={urls.url} className="input-field font-mono text-xs" onFocus={e => e.currentTarget.select()} />
            <button type="button" className="btn btn-secondary" onClick={() => navigator.clipboard.writeText(urls.url).then(() => setMessage('Link copied.')).catch(() => undefined)}>
              <Copy className="w-4 h-4" />
              <span className="sr-only">Copy link</span>
            </button>
          </div>
          <p className="text-xs text-gray-500">In Google Calendar: Other calendars → + → From URL, and paste the link. This link is shown once.</p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={create} className={urls ? 'btn btn-secondary' : 'btn btn-primary'}>
          {active ? 'Create a new link' : 'Create subscription link'}
        </button>
        {active && (
          <button
            type="button"
            className="btn btn-secondary text-red-600"
            onClick={async () => {
              await revokeCalendarFeed();
              setActive(false);
              setUrls(null);
              setMessage('Calendar link turned off.');
            }}
          >
            Turn off
          </button>
        )}
      </div>
      <Status text={message} />
    </Card>
  );
};

// ---------- Contact and data (blueprint §4.1, §9.2) ----------

export const ContactAndData = () => {
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await saveContact(phone.trim() || null);
      setMessage('Phone number saved.');
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Could not save.');
    }
  };

  const exportData = async () => {
    try {
      const data = await api<unknown>('/me/export');
      downloadFile('eventease-my-data.json', JSON.stringify(data, null, 2), 'application/json');
    } catch {
      setMessage('Could not export your data.');
    }
  };

  return (
    <Card title="Contact & your data" icon={<Phone className="w-5 h-5 mr-2 text-indigo-600" />}>
      <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2 sm:items-end">
        <div className="flex-1">
          <label htmlFor="contact-phone" className="label">Mobile number (for SMS updates, if the university enables them)</label>
          <input id="contact-phone" type="tel" className="input-field" placeholder="+91 98765 43210" value={phone} onChange={e => setPhone(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-secondary">Save</button>
      </form>
      <div>
        <button type="button" onClick={exportData} className="btn btn-secondary">
          <Download className="w-4 h-4 mr-2" />
          Download my data
        </button>
        <p className="text-xs text-gray-500 mt-1">Everything EventEase stores about you, as a JSON file. To correct university details or ask for deletion, contact the Student Affairs Office.</p>
      </div>
      <Status text={message} />
    </Card>
  );
};
