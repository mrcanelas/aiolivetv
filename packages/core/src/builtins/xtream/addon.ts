import { z } from 'zod';
import type { StandardXtreamChannel } from '@iptv/xtream-api/standardized';
import type { StandardXtreamFullEPGListing } from '@iptv/xtream-api/standardized';
import type { Manifest, Meta, MetaPreview, Stream } from '../../db/index.js';
import { TV_TYPE } from '../../utils/constants.js';
import { Cache } from '../../utils/index.js';
import { resolveNotWebReady } from '../../streams/web-readiness.js';
import {
  applyEpgTimeShift,
  bareChannelPreview,
  buildEpgCatalogResponse,
  EPG_GUIDE_CATALOG_EXTRAS,
  guideChannelMeta,
  LIVE_TV_CATALOG_PAGE_SIZE,
  programToVideo,
  resolveGuideDate,
  shiftedProgramOverlapsUtcDay,
  type CatalogHandlerResponse,
} from '../live-tv/epg.js';
import {
  CHANNEL_ID_PREFIX,
  decodeChannelId,
  encodeChannelId,
} from '../live-tv/shared.js';
import {
  createXtreamClient,
  loadXtreamChannels,
  streamExtension,
} from './client.js';
import { XtreamConfigSchema } from './config.js';

const CHANNELS_CACHE_TTL = 300;
const EPG_CACHE_TTL = 300;

const channelsCache = Cache.getInstance<string, StandardXtreamChannel[]>(
  'xtream-channels'
);
const epgCache = Cache.getInstance<string, StandardXtreamFullEPGListing[]>(
  'xtream-epg'
);

function channelsCacheKey(config: z.infer<typeof XtreamConfigSchema>): string {
  return `${config.url}:${config.username}:${config.categoryId ?? 'all'}`;
}

async function loadChannels(
  config: z.infer<typeof XtreamConfigSchema>
): Promise<StandardXtreamChannel[]> {
  const cacheKey = channelsCacheKey(config);
  const cached = await channelsCache.get(cacheKey);
  if (cached) return cached;
  const client = createXtreamClient(config);
  const channels = await loadXtreamChannels(client, config.categoryId);
  await channelsCache.set(cacheKey, channels, CHANNELS_CACHE_TTL);
  return channels;
}

function findChannel(
  channels: StandardXtreamChannel[],
  streamId: string
): StandardXtreamChannel | undefined {
  return channels.find((channel) => channel.id === streamId);
}

function channelTvgId(channel: StandardXtreamChannel): string {
  return channel.epgId || channel.id;
}

function sortedChannels(channels: StandardXtreamChannel[]): StandardXtreamChannel[] {
  return [...channels].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
}

function listingToVideo(
  encodedId: string,
  listing: StandardXtreamFullEPGListing,
  timeShiftMinutes: number
) {
  const { startTime, endTime } = applyEpgTimeShift(
    listing.start.toISOString(),
    listing.end.toISOString(),
    timeShiftMinutes
  );
  return programToVideo({
    channelEncodedId: encodedId,
    title: listing.title,
    description: listing.description || undefined,
    startTime,
    endTime,
    airedYear: startTime.slice(0, 4),
  });
}

async function loadChannelEpg(
  config: z.infer<typeof XtreamConfigSchema>,
  streamId: string
): Promise<StandardXtreamFullEPGListing[]> {
  const cacheKey = `${channelsCacheKey(config)}:${streamId}`;
  const cached = await epgCache.get(cacheKey);
  if (cached) return cached;
  const client = createXtreamClient(config);
  const listings = await client.getFullEPG({ channelId: streamId });
  await epgCache.set(cacheKey, listings, EPG_CACHE_TTL);
  return listings;
}

async function videosForGuideDay(
  config: z.infer<typeof XtreamConfigSchema>,
  encodedId: string,
  streamId: string,
  guideDate: string
) {
  const listings = await loadChannelEpg(config, streamId);
  return listings
    .filter((listing) =>
      shiftedProgramOverlapsUtcDay(
        {
          startTime: listing.start.toISOString(),
          endTime: listing.end.toISOString(),
        },
        guideDate,
        config.timeShiftMinutes
      )
    )
    .map((listing) => listingToVideo(encodedId, listing, config.timeShiftMinutes));
}

