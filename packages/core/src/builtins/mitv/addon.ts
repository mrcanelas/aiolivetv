import pLimit from 'p-limit';
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
  type CatalogHandlerResponse,
} from '../live-tv/epg.js';
import {
  CHANNEL_ID_PREFIX,
  decodeChannelId,
  encodeChannelId,
  LIVE_TV_CATALOG_PAGE_SIZE,
} from '../live-tv/shared.js';

const SITE_ORIGIN = 'https://mi.tv';
const SOURCE_CACHE_TTL = 300;
const SCHEDULE_CACHE_TTL = 300;
const FETCH_CONCURRENCY = 6;
const REQUEST_HEADERS = {
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
};

export const MI_TV_COUNTRIES = [
  {
    code: 'ar',
    name: 'Argentina',
    timeZone: 'America/Argentina/Buenos_Aires',
    language: 'es',
  },
  {
    code: 'br',
    name: 'Brasil',
    timeZone: 'America/Sao_Paulo',
    language: 'pt',
  },
  {
    code: 'cl',
    name: 'Chile',
    timeZone: 'America/Santiago',
    language: 'es',
  },
  {
    code: 'co',
    name: 'Colômbia',
    timeZone: 'America/Bogota',
    language: 'es',
  },
  {
    code: 'sv',
    name: 'El Salvador',
    timeZone: 'America/El_Salvador',
    language: 'es',
  },
  {
    code: 'gt',
    name: 'Guatemala',
    timeZone: 'America/Guatemala',
    language: 'es',
  },
  {
    code: 'hn',
    name: 'Honduras',
    timeZone: 'America/Tegucigalpa',
    language: 'es',
  },
  {
    code: 'mx',
    name: 'México',
    timeZone: 'America/Mexico_City',
    language: 'es',
  },
  {
    code: 'py',
    name: 'Paraguai',
    timeZone: 'America/Asuncion',
    language: 'es',
  },
  {
    code: 'pe',
    name: 'Peru',
    timeZone: 'America/Lima',
    language: 'es',
  },
] as const;

export type MiTvCountryCode = (typeof MI_TV_COUNTRIES)[number]['code'];

const MI_TV_COUNTRY_CODES = MI_TV_COUNTRIES.map((country) => country.code) as [
  MiTvCountryCode,
  ...MiTvCountryCode[],
];

const countryByCode = new Map(
  MI_TV_COUNTRIES.map((country) => [country.code, country])
);

export const MiTvConfigSchema = z.object({
  timeout: z.number().int().positive(),
  country: z.enum(MI_TV_COUNTRY_CODES).default('br'),
  /** Shift program start/end times by this many minutes (positive = later). */
  timeShiftMinutes: z.number().int().default(0),
});

export type MiTvConfig = z.infer<typeof MiTvConfigSchema>;

export interface MiTvChannel {
  slug: string;
  name: string;
  logo?: string;
  tvgId: string;
}

export interface MiTvProgram {
  title: string;
  subtitle?: string;
  description?: string;
  thumbnail?: string;
  startTime: string;
  endTime: string;
  season?: number;
  episode?: number;
}

const channelCache = Cache.getInstance<string, MiTvChannel[]>('mitv-channels');
const scheduleCache = Cache.getInstance<string, MiTvProgram[]>(
  'mitv-schedules'
);

const EPISODE_PATTERN =
  /temporada\s+(\d+)\s+epis[oó]dio\s+(\d+)(?:\s*[-–—]\s*(.+))?/i;

export function miTvCountry(code: string) {
  return countryByCode.get(code as MiTvCountryCode) ?? countryByCode.get('br')!;
}

export function miTvChannelKey(country: string, slug: string): string {
  return `${country}#${slug}`;
}

export function miTvChannelLogo(country: string, slug: string): string {
  return `https://cdn.mitvstatic.com/channels/${country}_${slug}_m.png`;
}

function cleanText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const text = decodeHtmlEntities(value.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  return text || undefined;
}

function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return asUtc - instant.getTime();
}

export function zonedWallTimeToUtc(
  date: string,
  hours: number,
  minutes: number,
  timeZone: string
): Date {
  const guess = new Date(
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10)),
      hours,
      minutes
    )
  );
  return new Date(guess.getTime() - timeZoneOffsetMs(guess, timeZone));
}

