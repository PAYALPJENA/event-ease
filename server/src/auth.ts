import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { DB } from './db/index.ts';
import type { Role, User } from './db/types.ts';
import { ApiError } from './http.ts';
import type { AppContext, AppEnv } from './http.ts';
import { hashToken, newSessionToken } from './lib/ids.ts';
import { userRoles } from './lib/rules.ts';

/**
 * Session handling.
 *
 * Identity is deliberately separated from sessions: whatever proves who the
 * student is (today the development sign-in, later the university's SSO/OIDC
 * callback) only has to resolve a `users` row and call `startSession()`.
 * Nothing else in the app knows or cares how the user signed in.
 */

export const SESSION_COOKIE = 'ee_session';

export const startSession = async (c: AppContext, user: User) => {
  const { db, config, now } = c.get('deps');
  const { token, id } = newSessionToken();
  const created = now();
  const expires = new Date(created.getTime() + config.sessionTtlHours * 3600_000);

  await db
    .insertInto('sessions')
    .values({ id, user_id: user.id, created_at: created.toISOString(), expires_at: expires.toISOString() })
    .execute();

  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: config.secureCookies,
    path: '/',
    expires,
  });
};

export const endSession = async (c: AppContext) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await c.get('deps').db.deleteFrom('sessions').where('id', '=', hashToken(token)).execute();
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
};

const findSessionUser = async (db: DB, token: string, now: Date) => {
  const row = await db
    .selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .selectAll('users')
    .where('sessions.id', '=', hashToken(token))
    .where('sessions.expires_at', '>', now.toISOString())
    .where('users.status', '=', 'active')
    .executeTakeFirst();
  return row ?? null;
};

/** Attaches `user` (or null) to every request. */
export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  const { db, now } = c.get('deps');
  c.set('user', token ? await findSessionUser(db, token, now()) : null);
  await next();
});

/**
 * CSRF protection for cookie-authenticated writes: state-changing requests
 * must come from an allowed origin and carry JSON (which a cross-site HTML
 * form can't send). Combined with SameSite=Lax cookies.
 */
export const csrfMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('origin');
    if (origin && !c.get('deps').config.allowedOrigins.includes(origin)) {
      throw new ApiError(403, 'forbidden_origin', 'Request origin is not allowed.');
    }
    // Cross-site forms can only send urlencoded, multipart or text/plain bodies,
    // and always label them; fetch() does the same for string bodies.
    const contentType = c.req.header('content-type');
    if (contentType && !contentType.includes('application/json')) {
      throw new ApiError(415, 'unsupported_media_type', 'Requests must use Content-Type: application/json.');
    }
  }
  await next();
});

export const requireUser = (c: AppContext): User => {
  const user = c.get('user');
  if (!user) throw new ApiError(401, 'unauthenticated', 'Please sign in.');
  return user;
};

export const hasRole = (user: User, role: Role) => userRoles(user).includes(role);

/** Organizers act only for their own organizations (blueprint §2.1); admins act everywhere. */
export const requireStaff = (c: AppContext): User => {
  const user = requireUser(c);
  if (!hasRole(user, 'admin') && !hasRole(user, 'organizer')) {
    throw new ApiError(403, 'forbidden', 'You do not have access to this area.');
  }
  return user;
};

/** University administrators act institution-wide: approvals, overrides, the email log. */
export const requireAdmin = (c: AppContext): User => {
  const user = requireUser(c);
  if (!hasRole(user, 'admin')) throw new ApiError(403, 'forbidden', 'Only administrators can do this.');
  return user;
};

export const organizationIdsFor = async (db: DB, user: User): Promise<string[] | 'all'> => {
  if (hasRole(user, 'admin')) return 'all';
  const rows = await db
    .selectFrom('organization_members')
    .select('organization_id')
    .where('user_id', '=', user.id)
    .where('role', 'in', ['lead', 'organizer'])
    .execute();
  return rows.map(r => r.organization_id);
};

/** `null` = an event whose organizer isn't specified: only admins manage it. */
export const assertCanManageOrganization = async (db: DB, user: User, organizationId: string | null) => {
  const allowed = await organizationIdsFor(db, user);
  if (allowed !== 'all' && (organizationId === null || !allowed.includes(organizationId))) {
    throw new ApiError(403, 'forbidden', 'You can only manage events for your own organization.');
  }
};

/** Loads an event the current staff member is allowed to manage, or throws. */
export const loadManagedEvent = async (db: DB, user: User, eventId: string) => {
  const event = await db.selectFrom('events').selectAll().where('id', '=', eventId).executeTakeFirst();
  if (!event) throw new ApiError(404, 'event_not_found', 'This event does not exist.');
  await assertCanManageOrganization(db, user, event.organization_id);
  return event;
};