async function mapStream(
  config: z.infer<typeof XtreamConfigSchema>,
  channel: StandardXtreamChannel
): Promise<Stream> {
  const client = createXtreamClient(config);
  const url =
    channel.url ??
    client.generateStreamUrl({
      type: 'channel',
      streamId: channel.id,
      extension: streamExtension(config.preferredFormat),
    });
  if (!url) throw new Error(`Unable to build stream URL for channel ${channel.id}`);
  const stream: Stream = {
    url,
    name: channel.name,
    description: channel.epgId || undefined,
  };
  const notWebReady = await resolveNotWebReady(stream, { probe: true });
  return notWebReady
    ? { ...stream, behaviorHints: { notWebReady: true } }
    : stream;
}

export class XtreamAddon {
  private readonly config: z.infer<typeof XtreamConfigSchema>;

  constructor(config: z.input<typeof XtreamConfigSchema>) {
    this.config = XtreamConfigSchema.parse(config);
  }

  getManifest(): Manifest {
    return {
      id: 'org.aiolivetv.xtream',
      name: 'Xtream Codes',
      version: '1.0.0',
      description: 'Live TV channels, EPG and streams from an Xtream Codes provider',
      types: [TV_TYPE],
      resources: [
        {
          name: 'catalog',
          types: [TV_TYPE],
          idPrefixes: [CHANNEL_ID_PREFIX],
        },
        { name: 'meta', types: [TV_TYPE], idPrefixes: [CHANNEL_ID_PREFIX] },
        { name: 'stream', types: [TV_TYPE], idPrefixes: [CHANNEL_ID_PREFIX] },
      ],
      catalogs: [
        {
          id: 'xtream-channels',
          type: TV_TYPE,
          name: 'Channels',
          extra: [...EPG_GUIDE_CATALOG_EXTRAS],
        },
      ],
      behaviorHints: { epgProvider: true },
    };
  }

  async getCatalog(skip = 0): Promise<MetaPreview[]> {
    return sortedChannels(await loadChannels(this.config))
      .slice(skip, skip + LIVE_TV_CATALOG_PAGE_SIZE)
      .map((channel) =>
        bareChannelPreview({
          id: encodeChannelId(channel.id),
          name: channel.name,
          poster: channel.logo || undefined,
          tvgId: channelTvgId(channel),
        })
      );
  }

  async getCatalogGuide(skip = 0, date?: string): Promise<Meta[]> {
    const guideDate = resolveGuideDate(date);
    const channels = sortedChannels(await loadChannels(this.config)).slice(
      skip,
      skip + LIVE_TV_CATALOG_PAGE_SIZE
    );
    return Promise.all(
      channels.map(async (channel) => {
        const encodedId = encodeChannelId(channel.id);
        const videos = await videosForGuideDay(
          this.config,
          encodedId,
          channel.id,
          guideDate
        );
        return guideChannelMeta(
          {
            id: encodedId,
            name: channel.name,
            logo: channel.logo || undefined,
          },
          videos
        );
      })
    );
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
    const streamId = decodeChannelId(id);
    const channel = findChannel(await loadChannels(this.config), streamId);
    if (!channel) throw new Error(`Channel not found: ${streamId}`);
    const encodedId = encodeChannelId(channel.id);
    const guideDate = resolveGuideDate();
    const videos = await videosForGuideDay(
      this.config,
      encodedId,
      channel.id,
      guideDate
    );
    return {
      id: encodedId,
      type: TV_TYPE,
      name: channel.name,
      poster: channel.logo || undefined,
      posterShape: 'square',
      tvgId: channelTvgId(channel),
      behaviorHints: { hasScheduledVideos: videos.length > 0 },
      videos: videos.length ? videos : undefined,
    };
  }

  async getStreams(id: string): Promise<Stream[]> {
    const streamId = decodeChannelId(id);
    const channel = findChannel(await loadChannels(this.config), streamId);
    if (!channel) throw new Error(`Channel not found: ${streamId}`);
    return [await mapStream(this.config, channel)];
  }
}
