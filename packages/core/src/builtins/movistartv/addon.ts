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

const SOURCE_CACHE_TTL = 300;
const REFERENCE_CACHE_TTL = 86_400;
const EPISODE_PATTERN = /T(\d+)\s+EP(\d+)/;
const RATING_SYSTEM = 'Movistar';

export const MOVISTAR_COUNTRIES = [
  {
    code: 'cl',
    name: 'Chile',
    tenant: '26',
    locale: 'es-CL',
    timeZone: 'America/Santiago',
    language: 'es',
  },
  {
    code: 'pe',
    name: 'Peru',
    tenant: '28',
    locale: 'es-PE',
    timeZone: 'America/Lima',
    language: 'es',
  },
  {
    code: 'co',
    name: 'Colombia',
    tenant: '33',
    locale: 'es-CO',
    timeZone: 'America/Bogota',
    language: 'es',
  },
  {
    code: 'ar',
    name: 'Argentina',
    tenant: '29',
    locale: 'es-AR',
    timeZone: 'America/Argentina/Buenos_Aires',
    language: 'es',
  },
] as const;

export type MovistarCountryCode = (typeof MOVISTAR_COUNTRIES)[number]['code'];

const MOVISTAR_COUNTRY_CODES = MOVISTAR_COUNTRIES.map(
  (country) => country.code
) as [MovistarCountryCode, ...MovistarCountryCode[]];

const countryByCode = new Map(
  MOVISTAR_COUNTRIES.map((country) => [country.code, country])
);

const sourceCache = Cache.getInstance<string, MovistarChannel[]>(
  'movistartv-channels'
);
const referenceCache = Cache.getInstance<string, MovistarReferenceData>(
  'movistartv-reference'
);

export const MovistarTvConfigSchema = z.object({
  timeout: z.number().int().positive(),
  country: z.enum(MOVISTAR_COUNTRY_CODES).default('cl'),
  timeShiftMinutes: z.number().int().default(0),
});

export type MovistarTvConfig = z.infer<typeof MovistarTvConfigSchema>;

interface MovistarChannel {
  pid: string;
  name: string;
  logo?: string;
  tvgId: string;
}

interface MovistarGenre {
  Pid: string;
  Title: string;
}

interface MovistarRating {
  Pid: string;
  Title?: string;
  Images?: {
    Cover?: Array<{ Url?: string }>;
    Icon?: Array<{ Url?: string }>;
  };
}

interface MovistarPerson {
  Pid: string;
  Title: string;
}

