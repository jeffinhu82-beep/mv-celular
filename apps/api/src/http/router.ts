import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { approvalSchema, can, type PermissionKey, type SessionUser } from '@loja/shared';
import type { Deps } from '../deps.ts';
import { AppError, forbidden, unauthorized } from '../lib/errors.ts';
import { approvalRequired, verifyApprover, type Approver } from './auth.ts';
import { clientIp } from './client-ip.ts';

export type Access = 'public' | 'auth' | PermissionKey | PermissionKey[];
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RouteInfo {
  method: HttpMethod;
  url: string;
  access: Access;
  approvable: boolean;
}

export interface RouteOptions {
  approvable?: boolean;
  allowDuringPasswordChange?: boolean;
}

export interface Ctx {
  req: FastifyRequest;
  reply: FastifyReply;
  deps: Deps;
  user: SessionUser;
  body: unknown;
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  ip: string;
  approver: Approver | null;
  can(key: PermissionKey): boolean;
  approve(key: PermissionKey, message?: string): Promise<Approver | null>;
}

export interface PublicCtx extends Omit<Ctx, 'user' | 'can' | 'approve' | 'approver'> {
  user: SessionUser | null;
}

export type Handler = (ctx: Ctx) => Promise<unknown> | unknown;
export type PublicHandler = (ctx: PublicCtx) => Promise<unknown> | unknown;

declare module 'fastify' {
  interface FastifyRequest {
    sessionUser: SessionUser | null;
  }
}

function readApproval(body: unknown) {
  if (!body || typeof body !== 'object' || !('approval' in body)) return null;
  const parsed = approvalSchema.safeParse((body as { approval: unknown }).approval);
  return parsed.success ? (parsed.data ?? null) : null;
}

function requiredKeys(access: Access): PermissionKey[] | null {
  if (access === 'public' || access === 'auth') return null;
  return Array.isArray(access) ? access : [access];
}

export class Router {
  constructor(
    private readonly app: FastifyInstance,
    readonly deps: Deps,
    readonly table: RouteInfo[],
  ) {}

  get(url: string, access: Access, handler: Handler, options?: RouteOptions) {
    this.add('GET', url, access, handler, options);
  }

  post(url: string, access: Access, handler: Handler, options?: RouteOptions) {
    this.add('POST', url, access, handler, options);
  }

  put(url: string, access: Access, handler: Handler, options?: RouteOptions) {
    this.add('PUT', url, access, handler, options);
  }

  patch(url: string, access: Access, handler: Handler, options?: RouteOptions) {
    this.add('PATCH', url, access, handler, options);
  }

  delete(url: string, access: Access, handler: Handler, options?: RouteOptions) {
    this.add('DELETE', url, access, handler, options);
  }

  public(method: HttpMethod, url: string, handler: PublicHandler, config?: Record<string, unknown>) {
    this.table.push({ method, url, access: 'public', approvable: false });
    const deps = this.deps;
    this.app.route({
      method,
      url,
      config,
      handler: async (req, reply) =>
        handler({
          req,
          reply,
          deps,
          user: req.sessionUser,
          body: req.body,
          params: (req.params ?? {}) as Record<string, string>,
          query: (req.query ?? {}) as Record<string, string | undefined>,
          ip: clientIp(req, deps.config.clientIpHeader),
        }),
    });
  }

  private add(method: HttpMethod, url: string, access: Access, handler: Handler, options: RouteOptions = {}) {
    const approvable = Boolean(options.approvable);
    this.table.push({ method, url, access, approvable });
    const deps = this.deps;
    const keys = requiredKeys(access);
    this.app.route({
      method,
      url,
      handler: async (req, reply) => {
        const user = req.sessionUser;
        if (!user) throw unauthorized();
        if (user.mustChangePassword && !options.allowDuringPasswordChange) {
          throw new AppError(403, 'Troque sua senha temporária para continuar.', 'PASSWORD_CHANGE_REQUIRED');
        }
        const ip = clientIp(req, deps.config.clientIpHeader);
        const approvals = new Map<PermissionKey, Approver | null>();
        const ctx: Ctx = {
          req,
          reply,
          deps,
          user,
          body: req.body,
          params: (req.params ?? {}) as Record<string, string>,
          query: (req.query ?? {}) as Record<string, string | undefined>,
          ip,
          approver: null,
          can: (key) => can(user, key),
          approve: async (key, message) => {
            if (can(user, key)) return null;
            if (approvals.has(key)) return approvals.get(key) ?? null;
            const credentials = readApproval(req.body);
            if (!credentials) throw approvalRequired(key, message);
            const approver = await verifyApprover(deps, credentials, key, ip);
            approvals.set(key, approver);
            ctx.approver = approver;
            return approver;
          },
        };
        if (keys && !keys.some((key) => can(user, key))) {
          if (!approvable || keys.length !== 1) throw forbidden();
          await ctx.approve(keys[0]!);
        }
        return handler(ctx);
      },
    });
  }
}
