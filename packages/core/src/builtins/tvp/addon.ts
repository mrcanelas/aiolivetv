import { z } from 'zod';
import type { Manifest, Meta, MetaPreview } from '../../db/index.js';
import { TV_TYPE } from '../../utils/constants.js';
import { Cache, decodeHtmlEntities, makeRequest } from '../../utils/index.js';
import {
  applyEpgTimeShift,
  bareChannelPreview,
  buildEpgCatalogResponse,
  EPG_GUIDE_CATALOG_EXTRAS,
  guideChannelMeta,
  programToVideo,
  resolveGuideDate,
  shiftedProgramOverlapsUtcDay,
  type CatalogHandlerResponse,
} from '../live-tv/epg.js';
import {
  CHANNEL_ID_PREFIX,
  decodeChannelId,
  encodeChannelId,
  LIVE_TV_CATALOG_PAGE_SIZE,
} from '../live-tv/shared.js';

const API_BASE = 'https://vod.tvp.pl/api/';
const SOURCE_CACHE_TTL = 300;
const PROGRAMME_CACHE_TTL = 60;
const PROGRAMME_FETCH_TIMEOUT_MS = 15_000;
const PROGRAMME_FETCH_CONCURRENCY = 24;
const DAY_MS = 24 * 60 * 60_000;

const channelCache = Cache.getInstance<string, TvpChannel[]>('tvp-channels');
const programmeCache = Cache.getInstance<string, TvpProgramme[]>(
  'tvp-programmes'
);

export const TvpTvConfigSchema = z.object({
  timeout: z.number().int().positive(),
  timeShiftMinutes: z.number().int().default(0),
});

export type TvpTvConfig = z.infer<typeof TvpTvConfigSchema>;

interface TvpImage {
  url?: string;
  templateUrl?: string;
}

interface TvpProduct {
  id?: unknown;
  title?: unknown;
  type?: unknown;
  images?: Record<string, TvpImage[]>;
  logoImages?: Record<string, TvpImage[]>;
  artworks?: Record<string, TvpImage[]>;
}

interface TvpChannel {
  id: string;
  name: string;
  logo?: string;
  tvgId: string;
}

interface TvpProgramme {
  id: string;
  channelId: string;
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  thumbnail?: string;
  categories?: string[];
  airedYear?: string;
  ratings?: Array<{ value: string; system: string }>;
}

function numericId(value: unknown): string | undefined {
  const raw = String(value ?? '');
  return /^(?:[1-9]\d{0,11})$/.test(raw) ? raw : undefined;
}

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function picture(
  collection: Record<string, TvpImage[]> | undefined,
  ratio: string,
  width: number,
  height: number
): string | undefined {
  const image = collection?.[ratio]?.[0];
  if (!image) return undefined;
  const template = image.templateUrl;
  const source =
    typeof template === 'string' && template.includes('{width:')
      ? template
          .replace(/\{width:\d+\}/g, String(width))
          .replace(/\{height:\d+\}/g, String(height))
      : image.url;
  return httpUrl(source);
}

