import { z } from 'zod';
import type { Manifest, Meta, MetaPreview, Stream } from '../../db/index.js';
import { TV_TYPE } from '../../utils/constants.js';
import { resolveNotWebReady } from '../../streams/web-readiness.js';
import {
  CHANNEL_ID_PREFIX,
  decodeChannelId,
  encodeChannelId,
  fetchSourceText,
  LiveTvSourceConfig,
  LiveTvSourceConfigSchema,
  LIVE_TV_CATALOG_PAGE_SIZE,
  trimSourceCache,
} from '../live-tv/shared.js';
import {
  bareChannelPreview,
  channelGenreCatalogExtra,
  channelGenres,
} from '../live-tv/epg.js';
import { parseM3u, type M3uEntry } from './parser.js';
import { normalizeChannelGroup } from '../../utils/channelName.js';

const SOURCE_CACHE_TTL_MS = 300_000;
type M3uData = {
  catalog: MetaPreview[];
  catalogByGenre: Map<string | undefined, MetaPreview[]>;
  entriesByChannelId: Map<string, M3uEntry[]>;
  genreExtra: ReturnType<typeof channelGenreCatalogExtra>;
};
// Like XMLTV, keep parsed sources read-only in process; clone only returned pages.
const parsedSources = new Map<
  string,
  { data: M3uData; expiresAt: number; sourceBytes: number }
>();
const inflightSources = new Map<string, Promise<M3uData>>();

export function clearM3uSourceCache() {
  parsedSources.clear();
  inflightSources.clear();
}

function prepareM3u(entries: M3uEntry[]): M3uData {
  const entriesByChannelId = new Map<string, M3uEntry[]>();
  for (const entry of entries) {
    const key = entry.channelId.trim().toLowerCase();
    const group = entriesByChannelId.get(key) ?? [];
    group.push(entry);
    entriesByChannelId.set(key, group);
  }
  const catalog = [
    ...new Map(
      entries.map((entry) => [entry.channelId.toLowerCase(), entry])
    ).values(),
  ]
    .map((entry) =>
      bareChannelPreview({
        id: encodeChannelId(entry.channelId),
        name: entry.name,
        poster: entry.logo,
        tvgId: entry.channelId,
        country: entry.country,
        language: entry.language,
        genres: channelGenres(entry.group),
      })
    )
    .sort((a, b) =>
      (a.name ?? a.id).localeCompare(b.name ?? b.id, undefined, {
        sensitivity: 'base',
      })
    );
  const catalogByGenre = new Map<string | undefined, MetaPreview[]>();
  for (const item of catalog) {
    const genre = item.genres?.[0];
    const group = catalogByGenre.get(genre) ?? [];
    group.push(item);
    catalogByGenre.set(genre, group);
  }
  return {
    catalog,
    catalogByGenre,
    entriesByChannelId,
    genreExtra: channelGenreCatalogExtra(entries.map((entry) => entry.group)),
  };
}

async function loadM3u(config: LiveTvSourceConfig): Promise<M3uData> {
  trimSourceCache(parsedSources);
  const cacheKey = config.sourceUrl;
  const cached = parsedSources.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  if (cached) parsedSources.delete(cacheKey);
  const pending = inflightSources.get(cacheKey);
  if (pending) return pending;
  const load = (async () => {
    const text = await fetchSourceText(config);
    const data = prepareM3u(parseM3u(text));
    parsedSources.set(cacheKey, {
      data,
      expiresAt: Date.now() + SOURCE_CACHE_TTL_MS,
      sourceBytes: Buffer.byteLength(text),
    });
    trimSourceCache(parsedSources);
    return data;
  })();
  inflightSources.set(cacheKey, load);
  try {
    return await load;
  } finally {
    inflightSources.delete(cacheKey);
  }
}

async function mapStream(entry: M3uEntry): Promise<Stream> {
  const stream: Stream = {
    url: entry.url,
    name: entry.name,
    description: entry.group,
  };
  const notWebReady = await resolveNotWebReady(stream, { probe: true });
  return notWebReady
    ? { ...stream, behaviorHints: { notWebReady: true } }
    : stream;
}

export class M3uAddon {
  private readonly config: LiveTvSourceConfig;

  constructor(config: z.input<typeof LiveTvSourceConfigSchema>) {
    this.config = LiveTvSourceConfigSchema.parse(config);
  }

  async getManifest(): Promise<Manifest> {
    let genreExtra = channelGenreCatalogExtra();
    try {
      genreExtra = structuredClone((await loadM3u(this.config)).genreExtra);
    } catch {
      genreExtra = channelGenreCatalogExtra();
    }
    return {
      id: 'org.aiolivetv.m3u',
      name: 'M3U',
      version: '1.0.0',
      description: 'Live TV streams from M3U',
      types: [TV_TYPE],
      resources: [
        {
          name: 'catalog',
          types: [TV_TYPE],
          idPrefixes: [CHANNEL_ID_PREFIX],
        },
        { name: 'meta', types: [TV_TYPE], idPrefixes: [CHANNEL_ID_PREFIX] },
        { name: 'stream', types: [TV_TYPE], idPrefixes: [CHANNEL_ID_PREFIX] },
      ],
      catalogs: [
        {
          id: 'aiolivetv-channels',
          type: TV_TYPE,
          name: 'Channels',
          extra: [{ name: 'skip' }, genreExtra],
        },
      ],
    };
  }

  async getCatalog(skip = 0, genre?: string): Promise<MetaPreview[]> {
    const data = await loadM3u(this.config);
    const catalog = genre
      ? (data.catalogByGenre.get(normalizeChannelGroup(genre)) ?? [])
      : data.catalog;
    return structuredClone(
      catalog.slice(skip, skip + LIVE_TV_CATALOG_PAGE_SIZE)
    );
  }

  async getMeta(id: string): Promise<Meta> {
    const channelId = decodeChannelId(id);
    const entry = (await loadM3u(this.config)).entriesByChannelId.get(
      channelId
    )?.[0];
    if (!entry) throw new Error(`Channel not found: ${channelId}`);
    return {
      id: id.split(':epg:', 1)[0],
      type: TV_TYPE,
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
    const entries =
      (await loadM3u(this.config)).entriesByChannelId.get(channelId) ?? [];
    return Promise.all(entries.map((entry) => mapStream(entry)));
  }
}
