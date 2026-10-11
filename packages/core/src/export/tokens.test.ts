import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportTokens } from '../db/migrations/0007_export_tokens.js';
import {
  ensureExportToken,
  regenerateExportToken,
  resolveExportToken,
} from './tokens.js';
import type { SqlFragment } from '../db/sql.js';

const fixture = vi.hoisted(() => ({
  db: undefined as Database.Database | undefined,
}));
vi.mock('../config/index.js', () => ({
  config: {
    builtins: {
      export: {
        enabled: true,
        disabledReason: '',
        proxyEnabled: false,
        epgWindowHours: 48,
      },
    },
    bootstrap: { baseUrl: 'https://app.test', allowPrivateUrls: false },
  },
}));
vi.mock('../utils/index.js', () => ({
  createLogger: () => ({ info: vi.fn() }),
  encryptString: (data: string) => ({
    success: true,
    data: Buffer.from(data).toString('base64'),
  }),
  decryptString: (data: string) => ({
    success: true,
    data: Buffer.from(data, 'base64').toString(),
  }),
}));
vi.mock('../db/db.js', () => {
  const adapter = {
    maybeOne: async (query: SqlFragment) =>
      fixture.db!.prepare(query.text).get(...query.params),
    exec: async (query: SqlFragment) => {
      fixture.db!.prepare(query.text).run(...query.params);
    },
    tx: async (operation: (tx: unknown) => Promise<unknown>) =>
      operation(adapter),
  };
  return { getDb: () => adapter };
});
beforeEach(() => {
  fixture.db = new Database(':memory:');
  fixture.db.exec(exportTokens.up.sqlite);
});
afterEach(() => fixture.db?.close());

describe('export token persistence', () => {
  it('returns one active token when concurrent requests create links', async () => {
    const results = await Promise.all([
      ensureExportToken('user', 'password'),
      ensureExportToken('user', 'password'),
    ]);
    expect(results[0].token).toBe(results[1].token);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    await expect(resolveExportToken(results[0].token)).resolves.toEqual({
      uuid: 'user',
      password: 'password',
    });
  });

  it('keeps existing links on refresh and revokes them on regeneration', async () => {
    const original = await ensureExportToken('user', 'password');
    expect(await ensureExportToken('user', 'password')).toEqual({
      token: original.token,
      created: false,
    });
    const regenerated = await regenerateExportToken('user', 'password');
    expect(regenerated).not.toBe(original.token);
    await expect(resolveExportToken(original.token)).rejects.toMatchObject({
      code: 'unauthorized',
    });
    await expect(resolveExportToken(regenerated)).resolves.toEqual({
      uuid: 'user',
      password: 'password',
    });
  });
});
