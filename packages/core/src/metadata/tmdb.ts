import { Headers } from 'undici';
import {
  appConfig,
  Cache,
  makeRequest,
  ParsedId,
  IdType,
  withTimeout,
} from '../utils/index.js';
import { deduplicateTitles, Metadata, MetadataTitle } from './utils.js';
import { iso31661ToIso6391 } from '../utils/languages.js';
import { z } from 'zod';
import pLimit from 'p-limit';
import type { Meta, UserData } from '../db/index.js';
import { normaliseTitle } from '../parser/utils.js';

export type TMDBIdType = 'imdb_id' | 'tmdb_id' | 'tvdb_id';

export interface EpgTmdbQuery {
  title: string;
  mediaType: 'movie' | 'tv';
  year?: number;
  tmdbId?: number;
  imdbId?: string;
  season?: number;
  episode?: number;
  language: string;
}

interface EpgTmdbMetadata {
  overview?: string;
  thumbnail?: string;
  background?: string;
  genres?: string[];
  cast?: string[];
  directors?: string[];
  subtitle?: string;
}

const EpgTitleSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().optional(),
  original_title: z.string().optional(),
  name: z.string().optional(),
  original_name: z.string().optional(),
  release_date: z.string().optional(),
  first_air_date: z.string().optional(),
});
const EpgDetailsSchema = EpgTitleSchema.extend({
  overview: z.string().nullish(),
  poster_path: z.string().nullish(),
  backdrop_path: z.string().nullish(),
  genres: z.array(z.object({ name: z.string() })).optional(),
  credits: z
    .object({
      cast: z.array(z.object({ name: z.string() })).optional(),
      crew: z.array(z.object({ name: z.string(), job: z.string() })).optional(),
    })
    .optional(),
});

export function matchesEpgTmdbTitle(
  candidate: z.infer<typeof EpgTitleSchema>,
  query: EpgTmdbQuery
) {
  const titleMatches = [
    candidate.title,
    candidate.original_title,
    candidate.name,
    candidate.original_name,
  ].some(
    (title) => title && normaliseTitle(title) === normaliseTitle(query.title)
  );
  const year = Number(
    (candidate.release_date ?? candidate.first_air_date)?.slice(0, 4)
  );
  return Boolean(titleMatches && (!query.year || year === query.year));
}

const epgLookupLimit = pLimit(4);
const pendingEpgLookups = new Map<string, Promise<EpgTmdbMetadata | null>>();

export async function enrichEpgVideos<
  T extends NonNullable<Meta['videos']>[number],
