import type { PoolConfig } from 'pg';
import { isEphemeralRuntime } from '../../utils/runtime.js';

export function postgresPoolConfig(connectionString: string): PoolConfig {
  const configuredMax = Number(process.env.DATABASE_POOL_MAX);
  const max =
    Number.isFinite(configuredMax) && configuredMax > 0
      ? configuredMax
      : isEphemeralRuntime()
        ? 3
        : 10;

  return {
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  };
}
