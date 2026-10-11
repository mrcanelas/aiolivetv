import { createHash, randomBytes } from 'node:crypto';
import { getDb } from '../db/db.js';
import { sql } from '../db/sql.js';
import { config as appConfig } from '../config/index.js';
import { createLogger, decryptString, encryptString } from '../utils/index.js';
import { assertExportEnabled } from './policy.js';

const logger = createLogger('export');

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

function encryptPassword(password: string): string {
  const { success, data, error } = encryptString(password);
  if (!success || !data) {
    throw new Error(`Failed to protect export credentials: ${error}`);
  }
  return data;
}

function encryptToken(token: string): string {
  const { success, data, error } = encryptString(token);
  if (!success || !data) {
    throw new Error(`Failed to protect export token: ${error}`);
  }
  return data;
}

export function buildExportUrls(token: string): {
  m3uUrl: string;
  xmltvUrl: string;
} {
  const base = appConfig.bootstrap.baseUrl.replace(/\/+$/, '');
  return {
    m3uUrl: `${base}/exports/${token}/channels.m3u`,
    xmltvUrl: `${base}/exports/${token}/guide.xml`,
  };
}

export function buildExportPlayUrl(token: string, channelId: string): string {
  const base = appConfig.bootstrap.baseUrl.replace(/\/+$/, '');
  return `${base}/exports/${token}/play/${encodeURIComponent(channelId)}`;
}

async function issueToken(uuid: string, passwordEnc: string): Promise<string> {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const tokenEnc = encryptToken(token);
  const db = getDb();
  await db.tx(async (tx) => {
    await tx.exec(sql`DELETE FROM export_tokens WHERE uuid = ${uuid}`);
    await tx.exec(
      sql`INSERT INTO export_tokens (token_hash, uuid, password_enc, token_enc, created_at, updated_at)
          VALUES (${tokenHash}, ${uuid}, ${passwordEnc}, ${tokenEnc}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    );
  });
  return token;
}

export async function ensureExportToken(
  uuid: string,
  password: string
): Promise<{ token: string; created: boolean }> {
  assertExportEnabled();
  const passwordEnc = encryptPassword(password);
  const db = getDb();
  const row = await db.maybeOne<{ token_enc: string }>(
    sql`SELECT token_enc FROM export_tokens WHERE uuid = ${uuid}`
  );

  if (row?.token_enc) {
    const decrypted = decryptString(row.token_enc);
    if (decrypted.success && decrypted.data) {
      await db.exec(
        sql`UPDATE export_tokens SET password_enc = ${passwordEnc}, updated_at = CURRENT_TIMESTAMP WHERE uuid = ${uuid}`
      );
      return { token: decrypted.data, created: false };
    }
  }

  if (row) {
    const token = await issueToken(uuid, passwordEnc);
    return { token, created: true };
  }
  const candidate = generateToken();
  await db.exec(sql`INSERT INTO export_tokens (token_hash, uuid, password_enc, token_enc)
    VALUES (${hashToken(candidate)}, ${uuid}, ${passwordEnc}, ${encryptToken(candidate)})
    ON CONFLICT (uuid) DO NOTHING`);
  const current = await db.maybeOne<{ token_enc: string }>(
    sql`SELECT token_enc FROM export_tokens WHERE uuid = ${uuid}`
  );
  const decrypted = current && decryptString(current.token_enc);
  if (!decrypted?.success || !decrypted.data)
    throw new Error('Failed to load export token');
  const created = decrypted.data === candidate;
  if (created) logger.info({ uuid }, 'export token issued');
  return { token: decrypted.data, created };
}

export async function regenerateExportToken(
  uuid: string,
  password: string
): Promise<string> {
  assertExportEnabled();
  const token = await issueToken(uuid, encryptPassword(password));
  logger.info({ uuid }, 'export token regenerated');
  return token;
}

export async function resolveExportToken(
  token: string
): Promise<{ uuid: string; password: string }> {
  assertExportEnabled();
  const tokenHash = hashToken(token);
  const row = await getDb().maybeOne<{
    uuid: string;
    password_enc: string;
  }>(
    sql`SELECT uuid, password_enc FROM export_tokens WHERE token_hash = ${tokenHash}`
  );
  if (!row) {
    throw Object.assign(new Error('Invalid or revoked export token'), {
      code: 'unauthorized' as const,
    });
  }
  const decrypted = decryptString(row.password_enc);
  if (!decrypted.success || !decrypted.data) {
    throw Object.assign(new Error('Invalid or revoked export token'), {
      code: 'unauthorized' as const,
    });
  }
  return { uuid: row.uuid, password: decrypted.data };
}

export async function deleteExportTokensForUser(uuid: string): Promise<void> {
  await getDb().exec(sql`DELETE FROM export_tokens WHERE uuid = ${uuid}`);
}

export async function updateExportTokenPassword(
  uuid: string,
  password: string
): Promise<void> {
  const passwordEnc = encryptPassword(password);
  await getDb().exec(
    sql`UPDATE export_tokens SET password_enc = ${passwordEnc}, updated_at = CURRENT_TIMESTAMP WHERE uuid = ${uuid}`
  );
}
