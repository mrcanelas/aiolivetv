import type { Manifest, Meta, MetaPreview, Stream } from '../../db/index.js';
import { Cache } from '../../utils/index.js';
import {
  CHANNEL_ID_PREFIX,
  decodeChannelId,
  encodeChannelId,
  fetchSourceText,
  LiveTvSourceConfig,
  LiveTvSourceConfigSchema,
  LIVE_TV_CATALOG_PAGE_SIZE,
} from '../live-tv/shared.js';
import { parseM3u, type M3uEntry } from './parser.js';

const SOURCE_CACHE_TTL = 300;
const sourceCache = Cache.getInstance<string, M3uEntry[]>('m3u-reader-sources');

async function loadM3u(config: LiveTvSourceConfig): Promise<M3uEntry[]> {
  const cacheKey = config.sourceUrl;
  const cached = await sourceCache.get(cacheKey);
  if (cached) return cached;
  const entries = parseM3u(await fetchSourceText(config));
  await sourceCache.set(cacheKey, entries, SOURCE_CACHE_TTL);
  return entries;
}

export class M3uAddon {
  private readonly config: LiveTvSourceConfig;

  constructor(config: LiveTvSourceConfig) {
    this.config = LiveTvSourceConfigSchema.parse(config);
  }

  getManifest(): Manifest {
    return {
      id: 'org.aiolivetv.m3u',
      name: 'M3U',
      version: '1.0.0',
      description: 'Live TV streams from M3U',
      types: ['channel'],
      resources: [
        {
          name: 'catalog',
          types: ['channel'],
          idPrefixes: [CHANNEL_ID_PREFIX],
        },
        { name: 'meta', types: ['channel'], idPrefixes: [CHANNEL_ID_PREFIX] },
        { name: 'stream', types: ['channel'], idPrefixes: [CHANNEL_ID_PREFIX] },
      ],
      catalogs: [
        {
          id: 'aiolivetv-channels',
          type: 'channel',
          name: 'Channels',
          extra: [{ name: 'skip' }],
        },
      ],
    };
  }

  async getCatalog(skip = 0): Promise<MetaPreview[]> {
    const entries = await loadM3u(this.config);
    return [
      ...new Map(
        entries.map((entry) => [entry.channelId.toLowerCase(), entry])
      ).values(),
    ]
      .map((entry) => ({
        id: encodeChannelId(entry.channelId),
        type: 'channel',
        name: entry.name,
        poster: entry.logo,
        posterShape: 'square' as const,
        tvgId: entry.channelId,
        country: entry.country,
        language: entry.language,
        genres: entry.group ? [entry.group] : undefined,
      }))
      .sort((a, b) =>
        (a.name ?? a.id).localeCompare(b.name ?? b.id, undefined, {
          sensitivity: 'base',
        })
      )
      .slice(skip, skip + LIVE_TV_CATALOG_PAGE_SIZE);
  }

  async getMeta(id: string): Promise<Meta> {
    const channelId = decodeChannelId(id);
    const entry = (await loadM3u(this.config)).find(
      (item) => item.channelId.trim().toLowerCase() === channelId
    );
    if (!entry) throw new Error(`Channel not found: ${channelId}`);
    return {
      id: id.split(':epg:', 1)[0],
      type: 'channel',
      name: entry.name,
      poster: entry.logo,
      posterShape: 'square',
      country: entry.country,
      language: entry.language,
      genres: entry.group ? [entry.group] : undefined,
    };
  }

  async getStreams(id: string): Promise<Stream[]> {
    const channelId = decodeChannelId(id);
    return (await loadM3u(this.config))
      .filter((entry) => entry.channelId.trim().toLowerCase() === channelId)
      .map((entry) => ({
        url: entry.url,
        name: entry.name,
        description: entry.group,
      }));
  }
}
