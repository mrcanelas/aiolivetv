import { afterEach, describe, expect, it } from 'vitest';
import { postgresPoolConfig } from './postgres-pool.js';

const ORIGINAL_VERCEL = process.env.VERCEL;
const ORIGINAL_POOL_MAX = process.env.DATABASE_POOL_MAX;
const ORIGINAL_CA = process.env.DATABASE_SSL_CA_BASE64;

afterEach(() => {
  if (ORIGINAL_VERCEL === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = ORIGINAL_VERCEL;
  if (ORIGINAL_POOL_MAX === undefined) delete process.env.DATABASE_POOL_MAX;
  else process.env.DATABASE_POOL_MAX = ORIGINAL_POOL_MAX;
  if (ORIGINAL_CA === undefined) delete process.env.DATABASE_SSL_CA_BASE64;
  else process.env.DATABASE_SSL_CA_BASE64 = ORIGINAL_CA;
});

describe('postgresPoolConfig', () => {
  it('trusts a configured CA without disabling certificate validation', () => {
    process.env.DATABASE_SSL_CA_BASE64 = Buffer.from(
      'project certificate'
    ).toString('base64');
    const config = postgresPoolConfig(
      'postgresql://user:pass@localhost/db?sslmode=require&sslrootcert=old.pem&application_name=aiolivetv'
    );
    expect(config.ssl).toEqual({
      ca: 'project certificate',
      rejectUnauthorized: true,
    });
    expect(new URL(config.connectionString!).searchParams.has('sslmode')).toBe(
      false
    );
    expect(
      new URL(config.connectionString!).searchParams.has('sslrootcert')
    ).toBe(false);
    expect(
      new URL(config.connectionString!).searchParams.get('application_name')
    ).toBe('aiolivetv');
  });

  it('preserves the PostgreSQL URL options when no custom CA is configured', () => {
    delete process.env.DATABASE_SSL_CA_BASE64;
    const uri = 'postgresql://user:pass@localhost/db?sslmode=verify-full';
    const config = postgresPoolConfig(uri);
    expect(config.connectionString).toBe(uri);
    expect(config.ssl).toBeUndefined();
  });
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
