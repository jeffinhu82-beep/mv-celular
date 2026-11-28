import { isPermissionKey, type PermissionKey, type SessionUser } from '@loja/shared';
import type { Deps } from '../deps.ts';
import { AppError, forbidden } from '../lib/errors.ts';
import { randomToken, sha256 } from '../lib/crypto.ts';
import { verifyPassword } from '../lib/password.ts';
import { audit } from '../lib/audit.ts';

export const SESSION_COOKIE = 'sid';

const userInclude = { role: { include: { permissions: true } } } as const;

type UserWithRole = NonNullable<Awaited<ReturnType<typeof findUserWithRole>>>;

function findUserWithRole(deps: Deps, where: { id: string } | { login: string } | { email: string }) {
  return deps.db.user.findUnique({ where, include: userInclude });
}

export function toSessionUser(user: UserWithRole): SessionUser {
  return {
    id: user.id,
    name: user.name,
    login: user.login,
    email: user.email,
    roleId: user.roleId,
    roleName: user.role.name,
    discountLimitBps: user.role.discountLimitBps,
    permissions: user.role.permissions.map((item) => item.permissionKey).filter(isPermissionKey),
    mustChangePassword: user.mustChangePassword,
  };
}

export async function verifyCredentials(deps: Deps, login: string, password: string, ip: string | null) {
  const now = deps.clock.now();
  const identifier = login.trim().toLowerCase();
  const byEmail = identifier.includes('@');
  const user = await findUserWithRole(deps, byEmail ? { email: identifier } : { login: identifier });
  const invalid = new AppError(401, byEmail ? 'E-mail ou senha incorretos.' : 'Usuário ou senha incorretos.', 'INVALID_CREDENTIALS');
  if (!user || !user.active) {
    await verifyPassword('$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA', password);
    throw invalid;
  }
  if (user.lockedUntil && user.lockedUntil > now) {
    throw new AppError(423, 'Muitas tentativas. Tente de novo em alguns minutos.', 'LOCKED');
  }
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= deps.config.maxFailedLogins;
    await deps.db.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: lock ? 0 : failed,
        lockedUntil: lock ? new Date(now.getTime() + deps.config.lockMinutes * 60000) : user.lockedUntil,
      },
    });
    await audit(deps.db, { userId: user.id, action: lock ? 'auth.locked' : 'auth.login_failed', entity: 'User', entityId: user.id, ip });
    throw lock ? new AppError(423, 'Muitas tentativas. Tente de novo em alguns minutos.', 'LOCKED') : invalid;
  }
  if (user.failedLoginCount > 0 || user.lockedUntil) {
    await deps.db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
  }
  return user;
}

export async function createSession(deps: Deps, userId: string, ip: string | null, userAgent: string | null) {
  const token = randomToken();
  const now = deps.clock.now();
  const expiresAt = new Date(now.getTime() + deps.config.sessionTtlHours * 3600000);
  await deps.db.session.create({
    data: { id: sha256(token), userId, expiresAt, lastSeenAt: now, ip, userAgent: userAgent?.slice(0, 300) ?? null },
  });
  return { token, expiresAt };
}

export async function resolveSession(deps: Deps, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const id = sha256(token);
  const session = await deps.db.session.findUnique({ where: { id }, include: { user: { include: userInclude } } });
  const now = deps.clock.now();
  if (!session || session.expiresAt <= now || !session.user.active) {
    if (session) await deps.db.session.delete({ where: { id } }).catch(() => undefined);
    return null;
  }
  if (now.getTime() - session.lastSeenAt.getTime() > 5 * 60000) {
    await deps.db.session.update({
      where: { id },
      data: { lastSeenAt: now, expiresAt: new Date(now.getTime() + deps.config.sessionTtlHours * 3600000) },
    });
  }
  return toSessionUser(session.user);
}

export async function destroySession(deps: Deps, token: string | undefined): Promise<void> {
  if (!token) return;
  await deps.db.session.deleteMany({ where: { id: sha256(token) } });
}

export interface Approver {
  id: string;
  name: string;
}

export async function verifyApprover(
  deps: Deps,
  credentials: { login: string; password: string },
  key: PermissionKey,
  ip: string | null,
): Promise<Approver> {
  let user: UserWithRole;
  try {
    user = await verifyCredentials(deps, credentials.login, credentials.password, ip);
  } catch (error) {
    if (error instanceof AppError && error.code === 'LOCKED') throw error;
    throw new AppError(403, 'Login ou senha de quem autoriza incorretos.', 'APPROVAL_INVALID', { permission: key });
  }
  const sessionUser = toSessionUser(user);
  if (!sessionUser.permissions.includes(key)) {
    throw new AppError(403, `${user.name} não tem permissão para autorizar esta ação.`, 'APPROVAL_INVALID', {
      permission: key,
    });
  }
  return { id: user.id, name: user.name };
}

export function approvalRequired(key: PermissionKey, message?: string) {
  return new AppError(403, message ?? 'Esta ação precisa de autorização.', 'APPROVAL_REQUIRED', {
    permission: key,
  });
}

export { forbidden };
