import { Hono } from 'hono';
import { z } from 'zod';
import { endSession, startSession } from '../auth.ts';
import type { User } from '../db/types.ts';
import { ApiError, readJson } from '../http.ts';
import type { AppContext, AppEnv } from '../http.ts';
import { userRoles } from '../lib/rules.ts';

export const toUserDto = (user: User) => ({
  id: user.id,
  universityId: user.university_id,
  name: user.name,
  email: user.email,
  campus: user.campus,
  school: user.school,
  department: user.department,
  programme: user.programme,
  year: user.year,
  semester: user.semester,
  roles: userRoles(user),
});

export const authRoutes = new Hono<AppEnv>();

// Returns { user: null } for visitors rather than 401: not being signed in is a normal state here.
authRoutes.get('/me', c => {
  const user = c.get('user');
  return c.json({ user: user ? toUserDto(user) : null });
});

authRoutes.post('/logout', async c => {
  await endSession(c);
  return c.json({ ok: true });
});

authRoutes.get('/config', c => c.json({ authMode: c.get('deps').config.authMode }));

// ---------------------------------------------------------------------------
// DEVELOPMENT SIGN-IN ONLY. Lets you pick a seeded user instead of going
// through the university's SSO. Disabled unless AUTH_MODE=dev, and the server
// refuses to start with AUTH_MODE=dev in production (see config.ts).
// Real SSO replaces these two routes with an OIDC callback that resolves the
// user and calls startSession().
// ---------------------------------------------------------------------------

const assertDevAuth = (c: AppContext) => {
  if (c.get('deps').config.authMode !== 'dev') {
    throw new ApiError(404, 'not_found', 'Not found.');
  }
};

authRoutes.get('/dev-users', async c => {
  assertDevAuth(c);
  const users = await c
    .get('deps')
    .db.selectFrom('users')
    .selectAll()
    .where('status', '=', 'active')
    // Bulk-generated seed students (used only to fill seats) are hidden from the picker.
    .where('university_id', 'not like', 'GEN%')
    .orderBy('name')
    .execute();
  return c.json({ users: users.map(toUserDto) });
});

authRoutes.post('/dev-login', async c => {
  assertDevAuth(c);
  const { userId } = await readJson(c, z.object({ userId: z.string().min(1) }));
  const user = await c
    .get('deps')
    .db.selectFrom('users')
    .selectAll()
    .where('id', '=', userId)
    .where('status', '=', 'active')
    .executeTakeFirst();
  if (!user) throw new ApiError(404, 'user_not_found', 'No such user.');
  await startSession(c, user);
  return c.json({ user: toUserDto(user) });
});
