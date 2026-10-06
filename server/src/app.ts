import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { csrfMiddleware, sessionMiddleware } from './auth.ts';
import { ApiError } from './http.ts';
import type { AppDeps, AppEnv } from './http.ts';
import { adminRoutes } from './routes/admin.ts';
import { authRoutes } from './routes/auth.ts';
import { eventRoutes } from './routes/events.ts';
import { meRoutes } from './routes/me.ts';
import { operationsRoutes } from './routes/operations.ts';
import { checkInRoutes } from './routes/checkin.ts';
import { publicRoutes } from './routes/public.ts';

export const createApp = (deps: AppDeps) => {
  const app = new Hono<AppEnv>().basePath('/api');

  app.use('*', secureHeaders());
  app.use('*', async (c, next) => {
    c.set('deps', deps);
    await next();
  });
  app.use('*', csrfMiddleware);
  app.use('*', sessionMiddleware);

  app.get('/health', c => c.json({ ok: true }));
  app.route('/auth', authRoutes);
  app.route('/', eventRoutes);
  app.route('/me', meRoutes);
  app.route('/admin', adminRoutes);
  app.route('/admin', operationsRoutes);
  app.route('/check-in', checkInRoutes);
  app.route('/', publicRoutes);

  app.notFound(c => c.json({ error: { code: 'not_found', message: 'Not found.' } }, 404));
  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status);
    }
    console.error(err);
    return c.json({ error: { code: 'internal_error', message: 'Something went wrong. Please try again.' } }, 500);
  });

  return app;
};
