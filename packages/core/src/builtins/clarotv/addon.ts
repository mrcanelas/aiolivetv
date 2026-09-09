import { z } from 'zod';
import type { Manifest, Meta, MetaPreview } from '../../db/index.js';
import { TV_TYPE } from '../../utils/constants.js';
import { Cache, decodeHtmlEntities, makeRequest } from '../../utils/index.js';
import {
  applyEpgTimeShift,
  bareChannelPreview,
  buildEpgCatalogResponse,
  EPG_CACHE_HEADERS,
  EPG_GUIDE_CATALOG_EXTRAS,
  guideChannelMeta,
  shiftedProgramOverlapsUtcDay,
  programToVideo,
  resolveGuideDate,
  toContentRatings,
  utcDayUnixBounds,
  type CatalogHandlerResponse,
} from '../live-tv/epg.js';
import {
  CHANNEL_ID_PREFIX,
  decodeChannelId,
  encodeChannelId,
  LIVE_TV_CATALOG_PAGE_SIZE,
} from '../live-tv/shared.js';

const API_BASE = 'https://www.clarotvmais.com.br/avsclient/1.2/epg/livechannels';
const SOURCE_CACHE_TTL = 300;
const DEFAULT_LOCATION = 'SAO PAULO,SAO PAULO';

const sourceCache = Cache.getInstance<string, ClaroChannel[]>('clarotv-channels');

export const ClaroTvConfigSchema = z.object({
  timeout: z.number().int().positive(),
  location: z.string().min(1).optional(),
  /** Shift program start/end times by this many minutes (positive = later). */
  timeShiftMinutes: z.number().int().default(0),
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
  rating?: string;
  parentalRating?: string;
  ageRating?: string;
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

async function loadSchedulesForUtcDay(
  config: ClaroTvConfig,
  channelIds: string[],
  date: string
): Promise<Map<string, ClaroScheduleItem[]>> {
  const byChannel = new Map<string, ClaroScheduleItem[]>();
  if (!channelIds.length) return byChannel;

  const { start, end } = utcDayUnixBounds(date);
  const body = await fetchJson<ClaroLiveChannelsResponse>(
    buildEpgUrl(config, {
      channelIds: channelIds.join(','),
      startTime: start,
      endTime: end,
    }),
    config.timeout
  );

  for (const liveChannel of body?.response?.liveChannels ?? []) {
    const id =
      liveChannel.id === undefined || liveChannel.id === null
        ? undefined
        : String(liveChannel.id);
    if (!id) continue;
    const schedules = parseSchedules({
      response: { liveChannels: [liveChannel] },
    }).filter((item) => {
      const startTime = new Date(item.startTime * 1000).toISOString();
      const endTime = new Date(item.endTime * 1000).toISOString();
      return shiftedProgramOverlapsUtcDay(
        { startTime, endTime },
        date,
        config.timeShiftMinutes
      );
    });
    byChannel.set(id, schedules);
  }

  return byChannel;
}

function scheduleToVideo(
  encodedId: string,
  item: ClaroScheduleItem,
  timeShiftMinutes: number
) {
  const { startTime, endTime } = applyEpgTimeShift(
    new Date(item.startTime * 1000).toISOString(),
    new Date(item.endTime * 1000).toISOString(),
    timeShiftMinutes
  );
  const thumbnail = item.image ? programThumbnailUrl(item.image) : undefined;
  return programToVideo({
    channelEncodedId: encodedId,
    title: decodeHtmlEntities(item.title),
    description: item.description
      ? decodeHtmlEntities(item.description)
      : undefined,
    thumbnail,
    startTime,
    endTime,
    ratings: toContentRatings([
      {
        value: item.rating ?? item.parentalRating ?? item.ageRating,
        system: 'ClassInd',
      },
    ]),
  });
}

export class ClaroTvAddon {
  private readonly config: ClaroTvConfig;

  constructor(config: z.input<typeof ClaroTvConfigSchema>) {
    this.config = ClaroTvConfigSchema.parse(config);
  }

  getManifest(): Manifest {
    return {
      id: 'org.aiolivetv.claro-tv',
      name: 'Claro TV+',
      version: '1.0.0',
      description: 'Canais e programação EPG da Claro TV+ (Claro tv+).',
      types: [TV_TYPE],
      resources: [
        {
          name: 'catalog',
          types: [TV_TYPE],
          idPrefixes: [CHANNEL_ID_PREFIX],
        },
        {
          name: 'meta',
          types: [TV_TYPE],
          idPrefixes: [CHANNEL_ID_PREFIX],
        },
      ],
      catalogs: [
        {
          id: 'claro-tv-channels',
          type: TV_TYPE,
          name: 'Canais Claro TV+',
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
          poster: channel.logo,
          tvgId: channel.tvgId,
          country: 'BR',
          language: 'pt',
        })
      );
  }

  async getCatalogGuide(skip = 0, date?: string): Promise<Meta[]> {
    const guideDate = resolveGuideDate(date);
    const channels = (await loadChannels(this.config)).slice(
      skip,
      skip + LIVE_TV_CATALOG_PAGE_SIZE
    );
    const schedulesByChannel = await loadSchedulesForUtcDay(
      this.config,
      channels.map((channel) => channel.id),
      guideDate
    );

    return channels.map((channel) => {
      const encodedId = encodeChannelId(channel.id);
      const videos = (schedulesByChannel.get(channel.id) ?? []).map((item) =>
        scheduleToVideo(encodedId, item, this.config.timeShiftMinutes)
      );
      return guideChannelMeta(
        {
          id: encodedId,
          name: channel.name,
          logo: channel.logo,
          country: 'BR',
          language: 'pt',
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
    const channels = await loadChannels(this.config);
    const channel = channels.find((item) => item.id === channelId);
    if (!channel) throw new Error(`Channel not found: ${channelId}`);

    const guideDate = resolveGuideDate();
    const schedulesByChannel = await loadSchedulesForUtcDay(
      this.config,
      [channel.id],
      guideDate
    );
    const schedules = schedulesByChannel.get(channel.id) ?? [];
    const encodedId = encodeChannelId(channel.id);
    const videos = schedules
      .map((item) => {
        const video = scheduleToVideo(
          encodedId,
          item,
          this.config.timeShiftMinutes
        );
        return {
          ...video,
          season:
            typeof item.seasonNumber === 'number'
              ? item.seasonNumber
              : undefined,
          episode:
            typeof item.episodeNumber === 'number'
              ? item.episodeNumber
              : undefined,
        };
      })
      .sort((a, b) => (a.released ?? '').localeCompare(b.released ?? ''));

    return {
      id: encodedId,
      type: TV_TYPE,
      name: channel.name,
      poster: channel.logo,
      posterShape: 'square',
      country: 'BR',
      language: 'pt',
      behaviorHints: { hasScheduledVideos: true },
      videos,
    };
  }
}
