import fs from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDb, migrateToLatest } from './db/index.ts';
import { createSenders } from './lib/channels.ts';
import { mockGateway } from './services/payments.ts';
import { runScheduledTasks } from './services/scheduler.ts';

const config = loadConfig();
const db = createDb(config.dbPath);
await migrateToLatest(db);

const senders = createSenders({ email: config.mailMode, push: config.pushMode, sms: config.smsMode, whatsapp: config.whatsappMode });
if (config.paymentGateway !== 'mock') {
  throw new Error(`PAYMENT_GATEWAY "${config.paymentGateway}" is not implemented yet: add it in src/services/payments.ts.`);
}
const deps = { db, config, now: () => new Date(), senders, gateway: mockGateway };
const api = createApp(deps);

// When the web app has been built (npm run build), serve it from the same
// origin as the API so one process hosts the whole site (e.g. on Render).
// In development Vite serves the web app instead.
const webDist = path.resolve(import.meta.dirname, '../../web/dist');
const app = new Hono();
app.all('/api/*', c => api.fetch(c.req.raw, c.env));
app.all('/api', c => api.fetch(c.req.raw, c.env));
if (fs.existsSync(path.join(webDist, 'index.html'))) {
  app.use('*', serveStatic({ root: webDist }));
  // Client-side routes (/events/…, /verify/…) all load the single-page app.
  app.get('*', serveStatic({ root: webDist, path: 'index.html' }));
}

// Scheduled work: reminders, attendance at event end, feedback requests,
// email delivery (services/scheduler.ts). Ticks never overlap.
let ticking = false;
const tick = async () => {
  if (ticking) return;
  ticking = true;
  try {
    const r = await runScheduledTasks(deps);
    const busy = Object.entries(r).filter(([, n]) => n > 0);
    if (busy.length) console.log(`[scheduler] ${busy.map(([k, n]) => `${k}=${n}`).join(' ')}`);
  } catch (err) {
    console.error('[scheduler] tick failed', err);
  } finally {
    ticking = false;
  }
};
const schedulerTimer = config.schedulerIntervalSeconds > 0 ? setInterval(tick, config.schedulerIntervalSeconds * 1000) : null;
if (schedulerTimer) void tick();

serve({ fetch: app.fetch, port: config.port }, info => {
  console.log(`EventEase API listening on http://localhost:${info.port}/api (auth: ${config.authMode})`);
  if (config.authMode === 'dev') {
    console.log('  Development sign-in is ON. Never run with AUTH_MODE=dev in production.');
  }
});

const shutdown = async () => {
  if (schedulerTimer) clearInterval(schedulerTimer);
  await db.destroy();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