interface MovistarScheduleItem {
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

interface MovistarReferenceData {
  genres: Record<string, string>;
  ratings: Record<string, { value?: string; icon?: string }>;
  persons: Record<string, string>;
}

export function movistarCountry(code: string) {
  return countryByCode.get(code as MovistarCountryCode) ?? countryByCode.get('cl')!;
}

export function movistarChannelKey(country: string, pid: string): string {
  return `${country}#${pid.trim().toLowerCase()}`;
}

function apiBase(country: ReturnType<typeof movistarCountry>): string {
  return `https://contentapi-${country.code}.cdn.telefonica.com/${country.tenant}/default/${country.locale}`;
}

function spotlightUrl(
  country: string,
  imageUrl: string,
  extraQuery?: string
): string {
  const url = `https://spotlight-${country}.cdn.telefonica.com/customer/v1/source?image=${encodeURIComponent(imageUrl)}`;
  return extraQuery ? `${url}&${extraQuery}` : url;
}

function normalizeChannelTitle(title: string): string {
  return decodeHtmlEntities(title)
    .replace(/_/g, ' ')
    .replace(/\s*\/\s*.+$/, '')
    .replace(/\s*\b(?:UHD|FHD|HD|SD|4K)\b/gi, '')
    .replace(/\s*\bREGIONAL\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function channelVariantRank(rawTitle: string): number {
  const title = decodeHtmlEntities(rawTitle);
  if (/\bREGIONAL\b/i.test(title)) return 0;
  if (/\bSD\b/i.test(title)) return 1;
  if (/_/.test(title)) return 2;
  if (/\b(?:UHD|FHD|HD|4K)\b/i.test(title)) return 4;
  return 3;
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

function imageUrl(
  item: Record<string, unknown>
): string | undefined {
  const images = item.Images as
    | { Icon?: Array<{ Url?: string }>; Logo?: Array<{ Url?: string }> }
    | undefined;
  return images?.Icon?.[0]?.Url || images?.Logo?.[0]?.Url;
}

async function loadChannels(
  config: MovistarTvConfig
): Promise<MovistarChannel[]> {
  const country = movistarCountry(config.country);
  const cached = await sourceCache.get(country.code);
  if (cached) return cached;

  const url = `${apiBase(country)}/contents/all?contentTypes=LCH&ca_active=true&ca_requiresPin=false&fields=Pid,Title,Name,images.icon,images.logo&orderBy=contentOrder&limit=10000`;
  const body = await fetchJson<{
    Content?: { List?: Array<Record<string, unknown>> };
  }>(url, config.timeout);
  const list = body?.Content?.List ?? [];

  const byName = new Map<string, { channel: MovistarChannel; rank: number }>();
  for (const item of list) {
    const pid = typeof item.Pid === 'string' ? item.Pid : undefined;
    if (!pid || !pid.toUpperCase().startsWith('LCH')) continue;
    const rawTitle =
      typeof item.Title === 'string'
        ? item.Title
        : typeof item.Name === 'string'
          ? item.Name
          : undefined;
    if (!rawTitle) continue;
    const name = normalizeChannelTitle(rawTitle);
    if (!name) continue;
    const rank = channelVariantRank(rawTitle);
    const existing = byName.get(name.toLowerCase());
    if (existing && existing.rank >= rank) continue;
    const sourceImage = imageUrl(item);
    byName.set(name.toLowerCase(), {
      rank,
      channel: {
        pid: pid.toLowerCase(),
        name,
        logo: sourceImage
          ? spotlightUrl(country.code, sourceImage)
          : existing?.channel.logo,
        tvgId: name,
      },
    });
  }
  const channels = [...byName.values()]
    .map((entry) => entry.channel)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  await sourceCache.set(country.code, channels, SOURCE_CACHE_TTL);
  return channels;
}

async function fetchPersons(
  country: ReturnType<typeof movistarCountry>,
  timeout: number
): Promise<MovistarPerson[]> {
  const persons: MovistarPerson[] = [];
  let offset = 0;
  let lastFirstPid: string | undefined;
  const limit = 100_000;
  const base = apiBase(country);

  while (true) {
    const url = `${base}/contents/all?contentTypes=PER&fields=Pid,Title&orderBy=contentOrder&limit=${limit}&offset=${offset}`;
    const body = await fetchJson<{
      Content?: { List?: MovistarPerson[] };
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
  config: MovistarTvConfig
): Promise<MovistarReferenceData> {
  const country = movistarCountry(config.country);
  const cacheKey = `${country.code}:v1`;
  const cached = await referenceCache.get(cacheKey);
  if (cached) return hydrateReferenceData(cached);

  const base = apiBase(country);
  const [genresBody, ratingsBody, persons] = await Promise.all([
    fetchJson<{ Content?: { List?: MovistarGenre[] } }>(
      `${base}/contents/all?contentTypes=GEN&fields=Pid,Title&limit=10000`,
      config.timeout
    ),
    fetchJson<{ Content?: { List?: MovistarRating[] } }>(
      `${base}/contents/all?contentTypes=AGE&fields=Pid,Title,images&limit=10000`,
      config.timeout
    ),
    fetchPersons(country, config.timeout),
  ]);

  const genres = Object.fromEntries(
    (genresBody?.Content?.List ?? []).map((genre) => [genre.Pid, genre.Title])
  );
  const ratings = Object.fromEntries(
    (ratingsBody?.Content?.List ?? [])
      .filter(
        (rating) =>
          rating.Pid &&
          rating.Pid !== 'AGE_NONE' &&
          rating.Title &&
          rating.Title !== 'AGE_NONE'
      )
      .map((rating) => {
        const rawIcon =
          rating.Images?.Cover?.[0]?.Url || rating.Images?.Icon?.[0]?.Url;
        return [
          rating.Pid,
          {
            value: rating.Title,
            icon: rawIcon
              ? spotlightUrl(country.code, rawIcon)
              : undefined,
          },
        ];
      })
  );
  const personsMap = Object.fromEntries(
    persons.map((person) => [person.Pid, person.Title])
  );

  const reference = { genres, ratings, persons: personsMap };
  await referenceCache.set(cacheKey, reference, REFERENCE_CACHE_TTL);
  return reference;
}

function hydrateReferenceData(
  cached: MovistarReferenceData
): MovistarReferenceData {
  return {
    genres: toStringRecord(cached.genres),
    ratings: toRatingRecord(cached.ratings),
    persons: toStringRecord(cached.persons),
  };
}

function toStringRecord(
  value: MovistarReferenceData['genres'] | Map<string, string> | undefined
): Record<string, string> {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value);
  return value;
}

function toRatingRecord(
  value:
    | MovistarReferenceData['ratings']
    | Map<string, { value?: string; icon?: string }>
    | undefined
): Record<string, { value?: string; icon?: string }> {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value);
  return value;
}

function resolvePersons(
  pids: string[] | undefined,
  reference: MovistarReferenceData
): string[] {
  if (!pids?.length) return [];
  return pids
    .map((pid) => reference.persons[pid])
    .filter((name): name is string => Boolean(name));
}

function resolveGenres(
  pids: string[] | undefined,
  reference: MovistarReferenceData
): string[] {
  if (!pids?.length) return [];
  return pids
    .map((pid) => reference.genres[pid])
    .filter((name): name is string => Boolean(name));
}

function resolveRating(
  pid: string | undefined,
  reference: MovistarReferenceData
): Array<{ value: string; system: string; icon?: string }> | undefined {
  if (!pid) return undefined;
  const rating = reference.ratings[pid];
  if (!rating?.value) return undefined;
  return [
    {
      value: rating.value,
      system: RATING_SYSTEM,
      ...(rating.icon ? { icon: rating.icon } : {}),
    },
  ];
}

async function loadSchedulesForUtcDay(
  config: MovistarTvConfig,
  channelPid: string,
  date: string
): Promise<MovistarScheduleItem[]> {
  const country = movistarCountry(config.country);
  const { start, end } = utcDayUnixBounds(date);
  const url = `${apiBase(country)}/schedules?fields=Title,Description,Start,End,EpgSerieId,SeriesPid,SeasonPid,AgeRatingPid,ReleaseDate,GenrePids,DirectorPids,ActorPids,WriterPids,ProducerPids,images.videoFrame,images.banner&orderBy=START_TIME:a&filteravailability=false&starttime=${start}&endtime=${end}&livechannelpids=${encodeURIComponent(channelPid)}`;
  const body = await fetchJson<{ Content?: MovistarScheduleItem[] }>(
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
  item: MovistarScheduleItem,
  reference: MovistarReferenceData,
  country: string,
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
    thumbnail: thumbnailUrl
      ? spotlightUrl(
          country,
          thumbnailUrl,
          'width=455&height=256&resize=CROP&format=JPEG'
        )
      : undefined,
    startTime,
    endTime,
    airedYear,
    categories: genres,
    cast,
    directors,
    ratings: resolveRating(item.AgeRatingPid, reference),
  });
}

function encodedChannelId(country: string, pid: string): string {
  return encodeChannelId(movistarChannelKey(country, pid));
}

export class MovistarTvAddon {
  private readonly config: MovistarTvConfig;

  constructor(config: z.input<typeof MovistarTvConfigSchema>) {
    this.config = MovistarTvConfigSchema.parse(config);
  }

  private countryMeta() {
    return movistarCountry(this.config.country);
  }

  getManifest(): Manifest {
    const country = this.countryMeta();
    return {
      id: 'org.aiolivetv.movistar-tv',
      name: `Movistar (${country.name})`,
      version: '1.0.0',
      description: `Live channels and EPG from Movistar for ${country.name}.`,
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
          id: 'movistar-tv-channels',
          type: TV_TYPE,
          name: `Movistar Channels (${country.name})`,
          extra: [...EPG_GUIDE_CATALOG_EXTRAS],
        },
      ],
      behaviorHints: { epgProvider: true },
    };
  }

  async getCatalog(skip = 0): Promise<MetaPreview[]> {
    const country = this.countryMeta();
    return (await loadChannels(this.config))
      .slice(skip, skip + LIVE_TV_CATALOG_PAGE_SIZE)
      .map((channel) =>
        bareChannelPreview({
          id: encodedChannelId(country.code, channel.pid),
          name: channel.name,
          logo: channel.logo,
          poster: channel.logo,
          tvgId: channel.tvgId,
          country: country.code.toUpperCase(),
          language: country.language,
        })
      );
  }

  async getCatalogGuide(skip = 0, date?: string): Promise<Meta[]> {
    const country = this.countryMeta();
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
      const encodedId = encodedChannelId(country.code, channel.pid);
      const videos = schedulesByChannel[index]!.map((item) =>
        scheduleToVideo(
          encodedId,
          item,
          reference,
          country.code,
          this.config.timeShiftMinutes
        )
      );
      return guideChannelMeta(
        {
          id: encodedId,
          name: channel.name,
          logo: channel.logo,
          country: country.code.toUpperCase(),
          language: country.language,
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
    const country = this.countryMeta();
    const key = decodeChannelId(id);
    const expectedPrefix = `${country.code}#`;
    if (!key.startsWith(expectedPrefix)) {
      throw new Error(`Channel not found: ${key}`);
    }
    const channelPid = key.slice(expectedPrefix.length);
    const channel = (await loadChannels(this.config)).find(
      (item) => item.pid === channelPid
    );
    if (!channel) throw new Error(`Channel not found: ${channelPid}`);

    const guideDate = resolveGuideDate();
    const [reference, schedules] = await Promise.all([
      loadReferenceData(this.config),
      loadSchedulesForUtcDay(this.config, channel.pid, guideDate),
    ]);

    const encodedId = encodedChannelId(country.code, channel.pid);
    const videos = schedules
      .filter((item) => item.Start > 0 && item.End > item.Start)
      .map((item) => {
        const video = scheduleToVideo(
          encodedId,
          item,
          reference,
          country.code,
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
      logo: channel.logo,
      poster: channel.logo,
      posterShape: 'square',
      country: country.code.toUpperCase(),
      language: country.language,
      behaviorHints: { hasScheduledVideos: true },
      videos,
    };
  }
}
