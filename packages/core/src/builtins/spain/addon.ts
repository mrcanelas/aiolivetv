import { z } from 'zod';
import type { Manifest, Meta, MetaPreview, Stream } from '../../db/index.js';
import { Cache } from '../../utils/index.js';
import { TV_TYPE } from '../../utils/constants.js';
import { APIError, ErrorCode } from '../../utils/constants.js';
import {
  applyEpgTimeShift,
  bareChannelPreview,
  buildEpgCatalogResponse,
  EPG_GUIDE_CATALOG_EXTRAS,
  guideChannelMeta,
  LIVE_TV_CATALOG_PAGE_SIZE,
  mapWithEpgConcurrency,
  programToVideo,
  resolveGuideDate,
  shiftedProgramOverlapsUtcDay,
} from '../live-tv/epg.js';
import {
  CHANNEL_ID_PREFIX,
  decodeChannelId,
  encodeChannelId,
  fetchSourceText,
} from '../live-tv/shared.js';
import { loadXmltv } from '../xmltv-reader/addon.js';
import { loadM3u, M3uAddon } from '../m3u-reader/addon.js';

export const SpainTvConfigSchema = z.object({
  timeout: z.number().int().positive(),
  timeShiftMinutes: z.number().int().default(0),
});
export type SpainTvConfig = z.infer<typeof SpainTvConfigSchema>;
type Videos = NonNullable<Meta['videos']>;

const ORANGE_API = 'https://pc.orangetv.orange.es/pc/api/rtv/v1';
const ORANGE_EPG = 'https://epg.orangetv.orange.es/epg/SmartTV_Android/1_PRO';
const MOVISTAR_API = 'https://ottcache.dof6.com/movistarplus/webplayer';
const TDT_PLAYLIST = 'https://www.tdtchannels.com/lists/tv.m3u';
const TDT_EPG = 'https://www.tdtchannels.com/epg/TV.xml.gz';
const apiCache = Cache.getInstance<string, unknown>('spain-tv-api', 512);

async function cachedJson<T>(
  url: string,
  config: SpainTvConfig,
  ttl = 300
): Promise<T> {
  return apiCache.wrap(
    async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const text = await fetchSourceText({ ...config, sourceUrl: url });
        try {
          if (!text.trim()) throw new SyntaxError('Empty response');
          return JSON.parse(text) as T;
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          if (attempt === 1) {
            throw new APIError(
              ErrorCode.INTERNAL_SERVER_ERROR,
              502,
              `The TV provider returned empty or invalid JSON (${new URL(url).hostname}). Please retry later or check the instance HTTP proxy settings.`
            );
          }
        }
      }
      throw new Error('Unreachable JSON retry state');
    },
    url,
    ttl
  );
}

function manifest(
  id: string,
  name: string,
  epg: boolean,
  streams = false
): Manifest {
  return {
    id: `org.aiolivetv.${id}`,
    name,
    version: '1.0.0',
    types: [TV_TYPE],
    description: `${name} channels and programme metadata.`,
    resources: (streams
      ? (['catalog', 'meta', 'stream'] as const)
      : (['catalog', 'meta'] as const)
    ).map((name) => ({
      name,
      types: [TV_TYPE],
      idPrefixes: [CHANNEL_ID_PREFIX],
    })),
    catalogs: [
      {
        id: `${id}-channels`,
        type: TV_TYPE,
        name,
        extra: [...EPG_GUIDE_CATALOG_EXTRAS],
      },
    ],
    ...(epg ? { behaviorHints: { epgProvider: true } } : {}),
  };
}

function channelMeta(channel: MetaPreview, videos: Videos): Meta {
  const now = new Date().toISOString();
  const current = videos.find(
    (video) =>
      typeof video.startTime === 'string' &&
      typeof video.endTime === 'string' &&
      video.startTime <= now &&
      video.endTime > now
  );
  return {
    ...guideChannelMeta(
      {
        id: channel.id,
        name: channel.name || channel.id,
        logo:
          typeof channel.logo === 'string'
            ? channel.logo
            : channel.poster || undefined,
        tvgId: typeof channel.tvgId === 'string' ? channel.tvgId : undefined,
        country: typeof channel.country === 'string' ? channel.country : 'ES',
        language:
          typeof channel.language === 'string' ? channel.language : 'es',
        genres: channel.genres || undefined,
      },
      videos
    ),
    background:
      typeof current?.background === 'string' ? current.background : undefined,
    behaviorHints: { hasScheduledVideos: videos.length > 0 },
  };
}

