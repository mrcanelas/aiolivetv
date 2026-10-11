import type { Manifest, Meta, MetaPreview, Stream } from '../../db/index.js';
import { TV_TYPE } from '../../utils/constants.js';
import { Cache } from '../../utils/index.js';
import { normalizeChannelGroup } from '../../utils/channelName.js';
import { resolveNotWebReady } from '../../streams/web-readiness.js';
import {
  applyEpgTimeShift,
  bareChannelPreview,
  buildEpgCatalogResponse,
  channelGenreCatalogExtra,
  channelGenres,
  EPG_GUIDE_CATALOG_EXTRAS,
  guideChannelMeta,
  LIVE_TV_CATALOG_PAGE_SIZE,
  matchesCatalogGenre,
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
  apiBaseUrl,
  buildPlaybackUrl,
  canonicalChannelId,
  CHANNELS_CACHE_TTL,
  connectionIdForUrl,
  EPG_CACHE_TTL,
  fetchAllChannels,
  fetchChannelTags,
  fetchEpgEventsForChannel,
  parseCanonicalChannelId,
  playbackBaseUrl,
  resolveTvheadendAssetUrl,
  unixSecondsToIso,
  type TvheadendChannel,
  type TvheadendChannelTag,
  type TvheadendEpgEvent,
} from './client.js';
import { TvheadendConfigSchema, type TvheadendConfig } from './config.js';
import { assertTvheadendEnabled } from './policy.js';
import { buildTvheadendLogoProxyUrl } from './proxyUrl.js';

const channelsCache = Cache.getInstance<string, TvheadendChannel[]>(
  'tvheadend-channels'
);
const tagsCache = Cache.getInstance<string, TvheadendChannelTag[]>(
  'tvheadend-tags'
);
const epgCache = Cache.getInstance<string, TvheadendEpgEvent[]>(
  'tvheadend-epg'
);

function channelsCacheKey(config: TvheadendConfig): string {
  return `${apiBaseUrl(config)}:${config.username}:${config.tagIds ?? ''}`;
}

async function loadChannels(
  config: TvheadendConfig
): Promise<TvheadendChannel[]> {
  assertTvheadendEnabled();
  const key = channelsCacheKey(config);
  const cached = await channelsCache.get(key);
  if (cached) return cached;
  const channels = await fetchAllChannels(config);
  await channelsCache.set(key, channels, CHANNELS_CACHE_TTL);
  return channels;
}

async function loadTags(
  config: TvheadendConfig
): Promise<TvheadendChannelTag[]> {
  const key = `${apiBaseUrl(config)}:${config.username}:tags`;
  const cached = await tagsCache.get(key);
  if (cached) return cached;
  try {
    const tags = await fetchChannelTags(config);
    await tagsCache.set(key, tags, CHANNELS_CACHE_TTL);
    return tags;
  } catch {
    return [];
  }
}

function tagNameMap(tags: TvheadendChannelTag[]): Map<string, string> {
  return new Map(tags.map((tag) => [tag.uuid, tag.name]));
}

function channelGroup(
  channel: TvheadendChannel,
  tags: Map<string, string>
): string | undefined {
  for (const tagId of channel.tags) {
    const name = tags.get(tagId);
    if (name) return normalizeChannelGroup(name);
  }
  return undefined;
}

