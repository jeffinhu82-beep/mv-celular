import { changePasswordSchema, loginSchema } from '@loja/shared';
import { audit } from '../lib/audit.ts';
import { AppError } from '../lib/errors.ts';
import { hashPassword, verifyPassword } from '../lib/password.ts';
import { createSession, destroySession, SESSION_COOKIE, toSessionUser, verifyCredentials } from '../http/auth.ts';
import { parse } from '../http/parse.ts';
import type { Router } from '../http/router.ts';
import { getStoreSettings } from '../services/settings.ts';

export function authRoutes(r: Router) {
  r.public('GET', '/api/public/store', async (ctx) => {
    const settings = await getStoreSettings(ctx.deps.db);
    return { name: settings.name, logoUrl: settings.logoUrl };
  });

  r.public(
    'POST',
    '/api/auth/login',
    async (ctx) => {
      const input = parse(loginSchema, ctx.body);
      const user = await verifyCredentials(ctx.deps, input.login, input.password, ctx.ip);
      const { token, expiresAt } = await createSession(ctx.deps, user.id, ctx.ip, ctx.req.headers['user-agent'] ?? null);
      await ctx.deps.db.user.update({ where: { id: user.id }, data: { lastLoginAt: ctx.deps.clock.now() } });
      await audit(ctx.deps.db, { userId: user.id, action: 'auth.login', entity: 'User', entityId: user.id, ip: ctx.ip });
      ctx.reply.setCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: ctx.deps.config.cookieSecure,
        path: '/',
        expires: expiresAt,
      });
      ctx.req.sessionUser = toSessionUser(user);
      return { user: toSessionUser(user) };
    },
    { rateLimit: { max: () => r.deps.config.loginRateLimitPerMinute, timeWindow: '1 minute' } },
  );

  r.post(
    '/api/auth/logout',
    'auth',
    async (ctx) => {
      await destroySession(ctx.deps, ctx.req.cookies[SESSION_COOKIE]);
      ctx.reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return { ok: true };
    },
    { allowDuringPasswordChange: true },
  );

  r.get('/api/auth/me', 'auth', (ctx) => ({ user: ctx.user }), { allowDuringPasswordChange: true });

  r.post(
    '/api/auth/change-password',
    'auth',
    async (ctx) => {
      const input = parse(changePasswordSchema, ctx.body);
      const user = await ctx.deps.db.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
      if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
        throw new AppError(400, 'A senha atual está incorreta.', 'INVALID_PASSWORD');
      }
      if (input.currentPassword === input.newPassword) {
        throw new AppError(400, 'A nova senha precisa ser diferente da atual.', 'SAME_PASSWORD');
      }
      await ctx.deps.db.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false },
      });
      await audit(ctx.deps.db, { userId: user.id, action: 'auth.password_changed', entity: 'User', entityId: user.id, ip: ctx.ip });
      return { user: { ...ctx.user, mustChangePassword: false } };
    },
    { allowDuringPasswordChange: true },
  );
}