export function parseMiTvClock(value: string): { hours: number; minutes: number } | undefined {
  const trimmed = value.trim();
  const twelveHour = trimmed.match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i);
  if (twelveHour) {
    let hours = Number(twelveHour[1]);
    const minutes = Number(twelveHour[2]);
    const meridiem = twelveHour[3]!.toLowerCase();
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return undefined;
    if (hours === 12) hours = 0;
    if (meridiem === 'pm') hours += 12;
    return { hours, minutes };
  }
  const twentyFour = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!twentyFour) return undefined;
  const hours = Number(twentyFour[1]);
  const minutes = Number(twentyFour[2]);
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    hours > 23 ||
    minutes > 59
  ) {
    return undefined;
  }
  return { hours, minutes };
}

function addUtcDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function parseSeasonEpisode(subtitle: string | undefined): {
  subtitle?: string;
  season?: number;
  episode?: number;
} {
  if (!subtitle) return {};
  const match = subtitle.match(EPISODE_PATTERN);
  if (!match) return { subtitle };
  return {
    subtitle: cleanText(match[3]) ?? subtitle,
    season: Number(match[1]),
    episode: Number(match[2]),
  };
}

export function parseMiTvSitemap(html: string, country: string): MiTvChannel[] {
  const pattern = new RegExp(
    `href="/${country}/(?:canais|canales)/([^"]+)"[^>]*>([^<]+)`,
    'gi'
  );
  const channels = new Map<string, MiTvChannel>();
  for (const match of html.matchAll(pattern)) {
    const slug = match[1]?.trim();
    const name = cleanText(match[2]);
    if (!slug || !name || name.startsWith('$')) continue;
    channels.set(slug, {
      slug,
      name,
      logo: miTvChannelLogo(country, slug),
      tvgId: name,
    });
  }
  const locale = country === 'br' ? 'pt-BR' : 'es';
  return [...channels.values()].sort((a, b) =>
    a.name.localeCompare(b.name, locale)
  );
}

export function parseMiTvListings(
  html: string,
  date: string,
  timeZone: string
): MiTvProgram[] {
  const items = [...html.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi)];
  const parsed: Array<Omit<MiTvProgram, 'endTime'> & { startMs: number }> = [];
  let calendarDate = date;

  for (const item of items) {
    const attrs = item[1] ?? '';
    const body = item[2] ?? '';
    if (/\bclass="[^"]*\bnative\b/.test(attrs)) continue;

    const timeText = cleanText(
      body.match(/<span class="time">([\s\S]*?)<\/span>/i)?.[1]
    );
    const title = cleanText(body.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1]);
    if (!timeText || !title) continue;

    const clock = parseMiTvClock(timeText);
    if (!clock) continue;

    let start = zonedWallTimeToUtc(
      calendarDate,
      clock.hours,
      clock.minutes,
      timeZone
    );
    const previous = parsed[parsed.length - 1];
    if (previous && start.getTime() < previous.startMs) {
      calendarDate = addUtcDays(calendarDate, 1);
      start = zonedWallTimeToUtc(
        calendarDate,
        clock.hours,
        clock.minutes,
        timeZone
      );
    }

    const rawSubtitle = cleanText(
      body.match(/<span class="sub-title">([\s\S]*?)<\/span>/i)?.[1]
    );
    const { subtitle, season, episode } = parseSeasonEpisode(rawSubtitle);
    const description = cleanText(
      body.match(/<p class="synopsis">([\s\S]*?)<\/p>/i)?.[1]
    );
    const thumbnail = body
      .match(/background-image:\s*url\(['"]?([^'")\s]+)['"]?\)/i)?.[1]
      ?.replace(/\\+/g, '');

    parsed.push({
      title,
      subtitle,
      description,
      thumbnail,
      startTime: start.toISOString(),
      startMs: start.getTime(),
      season,
      episode,
    });
  }

  return parsed.map((program, index) => {
    const next = parsed[index + 1];
    const endMs = next ? next.startMs : program.startMs + 60 * 60 * 1000;
    return {
      title: program.title,
      subtitle: program.subtitle,
      description: program.description,
      thumbnail: program.thumbnail,
      startTime: program.startTime,
      endTime: new Date(endMs).toISOString(),
      season: program.season,
      episode: program.episode,
    };
  });
}

async function fetchHtml(
  url: string,
  timeout: number
): Promise<string | undefined> {
  const response = await makeRequest(url, {
    timeout,
    headers: REQUEST_HEADERS,
  });
  if (!response.ok) return undefined;
  try {
    return await response.text();
  } catch {
    return undefined;
  }
}

async function loadChannels(config: MiTvConfig): Promise<MiTvChannel[]> {
  const cached = await channelCache.get(config.country);
  if (cached) return cached;

  const html = await fetchHtml(
    `${SITE_ORIGIN}/${config.country}/sitemap`,
    config.timeout
  );
  const channels = parseMiTvSitemap(html ?? '', config.country);
  await channelCache.set(config.country, channels, SOURCE_CACHE_TTL);
  return channels;
}