>(videos: T[], userData: UserData): Promise<T[]> {
  if (!userData.enrichEpgWithTmdb || !videos.length) return videos;
  let client: TMDBMetadata;
  try {
    client = new TMDBMetadata({
      apiKey: userData.tmdbApiKey,
      accessToken: userData.tmdbAccessToken,
    });
  } catch {
    return videos;
  }
  // Bound work per page; large guides should never enqueue a whole country's schedule.
  const targets = new Set(
    videos
      .filter(
        (video) =>
          typeof video.startTime === 'string' &&
          typeof video.endTime === 'string' &&
          Number.isFinite(Date.parse(video.startTime)) &&
          Date.parse(video.endTime) > Date.parse(video.startTime)
      )
      .sort(
        (a, b) =>
          Math.abs(Date.parse(String(a.startTime)) - Date.now()) -
          Math.abs(Date.parse(String(b.startTime)) - Date.now())
      )
      .slice(0, 24)
  );
  return withTimeout(
    async () =>
      Promise.all(
        videos.map(async (video) => {
          if (!targets.has(video) || typeof video.title !== 'string')
            return video;
          const categories = Array.isArray(video.genres)
            ? video.genres
                .filter((genre): genre is string => typeof genre === 'string')
                .map(normaliseTitle)
            : [];
          const mediaType =
            video.mediaType === 'movie' ||
            categories.some((genre) =>
              ['movie', 'film', 'filme', 'pelicula'].includes(genre)
            )
              ? 'movie'
              : video.mediaType === 'tv' ||
                  (typeof video.season === 'number' &&
                    typeof video.episode === 'number')
                ? 'tv'
                : undefined;
          if (!mediaType) return video;
          const year = Number(video.productionYear);
          const tmdbId = Number(video.tmdbId);
          const query: EpgTmdbQuery = {
            title: video.title.replace(/\s*\((?:19|20)\d{2}\)\s*$/, '').trim(),
            mediaType,
            year:
              mediaType === 'movie' &&
              Number.isInteger(year) &&
              year >= 1800 &&
              year <= 2200
                ? year
                : undefined,
            tmdbId: Number.isInteger(tmdbId) && tmdbId > 0 ? tmdbId : undefined,
            imdbId:
              typeof video.imdbId === 'string' && /^tt\d+$/.test(video.imdbId)
                ? video.imdbId
                : undefined,
            season: video.season ?? undefined,
            episode: video.episode ?? undefined,
            language: userData.epgMetadataLanguage ?? 'en-US',
          };
          try {
            const metadata = await client.getEpgMetadata(query);
            if (!metadata) return video;
            const result = { ...video };
            for (const [field, value] of Object.entries(metadata)) {
              const existing = result[field];
              if (
                (existing === undefined ||
                  existing === null ||
                  existing === '' ||
                  (Array.isArray(existing) && !existing.length)) &&
                value !== undefined
              ) {
                (result as Record<string, unknown>)[field] = value;
              }
            }
            return result;
          } catch {
            return video;
          }
        })
      ),
    videos,
    { timeout: 1500, getContext: () => 'optional TMDB EPG enrichment' }
  );
}

export async function enrichEpgMetas<T extends Meta>(
  metas: T[],
  userData: UserData
): Promise<T[]> {
  if (!userData.enrichEpgWithTmdb) return metas;
  const videos = metas.flatMap((meta) => meta.videos ?? []);
  const enriched = await enrichEpgVideos(videos, userData);
  let offset = 0;
  return metas.map((meta) => {
    const count = meta.videos?.length ?? 0;
    const result = count
      ? { ...meta, videos: enriched.slice(offset, offset + count) }
      : meta;
    offset += count;
    return result;
  });
}

// interface ExternalId {
//   type: ExternalIdType;
//   value: string;
// }

const API_BASE_URL = 'https://api.themoviedb.org/3';
const FIND_BY_ID_PATH = '/find';
const MOVIE_DETAILS_PATH = '/movie';
const MOVIE_TRANSLATIONS_PATH = (id: string) => `/movie/${id}/translations`;
const TV_DETAILS_PATH = '/tv';
const TV_TRANSLATIONS_PATH = (id: string) => `/tv/${id}/translations`;
const ALTERNATIVE_TITLES_PATH = '/alternative_titles';

// Cache TTLs in seconds
const ID_CACHE_TTL = 30 * 24 * 60 * 60; // 30 days
const TITLE_CACHE_TTL = 7 * 24 * 60 * 60; // 7 days
const AUTHORISATION_CACHE_TTL = 2 * 24 * 60 * 60; // 2 days

// Zod schemas for API responses
const GenreSchema = z.object({
  id: z.number(),
  name: z.string(),
});

const MovieDetailsSchema = z.object({
  id: z.number(),
  title: z.string(),
  release_date: z.string().optional(),
  status: z.string(),
  original_title: z.string().optional(),
  original_language: z.string().optional(),
  runtime: z.number().nullable().optional(),
  genres: z.array(GenreSchema).optional(),
});

const TVDetailsSchema = z.object({
  id: z.number(),
  name: z.string(),
  first_air_date: z.string().nullable().optional(),
  last_air_date: z.string().nullable().optional(),
  status: z.string(),
  original_title: z.string().optional(),
  original_language: z.string().optional(),
  episode_run_time: z.array(z.number()).optional(),
  seasons: z.array(
    z.object({
      season_number: z.number(),
      episode_count: z.number(),
    })
  ),
  genres: z.array(GenreSchema).optional(),
});

