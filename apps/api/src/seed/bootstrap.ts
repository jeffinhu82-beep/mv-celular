import { passwordSchema, userCreateSchema } from '@loja/shared';
import { z } from 'zod';
import type { Db } from '../db.ts';
import { seedBase } from './base.ts';

export type BootstrapResult = 'created' | 'has_users' | 'no_admin';

const bootstrapSchema = z.object({
  ADMIN_NAME: userCreateSchema.shape.name,
  ADMIN_EMAIL: userCreateSchema.shape.email,
  ADMIN_PASSWORD: passwordSchema,
  STORE_NAME: z.string().trim().max(120).optional(),
});

export async function bootstrapStore(db: Db, env: Record<string, string | undefined>): Promise<BootstrapResult> {
  if ((await db.user.count()) > 0) return 'has_users';
  if (!env.ADMIN_EMAIL?.trim()) return 'no_admin';
  const input = bootstrapSchema.parse(env);
  await db.$transaction(
    (tx) =>
      seedBase(tx, {
        storeName: input.STORE_NAME || undefined,
        store: {},
        password: input.ADMIN_PASSWORD,
        users: [{ login: 'admin', email: input.ADMIN_EMAIL, name: input.ADMIN_NAME, role: 'admin' }],
        mustChangePassword: true,
      }),
    { timeout: 30_000 },
  );
  return 'created';
}
