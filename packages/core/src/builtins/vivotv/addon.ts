import { z } from 'zod';
import type { Manifest, Meta, MetaPreview } from '../../db/index.js';
import { Cache, decodeHtmlEntities, makeRequest } from '../../utils/index.js';
import {
  CHANNEL_ID_PREFIX,
  decodeChannelId,
  encodeChannelId,
  LIVE_TV_CATALOG_PAGE_SIZE,
  programLinks,
  programRuntime,
} from '../live-tv/shared.js';

const API_BASE =
  'https://contentapi-br.cdn.telefonica.com/25/default/pt-BR';
const SOURCE_CACHE_TTL = 300;
const REFERENCE_CACHE_TTL = 86_400;
const EPISODE_PATTERN = /T(\d+)\s+EP(\d+)/;
const SAO_PAULO_TZ = 'America/Sao_Paulo';

const sourceCache = Cache.getInstance<string, VivoChannel[]>('vivotv-channels');
const referenceCache = Cache.getInstance<string, VivoReferenceData>(
  'vivotv-reference'
);

export const VivoTvConfigSchema = z.object({
  timeout: z.number().int().positive(),
  days: z.number().int().min(1).max(7).optional(),
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

async function loadSchedules(
  config: VivoTvConfig,
  channelPid: string
): Promise<VivoScheduleItem[]> {
  const days = config.days ?? 3;
  const requests = Array.from({ length: days }, (_, dayOffset) => {
    const starttime = startOfDayUnix(SAO_PAULO_TZ, dayOffset);
    const endtime = startOfDayUnix(SAO_PAULO_TZ, dayOffset + 1);
    const url = `${API_BASE}/schedules?ca_deviceTypes=null%7C401&fields=Title,Description,Start,End,EpgSerieId,SeriesPid,SeasonPid,AgeRatingPid,ReleaseDate,GenrePids,DirectorPids,ActorPids,WriterPids,ProducerPids,images.videoFrame,images.banner&orderBy=START_TIME:a&filteravailability=false&starttime=${starttime}&endtime=${endtime}&livechannelpids=${encodeURIComponent(channelPid)}`;
    return fetchJson<{ Content?: VivoScheduleItem[] }>(url, config.timeout);
  });

  const responses = await Promise.all(requests);
  return responses.flatMap((response) => response?.Content ?? []);
}

export class VivoTvAddon {
  private readonly config: VivoTvConfig;

  constructor(config: VivoTvConfig) {
    this.config = VivoTvConfigSchema.parse(config);
  }

  getManifest(): Manifest {
    return {
      id: 'org.aiolivetv.vivo-tv',
      name: 'Vivo TV',
      version: '1.0.0',
      description: 'Canais e programação da Vivo Play (Telefónica Brasil).',
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
          id: 'vivo-tv-channels',
          type: 'channel',
          name: 'Canais Vivo TV',
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
        id: encodeChannelId(channel.pid),
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
    const channelPid = decodeChannelId(id);
    const channels = await loadChannels(this.config);
    const channel = channels.find((item) => item.pid === channelPid);
    if (!channel) throw new Error(`Channel not found: ${channelPid}`);

    const [reference, schedules] = await Promise.all([
      loadReferenceData(this.config),
      loadSchedules(this.config, channel.pid),
    ]);

    const encodedId = encodeChannelId(channel.pid);
    const videos = schedules
      .filter((item) => item.Start > 0 && item.End > item.Start)
      .map((item) => {
        const startTime = new Date(item.Start * 1000).toISOString();
        const endTime = new Date(item.End * 1000).toISOString();
        const { title, subtitle } = parseProgramTitle(item.Title);
        const { season, episode } = parseSeasonEpisode(item.Title);
        const genres = resolveGenres(item.GenrePids, reference);
        const cast = resolvePersons(item.ActorPids, reference);
        const directors = resolvePersons(item.DirectorPids, reference);
        const links = programLinks(genres, cast, directors);
        const thumbnailUrl = item.Images?.VideoFrame?.[0]?.Url;
        const released = item.ReleaseDate
          ? new Date(item.ReleaseDate * 1000).toISOString()
          : startTime;

        return {
          id: `${encodedId}:epg:${startTime}`,
          title,
          subtitle,
          overview: item.Description,
          thumbnail: thumbnailUrl
            ? programThumbnailUrl(thumbnailUrl)
            : undefined,
          genres: genres.length ? genres : undefined,
          cast: cast.length ? cast : undefined,
          directors: directors.length ? directors : undefined,
          links: links.length ? links : undefined,
          released,
          releaseInfo: released.slice(0, 4),
          runtime: programRuntime(startTime, endTime),
          season: season ? Number(season) : undefined,
          episode: episode ? Number(episode) : undefined,
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
