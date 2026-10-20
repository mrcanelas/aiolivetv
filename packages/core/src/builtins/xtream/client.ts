import { Xtream } from '@iptv/xtream-api';
import { standardizedSerializer } from '@iptv/xtream-api/standardized';
import type { StandardXtreamChannel } from '@iptv/xtream-api/standardized';
import type { XtreamConfig } from './config.js';

export { compileCategoryNameRegex, parseCategoryIds } from './config.js';

export function normalizeXtreamUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

export function createXtreamClient(
  config: XtreamConfig
): Xtream<typeof standardizedSerializer.serializers> {
  return new Xtream({
    url: normalizeXtreamUrl(config.url),
    username: config.username,
    password: config.password,
    preferredFormat: config.preferredFormat,
    serializer: {
      ...standardizedSerializer,
      serializers: {
        ...standardizedSerializer.serializers,
        channels: (channels) =>
          standardizedSerializer.serializers.channels(
            channels.map((channel) => ({
              ...channel,
              category_ids: (Array.isArray(channel.category_ids)
                ? channel.category_ids
                : channel.category_id != null
                  ? [channel.category_id]
                  : []) as typeof channel.category_ids,
            }))
          ),
      },
    },
  });
}

const CATEGORY_FETCH_CONCURRENCY = 5;

async function loadCategoryChannels(
  client: Xtream<typeof standardizedSerializer.serializers>,
  categoryId?: string
): Promise<StandardXtreamChannel[]> {
  // The API returns the entire category; the SDK's page/limit only slice locally.
  return client.getChannels({ categoryId });
}

// Xtream's get_live_streams accepts a single category_id, so fetch per category and merge.
export async function loadXtreamChannels(
  client: Xtream<typeof standardizedSerializer.serializers>,
  categoryIds?: string[]
): Promise<StandardXtreamChannel[]> {
  if (!categoryIds) return loadCategoryChannels(client);

  const byId = new Map<string, StandardXtreamChannel>();
  for (let i = 0; i < categoryIds.length; i += CATEGORY_FETCH_CONCURRENCY) {
    const batches = await Promise.all(
      categoryIds
        .slice(i, i + CATEGORY_FETCH_CONCURRENCY)
        .map((id) => loadCategoryChannels(client, id))
    );
    for (const channel of batches.flat()) {
      if (!byId.has(channel.id)) byId.set(channel.id, channel);
    }
  }
  return [...byId.values()];
}

export function streamExtension(
  preferredFormat: XtreamConfig['preferredFormat']
): string {
  switch (preferredFormat) {
    case 'm3u8':
      return 'm3u8';
    case 'rtmp':
      return 'rtmp';
    default:
      return 'ts';
  }
}
