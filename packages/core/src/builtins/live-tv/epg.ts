import type { ContentRating, Meta, MetaPreview } from '../../db/index.js';
import { TV_TYPE } from '../../utils/constants.js';
import { programRuntime } from './shared.js';

export const LIVE_TV_CATALOG_PAGE_SIZE = 50;

export interface CatalogExtras {
  skip: number;
  date?: string;
}

export interface CatalogHandlerResponse {
  metas?: MetaPreview[];
  metasDetailed?: Meta[];
  cacheMaxAge?: number;
  staleRevalidate?: number;
  staleError?: number;
}

export interface EpgProgramVideoInput {
  channelEncodedId: string;
  title: string;
  subtitle?: string;
  description?: string;
  thumbnail?: string;
  startTime: string;
  endTime: string;
  airedYear?: string;
  categories?: string[];
  cast?: string[];
  directors?: string[];
  ratings?: ContentRating[];
}

export function toContentRatings(
  ratings?: Array<{ value?: string; system?: string; icon?: string }>
): ContentRating[] | undefined {
  const normalized = (ratings ?? [])
    .map((rating) => {
      const value = rating.value?.trim();
      if (!value) return undefined;
      const system = rating.system?.trim();
      const icon = rating.icon?.trim();
      return {
        value,
        ...(system ? { system } : {}),
        ...(icon ? { icon } : {}),
      };
    })
    .filter((rating): rating is ContentRating => Boolean(rating));
  return normalized.length ? normalized : undefined;
}

export function parseCatalogExtras(extras?: string): CatalogExtras {
  const params = new URLSearchParams(extras?.replace(/^\//, '') ?? '');
  return {
    skip: Math.max(
      0,
      Number.parseInt(params.get('skip') ?? '0', 10) || 0
    ),
    date: params.get('date') ?? undefined,
  };
}

export function resolveGuideDate(date?: string): string {
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return new Date().toISOString().slice(0, 10);
}

export function utcDayBounds(date: string): { start: string; end: string } {
  return {
    start: `${date}T00:00:00.000Z`,
    end: `${date}T23:59:59.999Z`,
  };
}

export function utcDayUnixBounds(date: string): { start: number; end: number } {
  const startMs = Date.parse(`${date}T00:00:00.000Z`);
  const endMs = Date.parse(`${date}T23:59:59.999Z`);
  return {
    start: Math.floor(startMs / 1000),
    end: Math.floor((endMs + 1) / 1000),
  };
}

export function applyEpgTimeShift(
  startTime: string,
  endTime: string,
  shiftMinutes = 0
): { startTime: string; endTime: string } {
  if (!shiftMinutes) return { startTime, endTime };
  const deltaMs = shiftMinutes * 60_000;
  return {
    startTime: new Date(Date.parse(startTime) + deltaMs).toISOString(),
    endTime: new Date(Date.parse(endTime) + deltaMs).toISOString(),
  };
}

export function shiftedProgramOverlapsUtcDay(
  program: { startTime: string; endTime: string },
  date: string,
  shiftMinutes = 0
): boolean {
  const shifted = applyEpgTimeShift(
    program.startTime,
    program.endTime,
    shiftMinutes
  );
  return programOverlapsUtcDay(shifted, date);
}

export function programOverlapsUtcDay(
  program: { startTime: string; endTime: string },
  date: string
): boolean {
  const { start, end } = utcDayBounds(date);
  return program.endTime > start && program.startTime < end;
}

export function programToVideo(input: EpgProgramVideoInput): NonNullable<
  Meta['videos']
>[number] {
  return {
    id: `${input.channelEncodedId}:epg:${input.startTime}`,
    title: input.title,
    subtitle: input.subtitle,
    overview: input.description,
    thumbnail: input.thumbnail,
    genres: input.categories,
    cast: input.cast,
    directors: input.directors,
    ratings: toContentRatings(input.ratings),
    released: input.startTime,
    releaseInfo: input.airedYear ?? input.startTime.slice(0, 4),
    runtime: programRuntime(input.startTime, input.endTime),
    startTime: input.startTime,
    endTime: input.endTime,
  } as NonNullable<Meta['videos']>[number];
}

export function guideChannelMeta(
  channel: {
    id: string;
    name: string;
    logo?: string;
    language?: string;
    country?: string;
    tvgId?: string;
    aliases?: string[];
  },
  videos: NonNullable<Meta['videos']>
): Meta {
  return {
    id: channel.id,
    type: TV_TYPE,
    name: channel.name,
    poster: channel.logo,
    logo: channel.logo,
    posterShape: 'landscape',
    language: channel.language,
    country: channel.country,
    tvgId: channel.tvgId,
    aliases: channel.aliases,
    behaviorHints: { hasScheduledVideos: true },
    videos,
  };
}

export function bareChannelPreview(channel: {
  id: string;
  name: string;
  poster?: string;
  tvgId?: string;
  aliases?: string[];
  language?: string;
  country?: string;
}): MetaPreview {
  return {
    id: channel.id,
    type: TV_TYPE,
    name: channel.name,
    poster: channel.poster,
    posterShape: 'landscape',
    tvgId: channel.tvgId,
    aliases: channel.aliases,
    language: channel.language,
    country: channel.country,
  };
}

export const EPG_CACHE_HEADERS = {
  cacheMaxAge: 300,
  staleRevalidate: 1800,
  staleError: 604800,
} as const;

export const EPG_GUIDE_CATALOG_EXTRAS = [
  { name: 'skip' },
  { name: 'date' },
] as const;

export async function buildEpgCatalogResponse(
  getBare: (skip: number) => Promise<MetaPreview[]>,
  getGuide: (skip: number, date: string) => Promise<Meta[]>,
  skip = 0,
  date?: string
): Promise<CatalogHandlerResponse> {
  if (date) {
    return {
      metasDetailed: await getGuide(skip, date),
      ...EPG_CACHE_HEADERS,
    };
  }
  return {
    metas: await getBare(skip),
    ...EPG_CACHE_HEADERS,
  };
}
