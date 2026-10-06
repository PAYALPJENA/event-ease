import type { Transaction } from 'kysely';
import type { AppConfig } from '../config.ts';
import type { DB } from '../db/index.ts';
import type { Channel, Database, NotificationCategory } from '../db/types.ts';
import { newId } from '../lib/ids.ts';

interface NotifyInput {
  category: NotificationCategory;
  title: string;
  body: string;
  link?: string | null;
}

/** Which external channels are live, and the web address for absolute links. */
export interface External {
  appUrl: string;
  sms: boolean;
  whatsapp: boolean;
}

export const externalFrom = (config: Pick<AppConfig, 'appUrl' | 'smsMode' | 'whatsappMode'>): External => ({
  appUrl: config.appUrl,
  sms: config.smsMode !== 'none',
  whatsapp: config.whatsappMode !== 'none',
});

interface NotifyOptions {
  /**
   * Also send on external channels (blueprint §7.2): email and push, plus
   * SMS/WhatsApp where the university has switched them on. Each message goes
   * to the outbox in the same transaction and is delivered by the scheduler.
   */
  external?: External;
}

/** Notification categories students see in their preferences (blueprint §4.10). */
export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  'registrations',
  'reminders',
  'changes',
  'waitlist',
  'announcements',
  'results',
  'certificates',
  'clubs',
  'opportunities',
  'payments',
  'approvals',
];

export const CHANNELS: Channel[] = ['email', 'push', 'sms', 'whatsapp'];

/** Critical updates to registered events (venue/time change, cancellation) can't be switched off (§4.10). */
export const CRITICAL_CATEGORIES: NotificationCategory[] = ['changes'];

/** Without a saved preference: email and push are on; SMS/WhatsApp carry only critical messages. */
export const defaultEnabled = (category: NotificationCategory, channel: Channel) =>
  CRITICAL_CATEGORIES.includes(category) || channel === 'email' || channel === 'push';

const CHUNK = 100;

/**
 * In-app notifications (blueprint §4.10), optionally also sent on external
 * channels according to each student's preferences.
 */
export const notifyUsers = async (
  db: DB | Transaction<Database>,
  userIds: string[],
  input: NotifyInput,
  nowIso: string,
  options: NotifyOptions = {}
) => {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;

  for (let i = 0; i < unique.length; i += CHUNK) {
    const batch = unique.slice(i, i + CHUNK);
    await db
      .insertInto('notifications')
      .values(
        batch.map(userId => ({
          id: newId(),
          user_id: userId,
          category: input.category,
          title: input.title,
          body: input.body,
          link: input.link ?? null,
          created_at: nowIso,
          read_at: null,
        }))
      )
      .execute();

    const ext = options.external;
    if (!ext) continue;

    const [users, prefs, subscriptions] = await Promise.all([
      db.selectFrom('users').select(['id', 'email', 'phone']).where('id', 'in', batch).where('status', '=', 'active').execute(),
      db.selectFrom('notification_prefs').selectAll().where('user_id', 'in', batch).where('category', '=', input.category).execute(),
      db.selectFrom('push_subscriptions').selectAll().where('user_id', 'in', batch).execute(),
    ]);
    const critical = CRITICAL_CATEGORIES.includes(input.category);
    const wants = (userId: string, channel: Channel) => {
      if (critical) return true;
      const row = prefs.find(p => p.user_id === userId && p.channel === channel);
      return row ? row.enabled === 1 : defaultEnabled(input.category, channel);
    };

    const absoluteLink = input.link ? `${ext.appUrl}${input.link}` : null;
    const messages: { channel: Channel; user_id: string; to_address: string; subject: string; body: string }[] = [];
    for (const u of users) {
      if (wants(u.id, 'email')) {
        messages.push({
          channel: 'email',
          user_id: u.id,
          to_address: u.email,
          subject: input.title,
          body: `${input.body}${absoluteLink ? `\n\n${absoluteLink}` : ''}\n\n— EventEase, Centurion University`,
        });
      }
      if (wants(u.id, 'push')) {
        for (const s of subscriptions.filter(x => x.user_id === u.id)) {
          messages.push({
            channel: 'push',
            user_id: u.id,
            to_address: JSON.stringify({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }),
            subject: input.title,
            // The service worker reads this JSON to show the notification (web/public/sw.js).
            body: JSON.stringify({ title: input.title, body: input.body, url: input.link ?? '/' }),
          });
        }
      }
      for (const channel of ['sms', 'whatsapp'] as const) {
        if (ext[channel] && u.phone && wants(u.id, channel)) {
          messages.push({ channel, user_id: u.id, to_address: u.phone, subject: input.title, body: `EventEase: ${input.title}. ${input.body}`.slice(0, 480) });
        }
      }
    }
    if (messages.length === 0) continue;
    await db
      .insertInto('message_outbox')
      .values(
        messages.map(m => ({
          id: newId(),
          ...m,
          created_at: nowIso,
          status: 'pending' as const,
          attempts: 0,
          sent_at: null,
          last_error: null,
        }))
      )
      .execute();
  }
};

export const audit = async (
  db: DB | Transaction<Database>,
  entry: { actorId: string | null; action: string; entityType: string; entityId: string; data?: unknown },
  nowIso: string
) => {
  await db
    .insertInto('audit_log')
    .values({
      id: newId(),
      actor_id: entry.actorId,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      data: entry.data === undefined ? null : JSON.stringify(entry.data),
      created_at: nowIso,
    })
    .execute();
};
