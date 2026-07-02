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
  utcDayUnixBounds,
  type CatalogHandlerResponse,
} from '../live-tv/epg.js';
import {
  CHANNEL_ID_PREFIX,
  decodeChannelId,
  encodeChannelId,
  LIVE_TV_CATALOG_PAGE_SIZE,
} from '../live-tv/shared.js';

const API_BASE =
  'https://contentapi-br.cdn.telefonica.com/25/default/pt-BR';
const SOURCE_CACHE_TTL = 300;
const REFERENCE_CACHE_TTL = 86_400;
const EPISODE_PATTERN = /T(\d+)\s+EP(\d+)/;

const sourceCache = Cache.getInstance<string, VivoChannel[]>('vivotv-channels');
const referenceCache = Cache.getInstance<string, VivoReferenceData>(
  'vivotv-reference'
);

export const VivoTvConfigSchema = z.object({
  timeout: z.number().int().positive(),
  /** Shift program start/end times by this many minutes (positive = later). */
  timeShiftMinutes: z.number().int().default(0),
});

export type VivoTvConfig = z.infer<typeof VivoTvConfigSchema>;

interface VivoChannel {
  pid: string;
  name: string;
  logo?: string;
  tvgId: string;
}

interface VivoGenre {
  Pid: string;
  Title: string;
}

interface VivoRating {
  Pid: string;
  Description?: string;
  Images?: {
    Cover?: Array<{ Url?: string }>;
    Icon?: Array<{ Url?: string }>;
  };
}

interface VivoPerson {
  Pid: string;
  Title: string;
}

interface VivoScheduleItem {
  Title: string;
  Description?: string;
  Start: number;
  End: number;
  ReleaseDate?: number;
  AgeRatingPid?: string;
  GenrePids?: string[];
  DirectorPids?: string[];
  ActorPids?: string[];
  WriterPids?: string[];
  ProducerPids?: string[];
  Images?: {
    VideoFrame?: Array<{ Url?: string }>;
    Banner?: Array<{ Url?: string }>;
  };
}

interface VivoReferenceData {
  genres: Map<string, string>;
  ratings: Map<string, { value?: string; icon?: string }>;
  persons: Map<string, string>;
}

function normalizeChannelTitle(title: string): string {
  return decodeHtmlEntities(title.replace(/HD | HD/g, '').trim());
}

function channelLogoUrl(iconUrl: string): string {
  return `https://spotlight-br.cdn.telefonica.com/customer/v1/source?image=${encodeURIComponent(iconUrl)}`;
}

function programThumbnailUrl(url: string): string {
  return `https://spotlight-br.cdn.telefonica.com/customer/v1/source?image=${encodeURIComponent(url)}&width=455&height=256&resize=CROP&format=JPEG`;
}

function parseProgramTitle(title: string): {
  title: string;
  subtitle?: string;
} {
  const parts = title.split(':');
  if (parts.length <= 1) {
    return { title };
  }
  const mainTitle = parts[0]?.trim() || title;
  const secondPart = parts.slice(1).join(':').trim();
  if (!secondPart) {
    return { title: mainTitle };
  }
  const subtitle = secondPart.includes('-')
    ? secondPart.split('-').slice(1).join('-').trim() || secondPart
    : secondPart;
  return { title: mainTitle, subtitle: subtitle || undefined };
}

