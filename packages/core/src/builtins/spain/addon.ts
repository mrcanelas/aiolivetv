import { z } from 'zod';
import type { Manifest, Meta, MetaPreview, Stream } from '../../db/index.js';
import { Cache } from '../../utils/index.js';
import { TV_TYPE } from '../../utils/constants.js';
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

const apiCache = Cache.getInstance<string, unknown>('spain-tv-api', 512);

async function cachedJson<T>(
  url: string,
  config: SpainTvConfig,
  ttl = 300
): Promise<T> {
  return apiCache.wrap(
    async () =>
      JSON.parse(await fetchSourceText({ ...config, sourceUrl: url })) as T,
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

