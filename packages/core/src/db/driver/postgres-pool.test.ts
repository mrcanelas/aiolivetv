import { afterEach, describe, expect, it } from 'vitest';
import { postgresPoolConfig } from './postgres-pool.js';

const ORIGINAL_VERCEL = process.env.VERCEL;
const ORIGINAL_POOL_MAX = process.env.DATABASE_POOL_MAX;

afterEach(() => {
  if (ORIGINAL_VERCEL === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = ORIGINAL_VERCEL;
  if (ORIGINAL_POOL_MAX === undefined) delete process.env.DATABASE_POOL_MAX;
  else process.env.DATABASE_POOL_MAX = ORIGINAL_POOL_MAX;
});

describe('postgresPoolConfig', () => {
  it('limits the pool size on Vercel', () => {
    process.env.VERCEL = '1';
    delete process.env.DATABASE_POOL_MAX;
    const config = postgresPoolConfig('postgresql://user:pass@localhost/db');
    expect(config.max).toBe(3);
    expect(config.idleTimeoutMillis).toBe(30_000);
    expect(config.connectionTimeoutMillis).toBe(5_000);
    expect(config.keepAlive).toBe(true);
  });

  it('honours DATABASE_POOL_MAX', () => {
    process.env.VERCEL = '1';
    process.env.DATABASE_POOL_MAX = '2';
    expect(postgresPoolConfig('postgresql://user:pass@localhost/db').max).toBe(
      2
    );
  });
});
