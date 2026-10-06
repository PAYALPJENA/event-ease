import crypto from 'node:crypto';
import path from 'node:path';
import type { ChannelMode } from './lib/channels.ts';

export interface AppConfig {
  port: number;
  dbPath: string;
  /** 'dev' enables the development sign-in (pick a seeded user). Real SSO replaces it. */
  authMode: 'dev' | 'sso';
  /** Secret used to sign QR pass tokens. Must be set to a long random value outside development. */
  passSecret: string;
  sessionTtlHours: number;
  /** Origins allowed to send state-changing requests (CSRF protection). */
  allowedOrigins: string[];
  secureCookies: boolean;
  /** Public address of the web app, used for links in emails and calendar feeds. */
  appUrl: string;
  /**
   * How each external channel delivers (lib/channels.ts). 'console' prints
   * messages (development). For email and push, 'none' leaves messages queued;
   * SMS and WhatsApp are only used at all when switched on, because they need
   * university approval (blueprint §10 V5).
   */
  mailMode: ChannelMode;
  pushMode: ChannelMode;
  smsMode: ChannelMode;
  whatsappMode: ChannelMode;
  /** Web Push VAPID key pair (base64url). Browsers need the public key to subscribe. */
  vapidPublicKey: string;
  vapidPrivateKey: string;
  /** How often scheduled work (reminders, attendance, delivery, expiries) runs. 0 disables it. */
  schedulerIntervalSeconds: number;
  /** Where uploaded registration documents are stored. */
  uploadsDir: string;
  /** 'mock' = the built-in test gateway. A real gateway (e.g. Razorpay) plugs into services/payments.ts. */
  paymentGateway: string;
  /** Shared secret the gateway signs webhooks with. */
  paymentWebhookSecret: string;
  /** How long a seat is held while the student pays. */
  paymentWindowMinutes: number;
}

const DEV_PASS_SECRET = 'dev-only-pass-secret-change-me';
const DEV_WEBHOOK_SECRET = 'dev-only-webhook-secret';

const channelMode = (env: NodeJS.ProcessEnv, name: string, fallback: ChannelMode): ChannelMode => {
  const value = env[name] ?? fallback;
  if (value !== 'console' && value !== 'none') throw new Error(`${name} must be "console" or "none", got "${value}"`);
  return value;
};

/**
 * A stable development VAPID key pair derived from the pass secret, so push
 * subscriptions survive restarts. Production must set real keys.
 */
const devVapidKeys = (seed: string) => {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(crypto.createHash('sha256').update(`vapid:${seed}`).digest());
  return { publicKey: ecdh.getPublicKey().toString('base64url'), privateKey: ecdh.getPrivateKey().toString('base64url') };
};

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const isProduction = env.NODE_ENV === 'production';
  const authMode = (env.AUTH_MODE ?? (isProduction ? 'sso' : 'dev')) as AppConfig['authMode'];
  const passSecret = env.PASS_SECRET ?? DEV_PASS_SECRET;
  const paymentWebhookSecret = env.PAYMENT_WEBHOOK_SECRET ?? DEV_WEBHOOK_SECRET;

  if (authMode !== 'dev' && authMode !== 'sso') {
    throw new Error(`AUTH_MODE must be "dev" or "sso", got "${authMode}"`);
  }
  if (isProduction && authMode === 'dev') {
    throw new Error('Refusing to start: the development sign-in (AUTH_MODE=dev) cannot run in production.');
  }
  if (isProduction && passSecret === DEV_PASS_SECRET) {
    throw new Error('Refusing to start: set PASS_SECRET to a long random value in production.');
  }
  if (isProduction && paymentWebhookSecret === DEV_WEBHOOK_SECRET) {
    throw new Error('Refusing to start: set PAYMENT_WEBHOOK_SECRET in production.');
  }
  if (isProduction && (env.PAYMENT_GATEWAY ?? 'mock') === 'mock') {
    throw new Error('Refusing to start: the mock payment gateway cannot run in production.');
  }
  if (isProduction && !(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY)) {
    throw new Error('Refusing to start: set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in production.');
  }

  const vapid = env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
    ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
    : devVapidKeys(passSecret);
  const dataDir = path.resolve(import.meta.dirname, '../data');

  return {
    port: Number(env.PORT ?? 3001),
    dbPath: env.DB_PATH ?? path.join(dataDir, 'eventease.db'),
    authMode,
    passSecret,
    sessionTtlHours: Number(env.SESSION_TTL_HOURS ?? 24 * 7),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:4173')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    secureCookies: isProduction,
    appUrl: (env.APP_URL ?? 'http://localhost:5173').replace(/\/+$/, ''),
    mailMode: channelMode(env, 'MAIL_MODE', 'console'),
    pushMode: channelMode(env, 'PUSH_MODE', 'console'),
    smsMode: channelMode(env, 'SMS_MODE', 'none'),
    whatsappMode: channelMode(env, 'WHATSAPP_MODE', 'none'),
    vapidPublicKey: vapid.publicKey,
    vapidPrivateKey: vapid.privateKey,
    schedulerIntervalSeconds: Number(env.SCHEDULER_INTERVAL_SECONDS ?? 60),
    uploadsDir: env.UPLOADS_DIR ?? path.join(dataDir, 'uploads'),
    paymentGateway: env.PAYMENT_GATEWAY ?? 'mock',
    paymentWebhookSecret,
    paymentWindowMinutes: Number(env.PAYMENT_WINDOW_MINUTES ?? 30),
  };
};