async function loadSchedule(
  config: MiTvConfig,
  slug: string,
  date: string
): Promise<MiTvProgram[]> {
  const cacheKey = `${config.country}:${slug}:${date}`;
  const cached = await scheduleCache.get(cacheKey);
  if (cached) return cached;

  const html = await fetchHtml(
    `${SITE_ORIGIN}/${config.country}/async/channel/${encodeURIComponent(slug)}/${date}/0`,
    config.timeout
  );
  const country = miTvCountry(config.country);
  const programs = parseMiTvListings(html ?? '', date, country.timeZone);
  await scheduleCache.set(cacheKey, programs, SCHEDULE_CACHE_TTL);
  return programs;
}

function programToChannelVideo(
  encodedId: string,
  program: MiTvProgram,
  timeShiftMinutes: number
) {
  const { startTime, endTime } = applyEpgTimeShift(
    program.startTime,
    program.endTime,
    timeShiftMinutes
  );
  return {
    ...programToVideo({
      channelEncodedId: encodedId,
      title: program.title,
      subtitle: program.subtitle,
      description: program.description,
      thumbnail: program.thumbnail,
      startTime,
      endTime,
      categories:
        program.season === undefined && program.subtitle
          ? [program.subtitle]
          : undefined,
    }),
    season: program.season,
    episode: program.episode,
  };
}

export class MiTvAddon {
  private readonly config: MiTvConfig;

  constructor(config: z.input<typeof MiTvConfigSchema>) {
    this.config = MiTvConfigSchema.parse(config);
  }

  private countryMeta() {
    return miTvCountry(this.config.country);
  }

  getManifest(): Manifest {
    const country = this.countryMeta();
    return {
      id: 'org.aiolivetv.mi-tv',
      name: `Mi.tv (${country.name})`,
      version: '1.0.0',
      description: `Canais e programação EPG da Mi.tv para ${country.name}.`,
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
          id: 'mi-tv-channels',
          type: TV_TYPE,
          name: `Canais Mi.tv (${country.name})`,
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
          id: encodeChannelId(
            miTvChannelKey(this.config.country, channel.slug)
          ),
          name: channel.name,
          poster: channel.logo,
          tvgId: channel.tvgId,
          country: this.config.country.toUpperCase(),
          language: country.language,
        })
      );
  }

  async getCatalogGuide(skip = 0, date?: string): Promise<Meta[]> {
    const guideDate = resolveGuideDate(date);
    const country = this.countryMeta();
    const channels = (await loadChannels(this.config)).slice(
      skip,
      skip + LIVE_TV_CATALOG_PAGE_SIZE
    );
    const limit = pLimit(FETCH_CONCURRENCY);
    const schedules = await Promise.all(
      channels.map((channel) =>
        limit(() => loadSchedule(this.config, channel.slug, guideDate))
      )
    );

    return channels.map((channel, index) => {
      const encodedId = encodeChannelId(
        miTvChannelKey(this.config.country, channel.slug)
      );
      const videos = (schedules[index] ?? []).map((program) =>
        programToChannelVideo(encodedId, program, this.config.timeShiftMinutes)
      );
      return guideChannelMeta(
        {
          id: encodedId,
          name: channel.name,
          logo: channel.logo,
          country: this.config.country.toUpperCase(),
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
    const key = decodeChannelId(id);
    const expectedPrefix = `${this.config.country}#`;
    const slug = key.startsWith(expectedPrefix)
      ? key.slice(expectedPrefix.length)
      : key;
    const channels = await loadChannels(this.config);
    const channel = channels.find((item) => item.slug === slug);
    if (!channel) throw new Error(`Channel not found: ${slug}`);

    const country = this.countryMeta();
    const guideDate = resolveGuideDate();
    const programs = await loadSchedule(this.config, channel.slug, guideDate);
    const encodedId = encodeChannelId(
      miTvChannelKey(this.config.country, channel.slug)
    );
    const videos = programs
      .map((program) =>
        programToChannelVideo(encodedId, program, this.config.timeShiftMinutes)
      )
      .sort((a, b) => (a.released ?? '').localeCompare(b.released ?? ''));

    return {
      id: encodedId,
      type: TV_TYPE,
      name: channel.name,
      poster: channel.logo,
      posterShape: 'square',
      country: this.config.country.toUpperCase(),
      language: country.language,
      behaviorHints: { hasScheduledVideos: true },
      videos,
    };
  }
}