function parseSeasonEpisode(title: string): {
  season?: string;
  episode?: string;
} {
  const match = title.match(EPISODE_PATTERN);
  return match ? { season: match[1], episode: match[2] } : {};
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

async function loadChannels(config: VivoTvConfig): Promise<VivoChannel[]> {
  const cacheKey = 'channels';
  const cached = await sourceCache.get(cacheKey);
  if (cached) return cached;

  const url = `${API_BASE}/contents/all?contentTypes=LCH&ca_active=true&ca_requiresPin=false&fields=Pid,Title,images.icon&orderBy=contentOrder&limit=10000`;
  const body = await fetchJson<{
    Content?: { List?: Array<Record<string, unknown>> };
  }>(url, config.timeout);
  const list = body?.Content?.List ?? [];

  const channels = [
    ...new Map(
      list
        .map((item): VivoChannel | undefined => {
          const pid = typeof item.Pid === 'string' ? item.Pid : undefined;
          const rawTitle =
            typeof item.Title === 'string'
              ? item.Title
              : typeof item.Name === 'string'
                ? item.Name
                : undefined;
          const iconUrl = (
            item.Images as { Icon?: Array<{ Url?: string }> } | undefined
          )?.Icon?.[0]?.Url;
          if (!pid || !rawTitle || !iconUrl) return undefined;
          const name = normalizeChannelTitle(rawTitle);
          return {
            pid: pid.toLowerCase(),
            name,
            logo: channelLogoUrl(iconUrl),
            tvgId: name,
          };
        })
        .filter((channel): channel is VivoChannel => Boolean(channel))
        .map((channel) => [channel.tvgId.toLowerCase(), channel])
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  await sourceCache.set(cacheKey, channels, SOURCE_CACHE_TTL);
  return channels;
}

async function fetchPersons(timeout: number): Promise<VivoPerson[]> {
  const persons: VivoPerson[] = [];
  let offset = 0;
  let lastFirstPid: string | undefined;
  const limit = 100_000;

  while (true) {
    const url = `${API_BASE}/contents/all?contentTypes=PER&fields=Pid,Title&orderBy=contentOrder&limit=${limit}&offset=${offset}`;
    const body = await fetchJson<{
      Content?: { List?: VivoPerson[] };
    }>(url, timeout);
    const batch = body?.Content?.List ?? [];
    if (!batch.length) break;

    const currentFirstPid = batch[0]?.Pid;
    if (currentFirstPid && currentFirstPid === lastFirstPid) break;
    lastFirstPid = currentFirstPid;

    persons.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }

  return persons;
}

async function loadReferenceData(
  config: VivoTvConfig
): Promise<VivoReferenceData> {
  const cacheKey = 'reference';
  const cached = await referenceCache.get(cacheKey);
  if (cached) return cached;

  const [genresBody, ratingsBody, persons] = await Promise.all([
    fetchJson<{ Content?: { List?: VivoGenre[] } }>(
      `${API_BASE}/contents/all?contentTypes=GEN&fields=Pid,Title&limit=10000`,
      config.timeout
    ),
    fetchJson<{ Content?: { List?: VivoRating[] } }>(
      `${API_BASE}/contents/all?contentTypes=AGE&fields=Pid,Title,Description,images&limit=10000`,
      config.timeout
    ),
    fetchPersons(config.timeout),
  ]);

  const genres = new Map(
    (genresBody?.Content?.List ?? []).map((genre) => [genre.Pid, genre.Title])
  );
  const ratings = new Map(
    (ratingsBody?.Content?.List ?? []).map((rating) => {
      const icon =
        rating.Images?.Cover?.[0]?.Url ??
        rating.Images?.Icon?.[0]?.Url ??
        undefined;
      return [
        rating.Pid,
        {
          value: rating.Description,
          icon: icon ? channelLogoUrl(icon) : undefined,
        },
      ];
    })
  );
  const personsMap = new Map(
    persons.map((person) => [person.Pid, person.Title])
  );

  const reference = { genres, ratings, persons: personsMap };
  await referenceCache.set(cacheKey, reference, REFERENCE_CACHE_TTL);
  return reference;
}

function resolvePersons(
  pids: string[] | undefined,
  reference: VivoReferenceData
): string[] {
  if (!pids?.length) return [];
  return pids
    .map((pid) => reference.persons.get(pid))
    .filter((name): name is string => Boolean(name));
}

function resolveGenres(
  pids: string[] | undefined,
  reference: VivoReferenceData
): string[] {
  if (!pids?.length) return [];
  return pids
    .map((pid) => reference.genres.get(pid))
    .filter((name): name is string => Boolean(name));
}

async function loadSchedulesForUtcDay(
  config: VivoTvConfig,
  channelPid: string,
  date: string
): Promise<VivoScheduleItem[]> {
  const { start, end } = utcDayUnixBounds(date);
  const url = `${API_BASE}/schedules?ca_deviceTypes=null%7C401&fields=Title,Description,Start,End,EpgSerieId,SeriesPid,SeasonPid,AgeRatingPid,ReleaseDate,GenrePids,DirectorPids,ActorPids,WriterPids,ProducerPids,images.videoFrame,images.banner&orderBy=START_TIME:a&filteravailability=false&starttime=${start}&endtime=${end}&livechannelpids=${encodeURIComponent(channelPid)}`;
  const body = await fetchJson<{ Content?: VivoScheduleItem[] }>(
    url,
    config.timeout
  );

  return (body?.Content ?? []).filter((item) => {
    if (!(item.Start > 0 && item.End > item.Start)) return false;
    const startTime = new Date(item.Start * 1000).toISOString();
    const endTime = new Date(item.End * 1000).toISOString();
    return shiftedProgramOverlapsUtcDay(
      { startTime, endTime },
      date,
      config.timeShiftMinutes
    );
  });
}

function scheduleToVideo(
  encodedId: string,
  item: VivoScheduleItem,
  reference: VivoReferenceData,
  timeShiftMinutes: number
) {
  const { startTime, endTime } = applyEpgTimeShift(
    new Date(item.Start * 1000).toISOString(),
    new Date(item.End * 1000).toISOString(),
    timeShiftMinutes
  );
  const { title, subtitle } = parseProgramTitle(item.Title);
  const genres = resolveGenres(item.GenrePids, reference);
  const cast = resolvePersons(item.ActorPids, reference);
  const directors = resolvePersons(item.DirectorPids, reference);
  const thumbnailUrl = item.Images?.VideoFrame?.[0]?.Url;
  const airedYear = item.ReleaseDate
    ? new Date(item.ReleaseDate * 1000).toISOString().slice(0, 4)
    : undefined;

  return programToVideo({
    channelEncodedId: encodedId,
    title,
    subtitle,
    description: item.Description,
    thumbnail: thumbnailUrl ? programThumbnailUrl(thumbnailUrl) : undefined,
    startTime,
    endTime,
    airedYear,
    categories: genres,
    cast,
    directors,
  });
}

export class VivoTvAddon {
  private readonly config: VivoTvConfig;

  constructor(config: z.input<typeof VivoTvConfigSchema>) {
    this.config = VivoTvConfigSchema.parse(config);
  }

  getManifest(): Manifest {
    return {
      id: 'org.aiolivetv.vivo-tv',
      name: 'Vivo TV',
      version: '1.0.0',
      description: 'Canais e programação da Vivo Play (Telefónica Brasil).',
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
          id: 'vivo-tv-channels',
          type: TV_TYPE,
          name: 'Canais Vivo TV',
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
          id: encodeChannelId(channel.pid),
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
    const reference = await loadReferenceData(this.config);
    const schedulesByChannel = await Promise.all(
      channels.map((channel) =>
        loadSchedulesForUtcDay(this.config, channel.pid, guideDate)
      )
    );

    return channels.map((channel, index) => {
      const encodedId = encodeChannelId(channel.pid);
      const videos = schedulesByChannel[index]!.map((item) =>
        scheduleToVideo(
          encodedId,
          item,
          reference,
          this.config.timeShiftMinutes
        )
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
    const channelPid = decodeChannelId(id);
    const channels = await loadChannels(this.config);
    const channel = channels.find((item) => item.pid === channelPid);
    if (!channel) throw new Error(`Channel not found: ${channelPid}`);

    const guideDate = resolveGuideDate();
    const [reference, schedules] = await Promise.all([
      loadReferenceData(this.config),
      loadSchedulesForUtcDay(this.config, channel.pid, guideDate),
    ]);

    const encodedId = encodeChannelId(channel.pid);
    const videos = schedules
      .filter((item) => item.Start > 0 && item.End > item.Start)
      .map((item) => {
        const video = scheduleToVideo(
          encodedId,
          item,
          reference,
          this.config.timeShiftMinutes
        );
        const { season, episode } = parseSeasonEpisode(item.Title);
        return {
          ...video,
          season: season ? Number(season) : undefined,
          episode: episode ? Number(episode) : undefined,
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
