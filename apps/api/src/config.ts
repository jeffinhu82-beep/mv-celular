export interface AppConfig {
  databaseUrl: string;
  port: number;
  host: string;
  sessionTtlHours: number;
  cookieSecure: boolean;
  secretEncryptionKey: string;
  loginRateLimitPerMinute: number;
  maxFailedLogins: number;
  lockMinutes: number;
  webOrigin: string | null;
  clientIpHeader: string | null;
  logger: boolean;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const env = process.env;
  const config: AppConfig = {
    databaseUrl: env.DATABASE_URL ?? '',
    port: Number(env.API_PORT ?? 3390),
    host: env.API_HOST ?? '127.0.0.1',
    sessionTtlHours: Number(env.SESSION_TTL_HOURS ?? 12),
    cookieSecure: env.COOKIE_SECURE === 'true',
    secretEncryptionKey: env.SECRET_ENCRYPTION_KEY ?? '',
    loginRateLimitPerMinute: Number(env.LOGIN_RATE_LIMIT ?? 20),
    maxFailedLogins: 5,
    lockMinutes: 15,
    webOrigin: env.WEB_ORIGIN ?? null,
    clientIpHeader: env.CLIENT_IP_HEADER?.trim().toLowerCase() || null,
    logger: env.NODE_ENV !== 'test',
    ...overrides,
  };
  if (!config.databaseUrl) throw new Error('DATABASE_URL não configurada');
  if (!/^[0-9a-f]{64}$/i.test(config.secretEncryptionKey)) {
    throw new Error('SECRET_ENCRYPTION_KEY precisa ter 64 caracteres hexadecimais (32 bytes)');
  }
  return config;
}
