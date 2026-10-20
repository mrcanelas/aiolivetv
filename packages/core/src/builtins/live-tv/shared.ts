import { gunzipSync } from 'node:zlib';
import { z } from 'zod';
import { APIError, ErrorCode } from '../../utils/constants.js';
import {
  fromUrlSafeBase64,
  makeRequest,
  toUrlSafeBase64,
} from '../../utils/index.js';

export const CHANNEL_ID_PREFIX = 'aiolivetv:';
export { LIVE_TV_CATALOG_PAGE_SIZE } from './epg.js';

/** Upper bound for M3U/XMLTV downloads to keep Function memory in check. */
export const MAX_LIVE_TV_SOURCE_BYTES = 50 * 1024 * 1024;

/** Input-byte budget, not an exact measurement of parsed objects' heap usage. */
const MAX_CACHED_SOURCE_BYTES = 100 * 1024 * 1024;

export function trimSourceCache<
  T extends { expiresAt: number; sourceBytes: number },
>(entries: Map<string, T>, now = Date.now()) {
  let bytes = 0;
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(key);
    else bytes += entry.sourceBytes;
  }
  for (const [key, entry] of entries) {
    if (entries.size <= 8 && bytes <= MAX_CACHED_SOURCE_BYTES) break;
    entries.delete(key);
    bytes -= entry.sourceBytes;
  }
}

export const LiveTvSourceConfigSchema = z.object({
  sourceUrl: z.url(),
  timeout: z.number().int().positive(),
  maxBytes: z.number().int().positive().optional(),
  /** Shift program start/end times by this many minutes (positive = later). */
  timeShiftMinutes: z.number().int().default(0),
});

export type LiveTvSourceConfig = z.infer<typeof LiveTvSourceConfigSchema>;

export function encodeChannelId(channelId: string): string {
  return `${CHANNEL_ID_PREFIX}${toUrlSafeBase64(channelId.trim().toLowerCase())}`;
}

export function decodeChannelId(id: string): string {
  id = id.split(':epg:', 1)[0];
  if (!id.startsWith(CHANNEL_ID_PREFIX))
    throw new Error(`Unsupported ID: ${id}`);
  return fromUrlSafeBase64(id.slice(CHANNEL_ID_PREFIX.length));
}

export function programLinks(
  genres: string[] = [],
  cast: string[] = [],
  directors: string[] = []
) {
  return [
    ...genres.map((name) => ({
      category: 'Genres',
      name,
      url: `stremio:///search?search=${encodeURIComponent(name)}`,
    })),
    ...cast.map((name) => ({
      category: 'Cast',
      name,
      url: `stremio:///search?search=${encodeURIComponent(name)}`,
    })),
    ...directors.map((name) => ({
      category: 'Director',
      name,
      url: `stremio:///search?search=${encodeURIComponent(name)}`,
    })),
  ];
}

export function programRuntime(startTime: string, endTime: string) {
  const minutes = Math.round(
    (Date.parse(endTime) - Date.parse(startTime)) / 60_000
  );
  return minutes > 0 ? `${minutes} min` : undefined;
}

export async function fetchSourceText(
  config: LiveTvSourceConfig,
  options?: { maxBytes?: number }
): Promise<string> {
  const response = await makeRequest(config.sourceUrl, {
    timeout: config.timeout,
  }).catch((error: unknown) => {
    if (error instanceof APIError) throw error;
    const hostname = new URL(config.sourceUrl).hostname;
    throw new APIError(
      ErrorCode.INTERNAL_SERVER_ERROR,
      502,
      `Could not fetch source from ${hostname}. Check that the source is available, its hostname resolves, and the instance can reach it.`
    );
  });
  if (!response.ok) {
    throw new APIError(
      ErrorCode.INTERNAL_SERVER_ERROR,
      502,
      `Source returned HTTP ${response.status}. Check the source URL and access requirements.`
    );
  }
  const maxBytes =
    options?.maxBytes ?? config.maxBytes ?? MAX_LIVE_TV_SOURCE_BYTES;
  const sizeError = () =>
    new APIError(
      ErrorCode.BAD_REQUEST,
      413,
      `Source exceeds maximum size of ${maxBytes} bytes. Use a smaller regional guide or ask the instance administrator to adjust LIVE_TV_SOURCE_MAX_BYTES in Dashboard settings.`
    );
  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel();
    throw sizeError();
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw sizeError();
      }
      parts.push(value);
    }
    const source = Buffer.concat(parts, bytes);
    let decoded: Buffer;
    try {
      decoded =
        source[0] === 0x1f && source[1] === 0x8b
          ? gunzipSync(source, { maxOutputLength: maxBytes })
          : source;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE')
        throw sizeError();
      throw error;
    }
    return new TextDecoder().decode(decoded);
  } finally {
    reader.releaseLock();
  }
}