function findChannel(channels: MetaPreview[], id: string): MetaPreview {
  const key = decodeChannelId(id);
  const channel = channels.find((item) => decodeChannelId(item.id) === key);
  if (!channel) throw new Error(`Channel not found: ${key}`);
  return channel;
}

function names(value?: string): string[] | undefined {
  return value
    ? value
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
    : undefined;
}

function positiveNumber(value?: string | number): number | undefined {
  if (value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function rating(value?: string) {
  if (!value || value === 'NR') return undefined;
  const normalized = value.replace(/^ML_/, '').replace(/^\+/, '');
  return [
    {
      system: 'CNMC',
      value: normalized === 'ALL' || normalized === '0' ? 'TP' : normalized,
    },
  ];
}

function madridDate(time: number) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date(time))
    .replaceAll('-', '');
}

function times(
  start: number | string,
  end: number | string,
  config: SpainTvConfig
) {
  const from = Number(start),
    to = Number(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= from)
    return undefined;
  const startDate = new Date(from),
    endDate = new Date(to);
  if (
    !Number.isFinite(startDate.getTime()) ||
    !Number.isFinite(endDate.getTime())
  )
    return undefined;
  return applyEpgTimeShift(
    startDate.toISOString(),
    endDate.toISOString(),
    config.timeShiftMinutes
  );
}

interface Attachment {
  name: string;
  value: string;
}
interface OrangeChannel {
  externalChannelId: string;
  name: string;
  attachments?: Attachment[];
  category?: string;
}
interface OrangeProgram {
  id: number;
  name: string;
  startDate: number;
  endDate: number;
  description?: string;
  seriesName?: string;
  seriesSeason?: string;
  episodeId?: string;
  genres?: Array<{ name: string }>;
  attachments?: Attachment[];
  prLevel?: number;
}
interface OrangeDetail extends OrangeProgram {
  prName?: string;
  year?: string;
  genreEntityList?: Array<{ name: string }>;
  contributors?: Array<{ firstName?: string; lastName?: string; role: string }>;
}
interface OrangeSegment {
  channelExternalId: string;
  programs: OrangeProgram[];
}

function orangeImage(attachments: Attachment[] | undefined, name: string) {
  const path = attachments?.find((item) => item.name === name)?.value;
  return path?.startsWith('/') ? `${ORANGE_API}/images${path}` : undefined;
}

