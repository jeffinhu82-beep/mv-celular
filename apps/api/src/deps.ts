import type { AppConfig } from './config.ts';
import type { Db } from './db.ts';
import type { Clock } from './lib/clock.ts';
import { AppError } from './lib/errors.ts';

export interface Deps {
  db: Db;
  config: AppConfig;
  clock: Clock;
  failpoints: Set<string>;
}

export function failpoint(deps: Deps, name: string): void {
  if (deps.failpoints.has(name)) throw new AppError(500, `Falha simulada em ${name}`, 'FAILPOINT');
}
