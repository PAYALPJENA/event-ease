import type { Channel } from '../db/types.ts';

/**
 * Delivery for external channels (blueprint §7.2, V5 integrations).
 *
 * Messages are queued in `message_outbox` and handed to the sender for their
 * channel by the scheduler. A channel with no sender is switched off: nothing
 * is queued for it (see `externalChannels`).
 *
 * Development uses console senders. To go live, implement `Sender` for:
 *   email     — SMTP (e.g. nodemailer) or an email API
 *   push      — Web Push with the VAPID keys in config (e.g. the `web-push` package)
 *   sms       — an SMS gateway approved by the university
 *   whatsapp  — the WhatsApp Business API
 * Throwing from a sender leaves the message queued for a retry.
 */

export interface OutgoingMessage {
  channel: Channel;
  /** Email address, phone number, or push subscription (JSON) */
  to: string;
  subject: string;
  text: string;
}

export type Sender = (message: OutgoingMessage) => Promise<void>;
export type Senders = Partial<Record<Channel, Sender>>;

/** Development: print one line per message in the API terminal. */
export const consoleSender: Sender = async m => {
  const to = m.channel === 'push' ? `subscription ${m.to.slice(0, 40)}…` : m.to;
  console.log(`[${m.channel}] to=${to} subject="${m.subject}"`);
};

/** Keeps every message in memory. Used by tests. */
export const createMemorySenders = () => {
  const sent: OutgoingMessage[] = [];
  const record: Sender = async m => {
    sent.push(m);
  };
  const senders: Senders = { email: record, push: record, sms: record, whatsapp: record };
  return { senders, sent };
};

export type ChannelMode = 'console' | 'none';

export const createSenders = (modes: Record<Channel, ChannelMode>): Senders => {
  const senders: Senders = {};
  for (const [channel, mode] of Object.entries(modes) as [Channel, ChannelMode][]) {
    if (mode === 'console') senders[channel] = consoleSender;
  }
  return senders;
};