async function orangeChannels(config: SpainTvConfig): Promise<MetaPreview[]> {
  const data = await cachedJson<{ response: OrangeChannel[] }>(
    `${ORANGE_API}/GetChannelList?bouquet_external_id=1_PRO&model_external_id=PC&filter_unsupported_channels=true&max_pr_level=8&client=json`,
    config
  );
  if (!Array.isArray(data.response))
    throw new Error('Orange TV returned an invalid channel list');
  return data.response
    .filter((item) => item.externalChannelId && item.name)
    .map((item) => ({
      ...bareChannelPreview({
        id: encodeChannelId(`orange-tv:${item.externalChannelId}`),
        name: item.name,
        poster: orangeImage(item.attachments, 'LOGO'),
        tvgId: item.name,
        country: 'ES',
        language: 'es',
        genres: item.category ? [item.category] : undefined,
      }),
      logo: orangeImage(item.attachments, 'LOGO'),
    }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'));
}

async function orangeSchedule(
  config: SpainTvConfig,
  date: string
): Promise<OrangeSegment[]> {
  // Orange partitions its guide by Madrid dates; a UTC day spans two files.
  const center =
    Date.parse(`${date}T00:00:00Z`) - config.timeShiftMinutes * 60_000;
  const dates = [...new Set([center, center + 86_400_000 - 1].map(madridDate))];
  const urls = dates.flatMap((day) =>
    [1, 2, 3].map((segment) => `${ORANGE_EPG}/${day}_8h_${segment}.json`)
  );
  const segments = await mapWithEpgConcurrency(
    urls,
    async (url) => {
      const data = await cachedJson<OrangeSegment[]>(url, config);
      if (!Array.isArray(data))
        throw new Error('Orange TV returned an invalid schedule');
      return data;
    },
    []
  );
  return segments.flat();
}

async function orangeVideos(
  config: SpainTvConfig,
  channel: MetaPreview,
  date: string,
  segments: OrangeSegment[],
  fullDetails = true
): Promise<Videos> {
  const channelId = decodeChannelId(channel.id).slice('orange-tv:'.length);
  const programs = [
    ...new Map(
      segments
        .filter((item) => String(item.channelExternalId) === channelId)
        .flatMap((item) => item.programs || [])
        .map((item) => [item.id, item])
    ).values(),
  ].filter((item) => {
    const timing = times(item.startDate, item.endDate, config);
    return item.name && timing && shiftedProgramOverlapsUtcDay(timing, date, 0);
  });
  const ratings = await cachedJson<{
    response: Array<{ level: number; name: string }>;
  }>(`${ORANGE_API}/GetParentalRatingList?client=json`, config, 86_400).catch(
    () => ({ response: [] })
  );
  const details = await mapWithEpgConcurrency(
    programs,
    async (item) => {
      const timing = times(item.startDate, item.endDate, config)!;
      const now = new Date().toISOString();
      if (!fullDetails && !(timing.startTime <= now && timing.endTime > now))
        return undefined;
      return cachedJson<{ response: OrangeDetail }>(
        `${ORANGE_API}/GetExtendedProgram?program_id=${item.id}&client=json`,
        config
      );
    },
    undefined
  );
  return programs
    .map((item, index) => {
      const detail = details[index]?.response;
      const contributors = detail?.contributors || [];
      const people = (role: string) =>
        contributors
          .filter((person) => person.role === role)
          .map((person) =>
            [person.firstName, person.lastName].filter(Boolean).join(' ')
          )
          .filter(Boolean);
      return programToVideo({
        channelEncodedId: channel.id,
        title: item.name,
        subtitle: item.seriesName,
        description: detail?.description || item.description,
        ...times(item.startDate, item.endDate, config)!,
        thumbnail: orangeImage(
          detail?.attachments || item.attachments,
          'COVER'
        ),
        background: orangeImage(detail?.attachments, 'BACKGROUND'),
        categories: (detail?.genreEntityList || item.genres || []).map(
          (genre) => genre.name
        ),
        cast: people('ACT'),
        directors: people('DIR'),
        airedYear: detail?.year || undefined,
        season: positiveNumber(item.seriesSeason),
        episode: positiveNumber(item.episodeId),
        ratings: rating(
          detail?.prName ||
            ratings.response?.find((r) => r.level === item.prLevel)?.name
        ),
      });
    })
    .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
}

export class OrangeTvAddon {
  private readonly config: SpainTvConfig;
  constructor(config: z.input<typeof SpainTvConfigSchema>) {
    this.config = SpainTvConfigSchema.parse(config);
  }
  async getManifest(): Promise<Manifest> {
    let epg = false;
    try {
      const [channels, blocks] = await Promise.all([
        orangeChannels(this.config),
        mapWithEpgConcurrency(
          [1, 2, 3],
          async (segment) => {
            const data = await cachedJson<OrangeSegment[]>(
              `${ORANGE_EPG}/${madridDate(Date.now())}_8h_${segment}.json`,
              this.config
            );
            return Array.isArray(data) ? data : [];
          },
          []
        ),
      ]);
      const segments = blocks.flat();
      const ids = new Set(
        channels.map((channel) =>
          decodeChannelId(channel.id).slice('orange-tv:'.length)
        )
      );
      epg =
        Array.isArray(segments) &&
        segments.some(
          (segment) =>
            ids.has(String(segment.channelExternalId)) &&
            segment.programs?.some((item) =>
              Boolean(
                item.name && times(item.startDate, item.endDate, this.config)
              )
            )
        );
    } catch {
      /* Catalog remains usable when the guide is unavailable. */
    }
    return manifest('orange-tv', 'Orange TV', epg);
  }
  async getCatalog(skip = 0) {
    return (await orangeChannels(this.config)).slice(
      skip,
      skip + LIVE_TV_CATALOG_PAGE_SIZE
    );
  }
  async getCatalogGuide(skip = 0, date?: string): Promise<Meta[]> {
    const guideDate = resolveGuideDate(date);
    const channels = await this.getCatalog(skip);
    const segments = await orangeSchedule(this.config, guideDate).catch(
      () => []
    );
    const videos = await mapWithEpgConcurrency(
      channels,
      (channel) =>
        orangeVideos(this.config, channel, guideDate, segments, false),
      []
    );
    return channels.map((channel, index) =>
      channelMeta(channel, videos[index])
    );
  }
  async getCatalogResponse(skip = 0, date?: string) {
    return buildEpgCatalogResponse(
      (page) => this.getCatalog(page),
      (page, day) => this.getCatalogGuide(page, day),
      skip,
      date
    );
  }
  async getMeta(id: string): Promise<Meta> {
    const channel = findChannel(await orangeChannels(this.config), id);
    const date = resolveGuideDate();
    const segments = await orangeSchedule(this.config, date).catch(() => []);
    return channelMeta(
      channel,
      await orangeVideos(this.config, channel, date, segments).catch(() => [])
    );
  }
}

interface MovistarChannel {
  CodCadenaTv: string;
  Nombre: string;
  Logo?: string;
}
interface MovistarProgram {
  Id: number;
  Titulo: string;
  TituloEpisodio?: string;
  FechaHoraInicio: string;
  FechaHoraFin: string;
  Ficha?: string;
  Resena?: string;
  Imagen?: string;
  Imagenes?: Array<{ id: string; uri: string }>;
  NivelMoral?: { Id?: string };
  GeneroComAntena?: string;
}
interface MovistarDetail {
  Descripcion?: string;
  Sinopsis?: string;
  Actores?: string;
  Directores?: string;
  Anno?: string;
  NumeroEpisodio?: string | number;
  Temporada?: string | number;
  NivelMoral?: { Id?: string };
  Genero?: { ComAntena?: string };
  Imagen?: string;
  Imagenes?: Array<{ id: string; uri: string }>;
}

async function movistarChannels(config: SpainTvConfig): Promise<MetaPreview[]> {
  const data = await cachedJson<MovistarChannel[]>(
    `${MOVISTAR_API}/OTT/contents/channels?mdrm=true&tlsstream=true&demarcation=18&version=8`,
    config
  );
  if (!Array.isArray(data))
    throw new Error('Movistar Plus+ returned an invalid channel list');
  return data
    .filter((item) => item.CodCadenaTv && item.Nombre)
    .map((item) => ({
      ...bareChannelPreview({
        id: encodeChannelId(`movistar-plus:${item.CodCadenaTv}`),
        name: item.Nombre,
        poster: item.Logo,
        tvgId: item.Nombre,
        country: 'ES',
        language: 'es',
      }),
      logo: item.Logo,
    }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'));
}

async function movistarSchedule(
  config: SpainTvConfig,
  channel: MetaPreview,
  date: string
) {
  const code = decodeChannelId(channel.id)
    .slice('movistar-plus:'.length)
    .toUpperCase();
  const from = new Date(
    Date.parse(`${date}T00:00:00Z`) - config.timeShiftMinutes * 60_000
  )
    .toISOString()
    .slice(0, 19);
  const url = `${MOVISTAR_API}/OTT/epg?from=${from}&span=1&channel=${encodeURIComponent(code)}&version=8&mdrm=true&tlsstream=true&demarcation=18`;
  const data = await cachedJson<MovistarProgram[]>(url, config);
  if (!Array.isArray(data))
    throw new Error('Movistar Plus+ returned an invalid schedule');
  return data.filter((item) => {
    const timing = times(item.FechaHoraInicio, item.FechaHoraFin, config);
    return (
      timing && item.Titulo && shiftedProgramOverlapsUtcDay(timing, date, 0)
    );
  });
}

async function movistarVideos(
  config: SpainTvConfig,
  channel: MetaPreview,
  date: string,
  fullDetails = true
): Promise<Videos> {
  const programs = await movistarSchedule(config, channel, date);
  const details = await mapWithEpgConcurrency(
    programs,
    async (item) => {
      const timing = times(item.FechaHoraInicio, item.FechaHoraFin, config)!;
      const now = new Date().toISOString();
      if (!fullDetails && !(timing.startTime <= now && timing.endTime > now))
        return undefined;
      if (
        !item.Ficha ||
        new URL(item.Ficha).origin !== new URL(MOVISTAR_API).origin
      )
        return undefined;
      return cachedJson<MovistarDetail>(item.Ficha, config);
    },
    undefined
  );
  return programs
    .map((item, index) => {
      const detail = details[index];
      const images = detail?.Imagenes || item.Imagenes || [];
      const image = (id: string) =>
        images.find((image) => image.id === id)?.uri;
      return programToVideo({
        channelEncodedId: channel.id,
        title: item.Titulo,
        subtitle: item.TituloEpisodio,
        description: detail?.Descripcion || detail?.Sinopsis || item.Resena,
        ...times(item.FechaHoraInicio, item.FechaHoraFin, config)!,
        thumbnail:
          image('watch2tgr-start') ||
          image('horizontal') ||
          detail?.Imagen ||
          item.Imagen,
        background: image('watch2tgr-end') || image('horizontal'),
        categories: [detail?.Genero?.ComAntena || item.GeneroComAntena].filter(
          (value): value is string => Boolean(value)
        ),
        cast: names(detail?.Actores),
        directors: names(detail?.Directores),
        airedYear: detail?.Anno,
        ratings: rating(detail?.NivelMoral?.Id || item.NivelMoral?.Id),
        season: positiveNumber(detail?.Temporada),
        episode: positiveNumber(detail?.NumeroEpisodio),
      });
    })
    .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
}

export class MovistarPlusAddon {
  private readonly config: SpainTvConfig;
  constructor(config: z.input<typeof SpainTvConfigSchema>) {
    this.config = SpainTvConfigSchema.parse(config);
  }
  async getManifest(): Promise<Manifest> {
    let epg = false;
    try {
      const channels = (await movistarChannels(this.config)).slice(0, 4);
      const schedules = await mapWithEpgConcurrency(
        channels,
        (channel) => movistarSchedule(this.config, channel, resolveGuideDate()),
        []
      );
      epg = schedules.some((programs) => programs.length > 0);
    } catch {
      /* Catalog remains usable when the guide is unavailable. */
    }
    return manifest('movistar-plus', 'Movistar Plus+ Spain', epg);
  }
  async getCatalog(skip = 0) {
    return (await movistarChannels(this.config)).slice(
      skip,
      skip + LIVE_TV_CATALOG_PAGE_SIZE
    );
  }
  async getCatalogGuide(skip = 0, date?: string): Promise<Meta[]> {
    const channels = await this.getCatalog(skip);
    const guideDate = resolveGuideDate(date);
    const videos = await mapWithEpgConcurrency(
      channels,
      (channel) => movistarVideos(this.config, channel, guideDate, false),
      []
    );
    return channels.map((channel, index) =>
      channelMeta(channel, videos[index])
    );
  }
  async getCatalogResponse(skip = 0, date?: string) {
    return buildEpgCatalogResponse(
      (page) => this.getCatalog(page),
      (page, day) => this.getCatalogGuide(page, day),
      skip,
      date
    );
  }
  async getMeta(id: string): Promise<Meta> {
    const channel = findChannel(await movistarChannels(this.config), id);
    const videos = await movistarVideos(
      this.config,
      channel,
      resolveGuideDate()
    ).catch(() => []);
    return channelMeta(channel, videos);
  }
}

async function tdtData(config: SpainTvConfig) {
  const [playlist, guide] = await Promise.all([
    loadM3u({ ...config, sourceUrl: TDT_PLAYLIST }).catch(() => undefined),
    loadXmltv({ ...config, sourceUrl: TDT_EPG }).catch(() => undefined),
  ]);
  if (!playlist && !guide)
    throw new Error('TDTChannels playlist and guide are unavailable');
  const channels: MetaPreview[] = guide?.programs.length
    ? guide.channels.map((channel) => {
        const entry = playlist?.entriesByChannelId.get(
          channel.id.toLowerCase()
        )?.[0];
        return bareChannelPreview({
          id: encodeChannelId(channel.id),
          name: entry?.name || channel.name,
          poster: entry?.logo || channel.logo,
          tvgId: channel.id,
          country: entry?.country || 'ES',
          language: entry?.language || 'es',
          genres: entry?.group ? [entry.group] : undefined,
        });
      })
    : playlist?.catalog || [];
  return {
    guide,
    channels: channels
      .map((channel) => ({
        ...channel,
        id: encodeChannelId(`tdtchannels:${decodeChannelId(channel.id)}`),
      }))
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es')),
  };
}

function tdtVideos(
  config: SpainTvConfig,
  channel: MetaPreview,
  date: string,
  guide: Awaited<ReturnType<typeof loadXmltv>> | undefined
): Videos {
  const rawId = decodeChannelId(channel.id).slice('tdtchannels:'.length);
  return (guide?.programsByChannelId.get(rawId) || [])
    .filter((program) =>
      shiftedProgramOverlapsUtcDay(program, date, config.timeShiftMinutes)
    )
    .map((program) =>
      programToVideo({
        channelEncodedId: channel.id,
        title: program.title,
        subtitle: program.subtitle,
        description: program.description,
        thumbnail: program.thumbnail,
        ...applyEpgTimeShift(
          program.startTime,
          program.endTime,
          config.timeShiftMinutes
        ),
        categories: program.categories,
        cast: program.cast,
        directors: program.directors,
        ratings: program.ratings,
        airedYear: program.released?.slice(0, 4),
      })
    );
}

export class TdtChannelsAddon {
  private readonly config: SpainTvConfig;
  constructor(config: z.input<typeof SpainTvConfigSchema>) {
    this.config = SpainTvConfigSchema.parse(config);
  }
  async getManifest(): Promise<Manifest> {
    let epg = false;
    try {
      epg = Boolean((await tdtData(this.config)).guide?.programs.length);
    } catch {
      /* A temporary source failure must not advertise Native EPG. */
    }
    return manifest('tdtchannels', 'TDTChannels', epg, true);
  }
  async getCatalog(skip = 0) {
    return (await tdtData(this.config)).channels.slice(
      skip,
      skip + LIVE_TV_CATALOG_PAGE_SIZE
    );
  }
  async getCatalogGuide(skip = 0, date?: string): Promise<Meta[]> {
    const { channels, guide } = await tdtData(this.config);
    const day = resolveGuideDate(date);
    return channels
      .slice(skip, skip + LIVE_TV_CATALOG_PAGE_SIZE)
      .map((channel) =>
        channelMeta(channel, tdtVideos(this.config, channel, day, guide))
      );
  }
  async getCatalogResponse(skip = 0, date?: string) {
    return buildEpgCatalogResponse(
      (page) => this.getCatalog(page),
      (page, day) => this.getCatalogGuide(page, day),
      skip,
      date
    );
  }
  async getMeta(id: string): Promise<Meta> {
    const { channels, guide } = await tdtData(this.config);
    const channel = findChannel(channels, id);
    return channelMeta(
      channel,
      tdtVideos(this.config, channel, resolveGuideDate(), guide)
    );
  }
  async getStreams(id: string): Promise<Stream[]> {
    const raw = decodeChannelId(id);
    if (!raw.startsWith('tdtchannels:')) return [];
    return new M3uAddon({ ...this.config, sourceUrl: TDT_PLAYLIST }).getStreams(
      encodeChannelId(raw.slice('tdtchannels:'.length))
    );
  }
}