function sortedChannels(channels: TvheadendChannel[]): TvheadendChannel[] {
  return [...channels].sort((a, b) => {
    const an = typeof a.number === 'number' ? a.number : Number(a.number);
    const bn = typeof b.number === 'number' ? b.number : Number(b.number);
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) {
      return an - bn;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

function resolvePoster(
  config: TvheadendConfig,
  channel: TvheadendChannel
): string | undefined {
  const absolute = resolveTvheadendAssetUrl(
    playbackBaseUrl(config),
    channel.icon
  );
  if (!absolute) return undefined;
  // imagecache and other relative assets usually need TVH auth — proxy them.
  try {
    const parsed = new URL(absolute);
    const apiHost = new URL(apiBaseUrl(config)).host;
    const playbackHost = new URL(playbackBaseUrl(config)).host;
    if (
      parsed.host === apiHost ||
      parsed.host === playbackHost ||
      parsed.pathname.includes('/imagecache/')
    ) {
      return buildTvheadendLogoProxyUrl(config, absolute);
    }
  } catch {
    return absolute;
  }
  return absolute;
}

async function loadChannelEpg(
  config: TvheadendConfig,
  channelUuid: string
): Promise<TvheadendEpgEvent[]> {
  const key = `${channelsCacheKey(config)}:${channelUuid}`;
  const cached = await epgCache.get(key);
  if (cached) return cached;
  const events = await fetchEpgEventsForChannel(config, channelUuid);
  await epgCache.set(key, events, EPG_CACHE_TTL);
  return events;
}

async function hasEpgData(
  config: TvheadendConfig,
  channels: TvheadendChannel[]
): Promise<boolean> {
  for (const channel of channels.slice(0, 5)) {
    try {
      if ((await loadChannelEpg(config, channel.uuid)).length > 0) {
        return true;
      }
    } catch {
      // Some TVHeadend users expose channels/streams without an EPG.
    }
  }
  return false;
}

function eventToVideo(
  encodedId: string,
  event: TvheadendEpgEvent,
  timeShiftMinutes: number
) {
  const { startTime, endTime } = applyEpgTimeShift(
    unixSecondsToIso(event.start),
    unixSecondsToIso(event.stop),
    timeShiftMinutes
  );
  return programToVideo({
    channelEncodedId: encodedId,
    title: event.title,
    subtitle: event.subtitle,
    description: event.description || event.summary,
    startTime,
    endTime,
    airedYear: startTime.slice(0, 4),
  });
}

async function videosForGuideDay(
  config: TvheadendConfig,
  encodedId: string,
  channelUuid: string,
  guideDate: string
) {
  const events = await loadChannelEpg(config, channelUuid);
  return events
    .filter((event) =>
      shiftedProgramOverlapsUtcDay(
        {
          startTime: unixSecondsToIso(event.start),
          endTime: unixSecondsToIso(event.stop),
        },
        guideDate,
        config.timeShiftMinutes
      )
    )
    .map((event) => eventToVideo(encodedId, event, config.timeShiftMinutes));
}

function findChannel(
  config: TvheadendConfig,
  channels: TvheadendChannel[],
  decodedId: string
): TvheadendChannel | undefined {
  const expectedConnection = connectionIdForUrl(apiBaseUrl(config));
  try {
    const { connectionId, channelUuid } = parseCanonicalChannelId(decodedId);
    if (connectionId !== expectedConnection) return undefined;
    return channels.find((channel) => channel.uuid === channelUuid);
  } catch {
    // Accept bare UUID for resilience with older mappings.
    return channels.find((channel) => channel.uuid === decodedId);
  }
}

export class TvheadendAddon {
  private readonly config: TvheadendConfig;

  constructor(config: Parameters<typeof TvheadendConfigSchema.parse>[0]) {
    this.config = TvheadendConfigSchema.parse(config);
  }

  async getManifest(): Promise<Manifest> {
    assertTvheadendEnabled();
    let groups: Array<string | undefined> = [];
    let epgProvider = false;
    try {
      const [channels, tags] = await Promise.all([
        loadChannels(this.config),
        loadTags(this.config),
      ]);
      const tagNames = tagNameMap(tags);
      groups = channels.map((channel) => channelGroup(channel, tagNames));
      epgProvider = await hasEpgData(this.config, channels);
    } catch {
      groups = [];
    }
    return {
      id: 'org.aiolivetv.tvheadend',
      name: 'TVHeadend',
      version: '1.0.0',
      description: 'Live TV channels, EPG and streams from a TVHeadend server',
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
          id: 'tvheadend-channels',
          type: TV_TYPE,
          name: 'Channels',
          extra: [
            ...EPG_GUIDE_CATALOG_EXTRAS,
            channelGenreCatalogExtra(groups),
          ],
        },
      ],
      ...(epgProvider ? { behaviorHints: { epgProvider: true } } : {}),
    };
  }

  async getCatalog(skip = 0, genre?: string): Promise<MetaPreview[]> {
    const [channels, tags] = await Promise.all([
      loadChannels(this.config),
      loadTags(this.config),
    ]);
    const tagNames = tagNameMap(tags);
    return sortedChannels(channels)
      .filter((channel) =>
        matchesCatalogGenre(channelGroup(channel, tagNames), genre)
      )
      .slice(skip, skip + LIVE_TV_CATALOG_PAGE_SIZE)
      .map((channel) =>
        bareChannelPreview({
          id: encodeChannelId(
            canonicalChannelId(apiBaseUrl(this.config), channel.uuid)
          ),
          name: channel.name,
          poster: resolvePoster(this.config, channel),
          tvgId: channel.uuid,
          genres: channelGenres(channelGroup(channel, tagNames)),
        })
      );
  }

  async getCatalogGuide(
    skip = 0,
    date?: string,
    genre?: string
  ): Promise<Meta[]> {
    const guideDate = resolveGuideDate(date);
    const [channels, tags] = await Promise.all([
      loadChannels(this.config),
      loadTags(this.config),
    ]);
    const tagNames = tagNameMap(tags);
    const page = sortedChannels(channels)
      .filter((channel) =>
        matchesCatalogGenre(channelGroup(channel, tagNames), genre)
      )
      .slice(skip, skip + LIVE_TV_CATALOG_PAGE_SIZE);

    return Promise.all(
      page.map(async (channel) => {
        const encodedId = encodeChannelId(
          canonicalChannelId(apiBaseUrl(this.config), channel.uuid)
        );
        const videos = await videosForGuideDay(
          this.config,
          encodedId,
          channel.uuid,
          guideDate
        );
        return guideChannelMeta(
          {
            id: encodedId,
            name: channel.name,
            logo: resolvePoster(this.config, channel),
            genres: channelGenres(channelGroup(channel, tagNames)),
          },
          videos
        );
      })
    );
  }

  async getCatalogResponse(
    skip = 0,
    date?: string,
    genre?: string
  ): Promise<CatalogHandlerResponse> {
    return buildEpgCatalogResponse(
      (pageSkip) => this.getCatalog(pageSkip, genre),
      (pageSkip, guideDate) => this.getCatalogGuide(pageSkip, guideDate, genre),
      skip,
      date
    );
  }

  async getMeta(id: string): Promise<Meta> {
    const decoded = decodeChannelId(id);
    const [channels, tags] = await Promise.all([
      loadChannels(this.config),
      loadTags(this.config),
    ]);
    const channel = findChannel(this.config, channels, decoded);
    if (!channel) throw new Error(`Channel not found: ${decoded}`);
    const encodedId = encodeChannelId(
      canonicalChannelId(apiBaseUrl(this.config), channel.uuid)
    );
    const tagNames = tagNameMap(tags);
    const guideDate = resolveGuideDate();
    const videos = await videosForGuideDay(
      this.config,
      encodedId,
      channel.uuid,
      guideDate
    );
    return {
      id: encodedId,
      type: TV_TYPE,
      name: channel.name,
      poster: resolvePoster(this.config, channel),
      posterShape: 'square',
      tvgId: channel.uuid,
      genres: channelGenres(channelGroup(channel, tagNames)),
      behaviorHints: { hasScheduledVideos: videos.length > 0 },
      videos: videos.length ? videos : undefined,
    };
  }

  async getStreams(id: string): Promise<Stream[]> {
    const decoded = decodeChannelId(id);
    const channel = findChannel(
      this.config,
      await loadChannels(this.config),
      decoded
    );
    if (!channel) throw new Error(`Channel not found: ${decoded}`);

    const playback = await buildPlaybackUrl(this.config, channel.uuid);
    const descriptionParts = [`TVHeadend · ${playback.mode}`];
    if (playback.privatePlaybackWarning) {
      descriptionParts.push(
        'URL de reprodução privada: o dispositivo precisa estar na rede correspondente ou em VPN'
      );
    }
    if (this.config.profile) {
      descriptionParts.push(`profile=${this.config.profile}`);
    }

    const stream: Stream = {
      url: playback.url,
      name: channel.name,
      description: descriptionParts.join(' · '),
    };
    const notWebReady = await resolveNotWebReady(stream, { probe: false });
    return notWebReady
      ? [{ ...stream, behaviorHints: { notWebReady: true } }]
      : [stream];
  }
}
