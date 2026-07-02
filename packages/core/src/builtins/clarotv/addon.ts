import { z } from 'zod';
import type { Manifest, Meta, MetaPreview } from '../../db/index.js';
import { Cache, decodeHtmlEntities, makeRequest } from '../../utils/index.js';
import {
  CHANNEL_ID_PREFIX,
  decodeChannelId,
  encodeChannelId,
  LIVE_TV_CATALOG_PAGE_SIZE,
  programRuntime,
} from '../live-tv/shared.js';

const API_BASE = 'https://www.clarotvmais.com.br/avsclient/1.2/epg/livechannels';
const SOURCE_CACHE_TTL = 300;
const DEFAULT_LOCATION = 'SAO PAULO,SAO PAULO';
const SAO_PAULO_TZ = 'America/Sao_Paulo';

const sourceCache = Cache.getInstance<string, ClaroChannel[]>('clarotv-channels');

export const ClaroTvConfigSchema = z.object({
  timeout: z.number().int().positive(),
  days: z.number().int().min(1).max(7).optional(),
  location: z.string().min(1).optional(),
});

export type ClaroTvConfig = z.infer<typeof ClaroTvConfigSchema>;

interface ClaroChannel {
  id: string;
  name: string;
  logo?: string;
  tvgId: string;
}

interface ClaroScheduleItem {
  title: string;
  description?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  image?: string;
  startTime: number;
  endTime: number;
}

interface ClaroLiveChannelsResponse {
  response?: {
    liveChannels?: Array<{
      id?: string | number;
      name?: string;
      logo?: string;
      schedules?: ClaroScheduleItem[];
    }>;
  };
}

function normalizeChannelTitle(title: string): string {
  return decodeHtmlEntities(title.replace(/HD | HD/g, '').trim());
}

function programThumbnailUrl(url: string): string {
  return url.replace('{{image-size-placeholder}}', '420_236');
}

function startOfDayUnix(timeZone: string, dayOffset = 0): number {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day =
    Number(parts.find((part) => part.type === 'day')?.value) + dayOffset;
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const formatted = probe.toLocaleString('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
  });
  const offsetMatch = formatted.match(/GMT([+-]\d+)/);
  const offsetHours = offsetMatch ? Number(offsetMatch[1]) : -3;
  return Math.floor(
    Date.UTC(year, month - 1, day, -offsetHours, 0, 0) / 1000
  );
}

function buildEpgUrl(
  config: ClaroTvConfig,
  params: {
    channelIds?: string;
    startTime?: number;
    endTime?: number;
  }
) {
  const location = encodeURIComponent(config.location ?? DEFAULT_LOCATION);
  const channelIds = params.channelIds ?? '';
  const startTime =
    params.startTime === undefined ? '' : String(params.startTime);
  const endTime = params.endTime === undefined ? '' : String(params.endTime);
  return `${API_BASE}?types=&channelIds=${channelIds}&startTime=${startTime}&endTime=${endTime}&location=${location}&channel=PCTV`;
}

async function fetchJson<T>(
  url: string,
  timeout: number
): Promise<T | undefined> {
  const response = await makeRequest(url, { timeout });
  if (!response.ok) return undefined;
  try {
    return (await response.json()) as T;
  } catch {
    return undefined;
  }
}

function parseSchedules(body: ClaroLiveChannelsResponse | undefined) {
  const schedules = body?.response?.liveChannels?.[0]?.schedules;
  if (!Array.isArray(schedules) || !schedules.length) return [];
  return schedules.filter(
    (item) =>
      typeof item.startTime === 'number' &&
      typeof item.endTime === 'number' &&
      item.endTime > item.startTime
  );
}