function tvpUtcMinute(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16)}+0000`;
}

function parseTvpTime(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) return undefined;
  const normalized = value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : undefined;
}

function apiUrl(path: string, params: Record<string, string | string[]> = {}) {
  const url = new URL(path, API_BASE);
  url.searchParams.set('lang', 'pl');
  url.searchParams.set('platform', 'BROWSER');
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      url.searchParams.append(key, item);
    }
  }
  return url.href;
}

const TVP_API_HEADERS = {
  Accept: 'application/json',
  Origin: 'https://vod.tvp.pl',
  Referer: 'https://vod.tvp.pl/',
} as const;

async function fetchJson<T>(
  url: string,
  timeout: number
): Promise<T | undefined> {
  const response = await makeRequest(url, {
    timeout,
    headers: TVP_API_HEADERS,
  });
  if (!response.ok) return undefined;
  try {
    return (await response.json()) as T;
  } catch {
    return undefined;
  }
}

function mapChannel(item: TvpProduct): TvpChannel | undefined {
  const id = numericId(item.id);
  const name = decodeHtmlEntities(String(item.title ?? '')).trim();
  if (!id || !name) return undefined;
  if (item.type && item.type !== 'LIVE') return undefined;
  const logo =
    picture(item.logoImages, '1x1', 300, 300) ||
    picture(item.images, '16x9', 480, 270) ||
    picture(item.images, '3x4', 400, 533);
  return {
    id,
    name,
    logo,
    tvgId: name,
  };
}

async function loadChannels(config: TvpTvConfig): Promise<TvpChannel[]> {
  const cached = await channelCache.get('channels');
  if (cached) return cached;

  const body = await fetchJson<{ items?: TvpProduct[] }>(
    apiUrl('products/lives', { maxResults: '0' }),
    config.timeout
  );
  const channels = (body?.items ?? [])
    .map(mapChannel)
    .filter((channel): channel is TvpChannel => Boolean(channel))
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'));

  await channelCache.set('channels', channels, SOURCE_CACHE_TTL);
  return channels;
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  if (!items.length) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await mapper(items[index]!);
      }
    })
  );
  return results;
}

function mapProgramme(
  row: Record<string, unknown>,
  fallbackChannelId?: string
): TvpProgramme | undefined {
  const id = numericId(row.id);
  const live = row.live as { id?: unknown } | undefined;
  const channelId = numericId(live?.id) ?? numericId(fallbackChannelId);
  const title = decodeHtmlEntities(String(row.title ?? ''))
    .replace(/\s+/g, ' ')
    .trim();
  const startMs = parseTvpTime(row.since);
  const endMs = parseTvpTime(row.till);
  if (!id || !channelId || !title || startMs === undefined || endMs === undefined) {
    return undefined;
  }
  if (endMs <= startMs) return undefined;
  const genres = [
    ...new Set(
      (Array.isArray(row.genres) ? row.genres : [])
        .map((genre) => {
          const name =
            typeof genre === 'string'
              ? genre
              : genre && typeof genre === 'object' && 'name' in genre
                ? String((genre as { name?: unknown }).name ?? '')
                : '';
          return decodeHtmlEntities(name).trim();
        })
        .filter(Boolean)
    ),
  ];
  const year = /^\d{4}$/.test(String(row.year ?? ''))
    ? String(row.year)
    : undefined;
  const description = decodeHtmlEntities(
    String(row.description || row.lead || '')
  ).trim();
  const ratings = programmeRatings(row, title, description);
  return {
    id,
    channelId,
    title,
    description,
    startTime: new Date(startMs).toISOString(),
    endTime: new Date(endMs).toISOString(),
    thumbnail:
      picture(row.images as Record<string, TvpImage[]> | undefined, '16x9', 480, 270) ||
      picture(
        row.artworks as Record<string, TvpImage[]> | undefined,
        '16x9',
        480,
        270
      ),
    categories: genres.length ? genres : undefined,
    airedYear: year,
    ratings,
  };
}

function flagEnabled(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    return /^(?:1|true|yes|jm|n|napisy|ad)$/i.test(value.trim());
  }
  return Array.isArray(value) && value.length > 0;
}

function programmeRatings(
  row: Record<string, unknown>,
  title: string,
  description: string
): Array<{ value: string; system: string }> | undefined {
  const blob = `${title}\n${description}`;
  const ratings: Array<{ value: string; system: string }> = [];
  const ratingRaw = String(row.rating ?? '');
  if (/^(?:0|[1-9]\d?)$/.test(ratingRaw) && Number(ratingRaw) <= 18) {
    ratings.push({ value: ratingRaw, system: 'TVP' });
  }
  if (
    flagEnabled(row.jm) ||
    flagEnabled(row.signLanguage) ||
    flagEnabled(row.migowy) ||
    /\bJM\b|j[eę]zyk migowy/i.test(blob)
  ) {
    ratings.push({ value: 'JM', system: 'TVP' });
  }
  if (
    flagEnabled(row.subbed) ||
    flagEnabled(row.subtitles) ||
    flagEnabled(row.napisy) ||
    /\bnapisy\b|z napisami/i.test(blob)
  ) {
    ratings.push({ value: 'N', system: 'TVP' });
  }
  if (
    flagEnabled(row.ad) ||
    flagEnabled(row.audioDescription) ||
    flagEnabled(row.audiodesc) ||
    flagEnabled(row.audiodeskrypcja) ||
    /\bAD\b|audiodeskrypcja/i.test(blob)
  ) {
    ratings.push({ value: 'AD', system: 'TVP' });
  }
  return ratings.length ? ratings : undefined;
}

async function loadProgrammesForChannelDay(
  config: TvpTvConfig,
  channelId: string,
  date: string
): Promise<TvpProgramme[]> {
  const id = numericId(channelId);
  const startMs = Date.parse(`${date}T00:00:00.000Z`);
  if (!id || !Number.isFinite(startMs)) return [];
  const cacheKey = `${date}:${id}`;
  const cached = await programmeCache.get(cacheKey);
  if (cached) return cached;

  let body: unknown;
  try {
    body = await fetchJson<unknown>(
      apiUrl('products/lives/programmes', {
        since: tvpUtcMinute(startMs),
        till: tvpUtcMinute(startMs + DAY_MS),
        'liveId[]': [id],
      }),
      Math.max(config.timeout, PROGRAMME_FETCH_TIMEOUT_MS)
    );
  } catch {
    return [];
  }
  if (!Array.isArray(body)) return [];

  const programmes = body
    .flatMap((row) =>
      row && typeof row === 'object'
        ? mapProgramme(row as Record<string, unknown>, id)
        : undefined
    )
    .filter((item): item is TvpProgramme => Boolean(item));

  await programmeCache.set(cacheKey, programmes, PROGRAMME_CACHE_TTL);
  return programmes;
}

async function loadProgrammesForUtcDay(
  config: TvpTvConfig,
  channelIds: string[],
  date: string
): Promise<TvpProgramme[]> {
  const ids = [...new Set(channelIds.map(numericId).filter(Boolean))] as string[];
  if (!ids.length) return [];
  const batches = await mapPool(ids, PROGRAMME_FETCH_CONCURRENCY, (id) =>
    loadProgrammesForChannelDay(config, id, date)
  );
  return batches.flat();
}

function programmeToVideo(
  encodedId: string,
  item: TvpProgramme,
  timeShiftMinutes: number
) {
  const { startTime, endTime } = applyEpgTimeShift(
    item.startTime,
    item.endTime,
    timeShiftMinutes
  );
  return programToVideo({
    channelEncodedId: encodedId,
    title: item.title,
    description: item.description,
    thumbnail: item.thumbnail,
    startTime,
    endTime,
    airedYear: item.airedYear,
    categories: item.categories,
    ratings: item.ratings,
  });
}

export class TvpAddon {
  private readonly config: TvpTvConfig;

  constructor(config: z.input<typeof TvpTvConfigSchema>) {
    this.config = TvpTvConfigSchema.parse(config);
  }

  getManifest(): Manifest {
    return {
      id: 'org.aiolivetv.tvp',
      name: 'TVP',
      version: '1.0.0',
      description: 'Canais ao vivo e programação EPG da TVP (Polónia).',
      types: [TV_TYPE],
      resources: [
        {
          name: 'catalog',
          types: [TV_TYPE],
          idPrefixes: [CHANNEL_ID_PREFIX],
        },
        { name: 'meta', types: [TV_TYPE], idPrefixes: [CHANNEL_ID_PREFIX] },
      ],
      catalogs: [
        {
          id: 'tvp-channels',
          type: TV_TYPE,
          name: 'Canais TVP',
          extra: [...EPG_GUIDE_CATALOG_EXTRAS],
        },
      ],
      behaviorHints: { epgProvider: true },
    };
  }

  async getCatalog(skip = 0): Promise<MetaPreview[]> {
    return (await loadChannels(this.config))
      .slice(skip, skip + LIVE_TV_CATALOG_PAGE_SIZE)
      .map((channel) =>
        bareChannelPreview({
          id: encodeChannelId(channel.id),
          name: channel.name,
          logo: channel.logo,
          poster: channel.logo,
          tvgId: channel.tvgId,
          country: 'PL',
          language: 'pl',
        })
      );
  }

  async getCatalogGuide(skip = 0, date?: string): Promise<Meta[]> {
    const guideDate = resolveGuideDate(date);
    const channels = (await loadChannels(this.config)).slice(
      skip,
      skip + LIVE_TV_CATALOG_PAGE_SIZE
    );
    const programmes = await loadProgrammesForUtcDay(
      this.config,
      channels.map((channel) => channel.id),
      guideDate
    );

    return channels.map((channel) => {
      const encodedId = encodeChannelId(channel.id);
      const videos = programmes
        .filter((item) => item.channelId === channel.id)
        .filter((item) =>
          shiftedProgramOverlapsUtcDay(item, guideDate, this.config.timeShiftMinutes)
        )
        .map((item) =>
          programmeToVideo(encodedId, item, this.config.timeShiftMinutes)
        );
      return guideChannelMeta(
        {
          id: encodedId,
          name: channel.name,
          logo: channel.logo,
          country: 'PL',
          language: 'pl',
          tvgId: channel.tvgId,
        },
        videos
      );
    });
  }

  async getCatalogResponse(
    skip = 0,
    date?: string
  ): Promise<CatalogHandlerResponse> {
    return buildEpgCatalogResponse(
      (pageSkip) => this.getCatalog(pageSkip),
      (pageSkip, guideDate) => this.getCatalogGuide(pageSkip, guideDate),
      skip,
      date
    );
  }

  async getMeta(id: string): Promise<Meta> {
    const channelId = decodeChannelId(id);
    const channel = (await loadChannels(this.config)).find(
      (item) => item.id === channelId
    );
    if (!channel) throw new Error(`Channel not found: ${channelId}`);

    const guideDate = resolveGuideDate();
    const programmes = await loadProgrammesForUtcDay(
      this.config,
      [channel.id],
      guideDate
    );

    const encodedId = encodeChannelId(channel.id);
    const videos = programmes
      .filter((item) =>
        shiftedProgramOverlapsUtcDay(
          item,
          guideDate,
          this.config.timeShiftMinutes
        )
      )
      .map((item) =>
        programmeToVideo(encodedId, item, this.config.timeShiftMinutes)
      );

    return {
      id: encodedId,
      type: TV_TYPE,
      name: channel.name,
      logo: channel.logo,
      poster: channel.logo,
      posterShape: 'square',
      country: 'PL',
      language: 'pl',
      behaviorHints: { hasScheduledVideos: true },
      videos,
    };
  }
}
