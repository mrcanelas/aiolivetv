import { Xtream } from '@iptv/xtream-api';
import { standardizedSerializer } from '@iptv/xtream-api/standardized';
import type { StandardXtreamChannel } from '@iptv/xtream-api/standardized';
import type { XtreamConfig } from './config.js';

export function normalizeXtreamUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

export function createXtreamClient(config: XtreamConfig): Xtream<typeof standardizedSerializer.serializers> {
  return new Xtream({
    url: normalizeXtreamUrl(config.url),
    username: config.username,
    password: config.password,
    preferredFormat: config.preferredFormat,
    serializer: standardizedSerializer,
  });
}

export async function loadXtreamChannels(
  client: Xtream<typeof standardizedSerializer.serializers>,
  categoryId?: string
): Promise<StandardXtreamChannel[]> {
  const channels: StandardXtreamChannel[] = [];
  let page = 1;
  while (true) {
    const batch = await client.getChannels({
      categoryId,
      page,
      limit: 500,
    });
    if (!batch.length) break;
    channels.push(...batch);
    if (batch.length < 500) break;
    page += 1;
  }
  return channels;
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
