import type { Migration } from './types.js';

export const exportTokens: Migration = {
  id: 7,
  name: 'export_tokens',
  up: {
    sqlite: `
      CREATE TABLE IF NOT EXISTS export_tokens (
        token_hash TEXT PRIMARY KEY NOT NULL,
        uuid TEXT NOT NULL UNIQUE,
        password_enc TEXT NOT NULL,
        token_enc TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_export_tokens_uuid ON export_tokens (uuid);
    `,
    postgres: `
      CREATE TABLE IF NOT EXISTS export_tokens (
        token_hash TEXT PRIMARY KEY NOT NULL,
        uuid TEXT NOT NULL UNIQUE,
        password_enc TEXT NOT NULL,
        token_enc TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_export_tokens_uuid ON export_tokens (uuid);
    `,
  },
};
