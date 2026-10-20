import type { PoolConfig } from 'pg';
import { isEphemeralRuntime } from '../../utils/runtime.js';

export function postgresPoolConfig(connectionString: string): PoolConfig {
  const encodedCa = process.env.DATABASE_SSL_CA_BASE64;
  let ssl: PoolConfig['ssl'];
  if (encodedCa) {
    const url = new URL(connectionString);
    // pg's URL SSL options would otherwise replace the explicit trusted CA.
    for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) {
      url.searchParams.delete(key);
    }
    connectionString = url.toString();
    ssl = {
      ca: Buffer.from(encodedCa, 'base64').toString('utf8'),
      rejectUnauthorized: true,
    };
  }
  const configuredMax = Number(process.env.DATABASE_POOL_MAX);
  const max =
    Number.isFinite(configuredMax) && configuredMax > 0
      ? configuredMax
      : isEphemeralRuntime()
        ? 3
        : 10;

  return {
    connectionString,
    ...(ssl ? { ssl } : {}),
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  };
}