const MovieAlternativeTitlesSchema = z.object({
  titles: z.array(
    z.object({
      title: z.string(),
      iso_3166_1: z.string(),
    })
  ),
});

const TVAlternativeTitlesSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      iso_3166_1: z.string(),
    })
  ),
});

const TranslationsSchema = z.object({
  id: z.number(),
  translations: z.array(
    z.object({
      iso_3166_1: z.string(),
      iso_639_1: z.string(),
      name: z.string(),
      english_name: z.string(),
      data: z.object({
        title: z.string().optional(),
        name: z.string().optional(),
      }),
    })
  ),
});

const FindResultsSchema = z.object({
  movie_results: z.array(
    z.object({
      id: z.number(),
    })
  ),
  tv_results: z.array(
    z.object({
      id: z.number(),
    })
  ),
});

const ReleaseDateSchema = z.object({
  release_date: z.string(),
  type: z.number().min(0).max(6),
});

export type ReleaseDate = z.infer<typeof ReleaseDateSchema>;

const ReleaseDatesResponseSchema = z.object({
  id: z.number(),
  results: z.array(
    z.object({
      iso_3166_1: z.string(),
      release_dates: z.array(ReleaseDateSchema),
    })
  ),
});

const TVEpisodeDetailsSchema = z.object({
  id: z.number(),
  air_date: z.string().nullable().optional(),
  episode_number: z.number(),
  name: z.string(),
  overview: z.string().optional(),
  season_number: z.number(),
  still_path: z.string().nullable().optional(),
  runtime: z.number().nullable().optional(),
});

const IdTypeMap: Partial<Record<IdType, TMDBIdType>> = {
  imdbId: 'imdb_id',
  thetvdbId: 'tvdb_id',
  themoviedbId: 'tmdb_id',
};

export class TMDBMetadata {
  private static readonly epgCache = Cache.getInstance<
    string,
    { metadata: EpgTmdbMetadata | null }
  >('tmdb_epg_metadata');
  private readonly TMDB_ID_REGEX = /^(?:tmdb)[-:](\d+)(?::\d+:\d+)?$/;
  private readonly TVDB_ID_REGEX = /^(?:tvdb)[-:](\d+)(?::\d+:\d+)?$/;
  private readonly IMDB_ID_REGEX = /^(?:tt)(\d+)(?::\d+:\d+)?$/;
  private static readonly idCache: Cache<string, string> = Cache.getInstance<
    string,
    string
  >('tmdb_id_conversion');
  private static readonly metadataCache: Cache<string, Metadata> =
    Cache.getInstance<string, Metadata>('tmdb_metadata');
  private readonly accessToken: string | undefined;
  private readonly apiKey: string | undefined;
  private static readonly validationCache: Cache<string, boolean> =
    Cache.getInstance<string, boolean>('tmdb_validation');
  public constructor(auth?: { accessToken?: string; apiKey?: string }) {
    if (
      !auth?.accessToken &&
      !appConfig.metadata.tmdb.accessToken &&
      !auth?.apiKey &&
      !appConfig.metadata.tmdb.apiKey
    ) {
      throw new Error('TMDB Access Token or API Key is not set');
    }
    if (auth?.apiKey) {
      this.apiKey = auth.apiKey;
    } else if (auth?.accessToken) {
      this.accessToken = auth.accessToken;
    } else if (appConfig.metadata.tmdb.apiKey) {
      this.apiKey = appConfig.metadata.tmdb.apiKey;
    } else {
      this.accessToken = appConfig.metadata.tmdb.accessToken || undefined;
    }
  }

  private getHeaders(): Headers {
    const headers = new Headers();
    if (this.accessToken) {
      headers.set('Authorization', `Bearer ${this.accessToken}`);
    }
    headers.set('Content-Type', 'application/json');
    return headers;
  }

