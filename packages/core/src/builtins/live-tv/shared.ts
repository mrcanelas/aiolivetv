import { z } from 'zod';
import { fromUrlSafeBase64, makeRequest, toUrlSafeBase64 } from '../../utils/index.js';

export const CHANNEL_ID_PREFIX = 'aiolivetv:';
export const LIVE_TV_CATALOG_PAGE_SIZE = 20;

export const LiveTvSourceConfigSchema = z.object({
  sourceUrl: z.url(),
  timeout: z.number().int().positive(),
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
  config: LiveTvSourceConfig
): Promise<string> {
  const response = await makeRequest(config.sourceUrl, {
    timeout: config.timeout,
  });
  if (!response.ok) {
    throw new Error(
      `Source returned ${response.status} ${response.statusText}`
    );
  }
  return response.text();
}