async function loadChannels(config: ClaroTvConfig): Promise<ClaroChannel[]> {
  const cacheKey = config.location ?? DEFAULT_LOCATION;
  const cached = await sourceCache.get(cacheKey);
  if (cached) return cached;

  const body = await fetchJson<ClaroLiveChannelsResponse>(
    buildEpgUrl(config, {}),
    config.timeout
  );
  const channels = [
    ...new Map(
      (body?.response?.liveChannels ?? [])
        .map((item): ClaroChannel | undefined => {
          const id =
            item.id === undefined || item.id === null
              ? undefined
              : String(item.id);
          const rawName = typeof item.name === 'string' ? item.name : undefined;
          const logo = typeof item.logo === 'string' ? item.logo : undefined;
          if (!id || !rawName || !logo) return undefined;
          const name = normalizeChannelTitle(rawName);
          return {
            id,
            name,
            logo,
            tvgId: name,
          };
        })
        .filter((channel): channel is ClaroChannel => Boolean(channel))
        .map((channel) => [channel.id, channel])
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  await sourceCache.set(cacheKey, channels, SOURCE_CACHE_TTL);
  return channels;
}

async function loadSchedules(
  config: ClaroTvConfig,
  channelId: string
): Promise<ClaroScheduleItem[]> {
  const days = config.days ?? 3;
  const requests = Array.from({ length: days }, (_, dayOffset) => {
    const startTime = startOfDayUnix(SAO_PAULO_TZ, dayOffset);
    const endTime = startOfDayUnix(SAO_PAULO_TZ, dayOffset + 1);
    return fetchJson<ClaroLiveChannelsResponse>(
      buildEpgUrl(config, { channelIds: channelId, startTime, endTime }),
      config.timeout
    );
  });

  const responses = await Promise.all(requests);
  return responses.flatMap((response) => parseSchedules(response));
}

export class ClaroTvAddon {
  private readonly config: ClaroTvConfig;

  constructor(config: ClaroTvConfig) {
    this.config = ClaroTvConfigSchema.parse(config);
  }

  getManifest(): Manifest {
    return {
      id: 'org.aiolivetv.claro-tv',
      name: 'Claro TV+',
      version: '1.0.0',
      description: 'Canais e programação EPG da Claro TV+ (Claro tv+).',
      types: ['channel'],
      resources: [
        {
          name: 'catalog',
          types: ['channel'],
          idPrefixes: [CHANNEL_ID_PREFIX],
        },
        { name: 'meta', types: ['channel'], idPrefixes: [CHANNEL_ID_PREFIX] },
      ],
      catalogs: [
        {
          id: 'claro-tv-channels',
          type: 'channel',
          name: 'Canais Claro TV+',
          extra: [{ name: 'skip' }],
        },
      ],
      behaviorHints: { epgProvider: true },
    };
  }

  async getCatalog(skip = 0): Promise<MetaPreview[]> {
    return (await loadChannels(this.config))
      .slice(skip, skip + LIVE_TV_CATALOG_PAGE_SIZE)
      .map((channel) => ({
        id: encodeChannelId(channel.id),
        type: 'channel',
        name: channel.name,
        poster: channel.logo,
        posterShape: 'square',
        tvgId: channel.tvgId,
        country: 'BR',
        language: 'pt',
      }));
  }

  async getMeta(id: string): Promise<Meta> {
    const channelId = decodeChannelId(id);
    const channels = await loadChannels(this.config);
    const channel = channels.find((item) => item.id === channelId);
    if (!channel) throw new Error(`Channel not found: ${channelId}`);

    const schedules = await loadSchedules(this.config, channel.id);
    const encodedId = encodeChannelId(channel.id);
    const videos = schedules
      .map((item) => {
        const startTime = new Date(item.startTime * 1000).toISOString();
        const endTime = new Date(item.endTime * 1000).toISOString();
        const thumbnail = item.image
          ? programThumbnailUrl(item.image)
          : undefined;

        return {
          id: `${encodedId}:epg:${startTime}`,
          title: decodeHtmlEntities(item.title),
          overview: item.description
            ? decodeHtmlEntities(item.description)
            : undefined,
          thumbnail,
          released: startTime,
          releaseInfo: startTime.slice(0, 4),
          runtime: programRuntime(startTime, endTime),
          season:
            typeof item.seasonNumber === 'number'
              ? item.seasonNumber
              : undefined,
          episode:
            typeof item.episodeNumber === 'number'
              ? item.episodeNumber
              : undefined,
          startTime,
          endTime,
        };
      })
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    return {
      id: encodedId,
      type: 'channel',
      name: channel.name,
      poster: channel.logo,
      posterShape: 'square',
      country: 'BR',
      language: 'pt',
      videos,
    };
  }
}