  public async getEpgMetadata(
    query: EpgTmdbQuery
  ): Promise<EpgTmdbMetadata | null> {
    const cacheKey = JSON.stringify(query);
    const cached = await TMDBMetadata.epgCache.get(cacheKey);
    if (cached) return cached.metadata;
    const pending = pendingEpgLookups.get(cacheKey);
    if (pending) return pending;
    const lookup = epgLookupLimit(async () => {
      const metadata = await this.fetchEpgMetadata(query);
      await TMDBMetadata.epgCache.set(
        cacheKey,
        { metadata },
        metadata ? TITLE_CACHE_TTL : 6 * 60 * 60
      );
      return metadata;
    });
    pendingEpgLookups.set(cacheKey, lookup);
    try {
      return await lookup;
    } finally {
      pendingEpgLookups.delete(cacheKey);
    }
  }

  private async fetchEpgJson(
    path: string,
    language: string,
    params: Record<string, string> = {}
  ): Promise<unknown> {
    const url = new URL(API_BASE_URL + path);
    this.addSearchParams(url);
    url.searchParams.set('language', language);
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, value);
    const response = await makeRequest(url.toString(), {
      timeout: 1000,
      headers: this.getHeaders(),
    });
    if (!response.ok)
      throw new Error(`TMDB EPG request failed: ${response.status}`);
    return response.json();
  }

  private async fetchEpgMetadata(
    query: EpgTmdbQuery
  ): Promise<EpgTmdbMetadata | null> {
    let id = query.tmdbId;
    if (!id && query.imdbId) {
      const found = FindResultsSchema.parse(
        await this.fetchEpgJson(`/find/${query.imdbId}`, query.language, {
          external_source: 'imdb_id',
        })
      );
      const results =
        query.mediaType === 'movie' ? found.movie_results : found.tv_results;
      if (results.length === 1) id = results[0].id;
    }
    if (!id) {
      // Broadcast years are not premiere years; only search with explicit content evidence.
      if (
        !query.year &&
        !(query.season !== undefined && query.episode !== undefined)
      )
        return null;
      const response = z
        .object({ results: z.array(EpgTitleSchema) })
        .parse(
          await this.fetchEpgJson(
            `/search/${query.mediaType}`,
            query.language,
            { query: query.title }
          )
        );
      const matches = response.results.filter((candidate) =>
        matchesEpgTmdbTitle(candidate, query)
      );
      if (matches.length !== 1) return null;
      id = matches[0].id;
    }
    const details = EpgDetailsSchema.parse(
      await this.fetchEpgJson(`/${query.mediaType}/${id}`, query.language, {
        append_to_response: 'credits',
      })
    );
    if (!matchesEpgTmdbTitle(details, query)) return null;
    const image = (path: string | null | undefined) =>
      path?.startsWith('/')
        ? `https://image.tmdb.org/t/p/w780${path}`
        : undefined;
    const metadata: EpgTmdbMetadata = {
      overview: details.overview || undefined,
      thumbnail: image(details.poster_path),
      background: image(details.backdrop_path),
      genres: details.genres?.map((genre) => genre.name),
      cast: details.credits?.cast?.slice(0, 10).map((person) => person.name),
      directors: details.credits?.crew
        ?.filter((person) => person.job === 'Director')
        .map((person) => person.name),
    };
    if (
      query.mediaType === 'tv' &&
      query.season !== undefined &&
      query.episode !== undefined
    ) {
      try {
        const episode = TVEpisodeDetailsSchema.parse(
          await this.fetchEpgJson(
            `/tv/${id}/season/${query.season}/episode/${query.episode}`,
            query.language
          )
        );
        metadata.subtitle = episode.name || undefined;
        metadata.overview = episode.overview || metadata.overview;
        metadata.thumbnail = image(episode.still_path) ?? metadata.thumbnail;
      } catch {
        // Series details remain useful when a provider's episode number is wrong.
      }
    }
    return metadata;
  }

  private async convertToTmdbId(parsedId: ParsedId): Promise<string> {
    if (parsedId.type === 'themoviedbId') {
      return parsedId.value.toString();
    }

    // Check cache first
    const cacheKey = `${parsedId.type}:${parsedId.value}:${parsedId.mediaType}`;
    const cachedId = await TMDBMetadata.idCache.get(cacheKey);
    if (cachedId) {
      return cachedId;
    }

    const url = new URL(API_BASE_URL + FIND_BY_ID_PATH + `/${parsedId.value}`);
    url.searchParams.set('external_source', `${IdTypeMap[parsedId.type]}`);
    this.addSearchParams(url);
    const response = await makeRequest(url.toString(), {
      timeout: 5000,
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`${response.status} - ${response.statusText}`);
    }

    const data = FindResultsSchema.parse(await response.json());
    const results =
      parsedId.mediaType === 'movie' ? data.movie_results : data.tv_results;
    const meta = results[0];

    if (!meta) {
      throw new Error(
        `No ${parsedId.mediaType} metadata found for ID: ${parsedId.type}:${parsedId.value}`
      );
    }

    const tmdbId = meta.id.toString();
    // Cache the result
    TMDBMetadata.idCache.set(cacheKey, tmdbId, ID_CACHE_TTL);
    return tmdbId;
  }

  private parseReleaseDate(releaseDate: string | undefined): string {
    if (!releaseDate) return '0';
    const date = new Date(releaseDate);
    return date.getFullYear().toString();
  }

  private async fetchAlternativeTitles(
    url: URL,
    mediaType: string
  ): Promise<MetadataTitle[]> {
    const response = await makeRequest(url.toString(), {
      timeout: 5000,
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch alternative titles: ${response.statusText}`
      );
    }

    const json = await response.json();

    if (mediaType === 'movie') {
      const data = MovieAlternativeTitlesSchema.parse(json);
      return data.titles
        .filter((t) => t.title)
        .map((title) => ({
          title: title.title,
          language: iso31661ToIso6391(title.iso_3166_1) || undefined,
        }));
    } else {
      const data = TVAlternativeTitlesSchema.parse(json);
      return data.results
        .filter((t) => t.title)
        .map((title) => ({
          title: title.title,
          language: iso31661ToIso6391(title.iso_3166_1) || undefined,
        }));
    }
  }

  private async fetchTranslatedTitles(
    url: URL,
    mediaType: string
  ): Promise<MetadataTitle[]> {
    const response = await makeRequest(url.toString(), {
      timeout: 5000,
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch translations: ${response.statusText}`);
    }

    const json = await response.json();
    const data = TranslationsSchema.parse(json);
    return data.translations
      .map((translation) => {
        const title = translation.data.title || translation.data.name;
        if (!title) return null;
        return {
          title,
          language: translation.iso_639_1 || undefined,
        } as MetadataTitle;
      })
      .filter((t): t is MetadataTitle => t !== null);
  }

  public async getMetadata(parsedId: ParsedId): Promise<Metadata> {
    if (!['movie', 'series', 'anime'].includes(parsedId.mediaType)) {
      throw new Error(`Invalid media type: ${parsedId.mediaType}`);
    }
    if (!['imdbId', 'thetvdbId', 'themoviedbId'].includes(parsedId.type)) {
      throw new Error(`Invalid ID type: ${parsedId.type}`);
    }

    const tmdbId = await this.convertToTmdbId(parsedId);

    // Check cache first
    const cacheKey = `${tmdbId}:${parsedId.mediaType}`;
    const cachedMetadata = await TMDBMetadata.metadataCache.get(cacheKey);
    if (cachedMetadata) {
      if (
        cachedMetadata.titles &&
        Array.isArray(cachedMetadata.titles) &&
        cachedMetadata.titles.every((t) => typeof t === 'string')
      ) {
        cachedMetadata.titles = cachedMetadata.titles.map((title) => ({
          title: title,
          language: undefined,
        }));
      }
      return { ...cachedMetadata, tmdbId: Number(tmdbId) };
    }

    // Fetch primary title from details endpoint
    const detailsUrl = new URL(
      API_BASE_URL +
        (parsedId.mediaType === 'movie'
          ? MOVIE_DETAILS_PATH
          : TV_DETAILS_PATH) +
        `/${tmdbId}`
    );
    this.addSearchParams(detailsUrl);
    const detailsResponse = await makeRequest(detailsUrl.toString(), {
      timeout: 5000,
      headers: this.getHeaders(),
    });

    if (!detailsResponse.ok) {
      throw new Error(`Failed to fetch details: ${detailsResponse.statusText}`);
    }

    const detailsJson = await detailsResponse.json();

    // Parse and extract data based on media type
    let primaryTitle: string;
    let releaseDate: string | undefined;
    let yearEnd: string | undefined;
    let seasons:
      | Array<{ season_number: number; episode_count: number }>
      | undefined;
    let allTitles: MetadataTitle[] = [];
    let originalLanguage: string | undefined;
    let runtime: number | undefined;
    let genres: string[] = [];

    if (parsedId.mediaType === 'movie') {
      const movieData = MovieDetailsSchema.parse(detailsJson);
      if (movieData.original_title) {
        allTitles.push({
          title: movieData.original_title,
          language: movieData.original_language,
        });
      } else {
        allTitles.push({
          title: movieData.title,
          language: 'en',
        });
      }
      primaryTitle =
        movieData.original_language !== 'en'
          ? (movieData.original_title ?? movieData.title)
          : movieData.title;

      originalLanguage = movieData.original_language;
      releaseDate = movieData.release_date;
      runtime = movieData.runtime || undefined;
      genres = movieData.genres?.map((g) => g.name) ?? [];
    } else {
      const tvData = TVDetailsSchema.parse(detailsJson);
      if (tvData.original_title) {
        allTitles.push({
          title: tvData.original_title,
          language: tvData.original_language,
        });
      } else {
        allTitles.push({
          title: tvData.name,
          language: 'en',
        });
      }
      primaryTitle =
        tvData.original_language !== 'en'
          ? (tvData.original_title ?? tvData.name)
          : tvData.name;
      originalLanguage = tvData.original_language;
      releaseDate = tvData.first_air_date ?? undefined;
      yearEnd = tvData.last_air_date
        ? this.parseReleaseDate(tvData.last_air_date)
        : undefined;
      seasons = tvData.seasons;
      if (tvData.episode_run_time && tvData.episode_run_time.length > 0) {
        // Calculate average runtime
        runtime = Math.round(
          tvData.episode_run_time.reduce((a, b) => a + b, 0) /
            tvData.episode_run_time.length
        );
      }
      genres = tvData.genres?.map((g) => g.name) ?? [];
    }

    const year = this.parseReleaseDate(releaseDate);

    // Fetch alternative titles and translations in parallel
    const altTitlesUrl = new URL(
      API_BASE_URL +
        (parsedId.mediaType === 'movie'
          ? MOVIE_DETAILS_PATH
          : TV_DETAILS_PATH) +
        `/${tmdbId}` +
        ALTERNATIVE_TITLES_PATH
    );
    const translatedTitlesUrl = new URL(
      API_BASE_URL +
        (parsedId.mediaType === 'movie'
          ? MOVIE_TRANSLATIONS_PATH(tmdbId)
          : TV_TRANSLATIONS_PATH(tmdbId))
    );
    this.addSearchParams(altTitlesUrl);
    this.addSearchParams(translatedTitlesUrl);

    const [altTitlesResult, translationsResult] = await Promise.allSettled([
      this.fetchAlternativeTitles(altTitlesUrl, parsedId.mediaType),
      this.fetchTranslatedTitles(translatedTitlesUrl, parsedId.mediaType),
    ]);

    if (altTitlesResult.status === 'fulfilled') {
      allTitles.push(...altTitlesResult.value);
    }

    if (translationsResult.status === 'fulfilled') {
      allTitles.push(...translationsResult.value);
    }

    // If both requests failed, we should throw an error
    if (
      altTitlesResult.status === 'rejected' &&
      translationsResult.status === 'rejected'
    ) {
      throw new Error(
        `Failed to fetch both alternative titles and translations: ${altTitlesResult.reason}, ${translationsResult.reason}`
      );
    }

    const uniqueTitles = deduplicateTitles(allTitles);
    const metadata: Metadata = {
      title: primaryTitle,
      titles: uniqueTitles,
      releaseDate: releaseDate,
      year: Number(year),
      yearEnd: yearEnd ? Number(yearEnd) : undefined,
      originalLanguage,
      seasons,
      tmdbId: Number(tmdbId),
      tvdbId: null,
      runtime: runtime,
      genres: genres.length > 0 ? genres : undefined,
    };
    // Cache the result
    TMDBMetadata.metadataCache.set(cacheKey, metadata, TITLE_CACHE_TTL);
    return { ...metadata, tmdbId: Number(tmdbId) };
  }

  private addSearchParams(url: URL) {
    if (this.apiKey) {
      url.searchParams.set('api_key', this.apiKey);
    }
  }

  public async getReleaseDates(tmdbId: number): Promise<ReleaseDate[]> {
    const url = new URL(API_BASE_URL + `/movie/${tmdbId}/release_dates`);
    this.addSearchParams(url);
    const response = await makeRequest(url.toString(), {
      timeout: 5000,
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch release dates: ${response.statusText}`);
    }
    const json = await response.json();
    const data = ReleaseDatesResponseSchema.parse(json);
    return data.results.flatMap((result) => result.release_dates);
  }

  public async getEpisodeDetails(
    tmdbId: number,
    seasonNumber: number,
    episodeNumber: number
  ): Promise<{ airDate?: string; runtime?: number } | undefined> {
    const url = new URL(
      API_BASE_URL +
        `/tv/${tmdbId}/season/${seasonNumber}/episode/${episodeNumber}`
    );
    this.addSearchParams(url);
    const response = await makeRequest(url.toString(), {
      timeout: 5000,
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      throw new Error(
        `Failed to fetch episode details: ${response.statusText}`
      );
    }
    const json = await response.json();
    const episodeData = TVEpisodeDetailsSchema.parse(json);
    return {
      airDate: episodeData.air_date ?? undefined,
      runtime: episodeData.runtime ?? undefined,
    };
  }

  public async getNextEpisodeAirDate(
    tmdbId: number,
    currentSeason: number,
    currentEpisode: number,
    seasons?: Array<{ season_number: number; episode_count: number }>
  ): Promise<string | undefined> {
    if (!seasons || seasons.length === 0) {
      return undefined;
    }

    const currentSeasonData = seasons.find(
      (s) => s.season_number === currentSeason
    );
    if (!currentSeasonData) {
      return undefined;
    }

    let nextSeason = currentSeason;
    let nextEpisode = currentEpisode + 1;

    if (nextEpisode > currentSeasonData.episode_count) {
      const nextSeasonData = seasons
        .filter((s) => s.season_number > currentSeason)
        .sort((a, b) => a.season_number - b.season_number)[0];

      if (!nextSeasonData || nextSeasonData.episode_count === 0) {
        return undefined;
      }

      nextSeason = nextSeasonData.season_number;
      nextEpisode = 1;
    }

    return this.getEpisodeDetails(tmdbId, nextSeason, nextEpisode).then(
      (details) => details?.airDate
    );
  }

  public async validateAuthorisation() {
    const cacheKey = this.accessToken || this.apiKey;
    if (!cacheKey) {
      throw new Error('TMDB Access Token or API Key is not set');
    }
    const cachedResult = await TMDBMetadata.validationCache.get(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }
    const url = new URL(API_BASE_URL + '/authentication');
    this.addSearchParams(url);
    const validationResponse = await makeRequest(url.toString(), {
      timeout: 3500,
      headers: this.getHeaders(),
    });
    if (!validationResponse.ok) {
      throw new Error(
        `Got HTTP error during validation, ensure a valid access token or API key was set: ${validationResponse.status} - ${validationResponse.statusText}`
      );
    }
    const validationData = (await validationResponse.json()) as {
      success: boolean;
    };
    const isValid = validationData.success;
    TMDBMetadata.validationCache.set(
      cacheKey,
      isValid,
      AUTHORISATION_CACHE_TTL
    );
    return isValid;
  }
}
