import {
  DEFAULT_ROLES,
  PERMISSION_KEYS,
  resetPasswordSchema,
  roleSchema,
  userCreateSchema,
  userUpdateSchema,
} from '@loja/shared';
import { audit } from '../lib/audit.ts';
import type { Deps } from '../deps.ts';
import { badRequest, fieldError, notFound } from '../lib/errors.ts';
import { hashPassword } from '../lib/password.ts';
import { parse, requireUuid } from '../http/parse.ts';
import type { Router } from '../http/router.ts';

const userSelect = {
  id: true,
  name: true,
  login: true,
  email: true,
  roleId: true,
  active: true,
  mustChangePassword: true,
  lastLoginAt: true,
  lockedUntil: true,
  createdAt: true,
  role: { select: { id: true, name: true } },
} as const;

async function ensureEmailFree(db: Deps['db'], email: string, exceptId?: string) {
  const owner = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (owner && owner.id !== exceptId) throw fieldError('email', 'Esse e-mail já está em uso.');
}

export function teamRoutes(r: Router) {
  r.get('/api/users/options', 'auth', async (ctx) => {
    const users = await ctx.deps.db.user.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, role: { select: { name: true, slug: true, permissions: { select: { permissionKey: true } } } } },
    });
    return users.map((user) => ({
      id: user.id,
      name: user.name,
      roleName: user.role.name,
      isTechnician: user.role.permissions.some((item) => item.permissionKey === 'os.quote_edit'),
      canSell: user.role.permissions.some((item) => item.permissionKey === 'sale.create'),
    }));
  });

  r.get('/api/users', 'team.manage', async (ctx) => {
    return ctx.deps.db.user.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }], select: userSelect });
  });

  r.post('/api/users', 'team.manage', async (ctx) => {
    const input = parse(userCreateSchema, ctx.body);
    const role = await ctx.deps.db.role.findUnique({ where: { id: input.roleId } });
    if (!role) throw badRequest('Perfil não encontrado.');
    if (await ctx.deps.db.user.findUnique({ where: { login: input.login } })) throw fieldError('login', 'Esse usuário já está em uso.');
    await ensureEmailFree(ctx.deps.db, input.email);
    const user = await ctx.deps.db.user.create({
      data: {
        name: input.name,
        login: input.login,
        email: input.email,
        roleId: input.roleId,
        passwordHash: await hashPassword(input.temporaryPassword),
        mustChangePassword: true,
      },
      select: userSelect,
    });
    await audit(ctx.deps.db, { userId: ctx.user.id, action: 'user.created', entity: 'User', entityId: user.id, after: user, ip: ctx.ip });
    return user;
  });

  r.put('/api/users/:id', 'team.manage', async (ctx) => {
    const id = requireUuid(ctx.params.id);
    const input = parse(userUpdateSchema, ctx.body);
    const before = await ctx.deps.db.user.findUnique({ where: { id }, select: userSelect });
    if (!before) throw notFound('Usuário não encontrado.');
    if (id === ctx.user.id && input.active === false) throw badRequest('Você não pode desativar o próprio usuário.');
    if (id === ctx.user.id && input.roleId && input.roleId !== before.roleId) {
      throw badRequest('Você não pode trocar o próprio perfil.');
    }
    if (input.email && input.email !== before.email) await ensureEmailFree(ctx.deps.db, input.email, id);
    const user = await ctx.deps.db.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id }, data: input, select: userSelect });
      if (input.active === false) await tx.session.deleteMany({ where: { userId: id } });
      await audit(tx, { userId: ctx.user.id, action: 'user.updated', entity: 'User', entityId: id, before, after: updated, ip: ctx.ip });
      return updated;
    });
    return user;
  });

  r.post('/api/users/:id/reset-password', 'team.manage', async (ctx) => {
    const id = requireUuid(ctx.params.id);
    const input = parse(resetPasswordSchema, ctx.body);
    const user = await ctx.deps.db.user.findUnique({ where: { id } });
    if (!user) throw notFound('Usuário não encontrado.');
    await ctx.deps.db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { passwordHash: await hashPassword(input.temporaryPassword), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null },
      });
      await tx.session.deleteMany({ where: { userId: id } });
      await audit(tx, { userId: ctx.user.id, action: 'user.password_reset', entity: 'User', entityId: id, ip: ctx.ip });
    });
    return { ok: true };
  });

  r.get('/api/roles', 'team.manage', async (ctx) => {
    const roles = await ctx.deps.db.role.findMany({
      orderBy: { createdAt: 'asc' },
      include: { permissions: true, _count: { select: { users: true } } },
    });
    return roles.map((role) => ({
      id: role.id,
      slug: role.slug,
      name: role.name,
      system: role.system,
      discountLimitBps: role.discountLimitBps,
      permissions: role.permissions.map((item) => item.permissionKey),
      userCount: role._count.users,
    }));
  });

  r.post('/api/roles', 'team.manage', async (ctx) => {
    const input = parse(roleSchema, ctx.body);
    const role = await ctx.deps.db.$transaction(async (tx) => {
      const created = await tx.role.create({
        data: {
          name: input.name,
          discountLimitBps: input.discountLimitBps,
          permissions: { create: input.permissions.map((permissionKey) => ({ permissionKey })) },
        },
      });
      await audit(tx, { userId: ctx.user.id, action: 'role.created', entity: 'Role', entityId: created.id, after: input, ip: ctx.ip });
      return created;
    });
    return role;
  });

  r.put('/api/roles/:id', 'team.manage', async (ctx) => {
    const id = requireUuid(ctx.params.id);
    const input = parse(roleSchema, ctx.body);
    const role = await ctx.deps.db.role.findUnique({ where: { id }, include: { permissions: true } });
    if (!role) throw notFound('Perfil não encontrado.');
    const permissions = role.slug === 'admin' ? [...PERMISSION_KEYS] : input.permissions;
    if (role.id === ctx.user.roleId && !permissions.includes('team.manage')) {
      throw badRequest('Você não pode tirar do seu próprio perfil a permissão de gerenciar equipe.');
    }
    const before = { name: role.name, discountLimitBps: role.discountLimitBps, permissions: role.permissions.map((item) => item.permissionKey) };
    await ctx.deps.db.$transaction(async (tx) => {
      await tx.role.update({ where: { id }, data: { name: input.name, discountLimitBps: input.discountLimitBps } });
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.rolePermission.createMany({ data: permissions.map((permissionKey) => ({ roleId: id, permissionKey })) });
      await audit(tx, {
        userId: ctx.user.id,
        action: 'role.permissions_changed',
        entity: 'Role',
        entityId: id,
        before,
        after: { name: input.name, discountLimitBps: input.discountLimitBps, permissions },
        ip: ctx.ip,
      });
    });
    return { ok: true };
  });

  r.delete('/api/roles/:id', 'team.manage', async (ctx) => {
    const id = requireUuid(ctx.params.id);
    const role = await ctx.deps.db.role.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
    if (!role) throw notFound('Perfil não encontrado.');
    if (role.system) throw badRequest('Os perfis padrão não podem ser excluídos.');
    if (role._count.users > 0) throw badRequest('Mova os usuários para outro perfil antes de excluir.');
    await ctx.deps.db.$transaction(async (tx) => {
      await tx.role.delete({ where: { id } });
      await audit(tx, { userId: ctx.user.id, action: 'role.deleted', entity: 'Role', entityId: id, before: { name: role.name }, ip: ctx.ip });
    });
    return { ok: true };
  });

  r.get('/api/roles/defaults', 'team.manage', () => DEFAULT_ROLES);
}
