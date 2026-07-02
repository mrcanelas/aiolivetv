import type { Manifest, Meta, MetaPreview } from '../../db/index.js';
import { TV_TYPE } from '../../utils/constants.js';
import { Cache } from '../../utils/index.js';
import {
  bareChannelPreview,
  buildEpgCatalogResponse,
  EPG_CACHE_HEADERS,
  EPG_GUIDE_CATALOG_EXTRAS,
  guideChannelMeta,
  LIVE_TV_CATALOG_PAGE_SIZE,
  programOverlapsUtcDay,
  programToVideo,
  resolveGuideDate,
  type CatalogHandlerResponse,
} from '../live-tv/epg.js';
import {
  CHANNEL_ID_PREFIX,
  decodeChannelId,
  encodeChannelId,
  fetchSourceText,
  LiveTvSourceConfig,
  LiveTvSourceConfigSchema,
} from '../live-tv/shared.js';
import { parseXmltvData, type XmltvData } from './parser.js';

const SOURCE_CACHE_TTL = 300;
const sourceCache = Cache.getInstance<string, XmltvData>('xmltv-reader-sources');

async function loadXmltv(config: LiveTvSourceConfig): Promise<XmltvData> {
  const cacheKey = config.sourceUrl;
  const cached = await sourceCache.get(cacheKey);
  if (cached) return cached;
  const data = await parseXmltvData(await fetchSourceText(config));
  await sourceCache.set(cacheKey, data, SOURCE_CACHE_TTL);
  return data;
}

function programsForChannel(data: XmltvData, channelId: string) {
  return data.programsByChannelId.get(channelId.trim().toLowerCase()) ?? [];
}

function mapProgramToVideo(
  encodedId: string,
  program: XmltvData['programs'][number]
) {
  return programToVideo({
    channelEncodedId: encodedId,
    title: program.title,
    subtitle: program.subtitle,
    description: program.description,
    thumbnail: program.thumbnail,
    startTime: program.startTime,
    endTime: program.endTime,
    airedYear: program.released?.slice(0, 4),
    categories: program.categories,
    cast: program.cast,
    directors: program.directors,
  });
}

export class XmltvAddon {
  private readonly config: LiveTvSourceConfig;

  constructor(config: LiveTvSourceConfig) {
    this.config = LiveTvSourceConfigSchema.parse(config);
  }

  getManifest(): Manifest {
    return {
      id: 'org.aiolivetv.xmltv',
      name: 'XMLTV',
      version: '1.0.0',
      description: 'Live TV channel metadata from XMLTV',
      types: [TV_TYPE, 'channel'],
      resources: [
        {
          name: 'catalog',
          types: [TV_TYPE, 'channel'],
          idPrefixes: [CHANNEL_ID_PREFIX],
        },
        {
          name: 'meta',
          types: ['channel', TV_TYPE],
          idPrefixes: [CHANNEL_ID_PREFIX],
        },
      ],
      catalogs: [
        {
          id: 'aiolivetv-channels',
          type: TV_TYPE,
          name: 'Channels',
          extra: [...EPG_GUIDE_CATALOG_EXTRAS],
        },
      ],
      behaviorHints: { epgProvider: true },
    };
  }

  async getCatalog(skip = 0): Promise<MetaPreview[]> {
    return (await loadXmltv(this.config)).channels
      .slice(skip, skip + LIVE_TV_CATALOG_PAGE_SIZE)
      .map((channel) =>
        bareChannelPreview({
          id: encodeChannelId(channel.id),
          name: channel.name,
          poster: channel.logo,
          tvgId: channel.id,
          aliases: channel.aliases,
          language: channel.language,
        })
      );
  }

  async getCatalogGuide(skip = 0, date?: string): Promise<Meta[]> {
    const guideDate = resolveGuideDate(date);
    const data = await loadXmltv(this.config);
    return data.channels
      .slice(skip, skip + LIVE_TV_CATALOG_PAGE_SIZE)
      .map((channel) => {
        const encodedId = encodeChannelId(channel.id);
        const videos = programsForChannel(data, channel.id)
          .filter((program) => programOverlapsUtcDay(program, guideDate))
          .map((program) => mapProgramToVideo(encodedId, program));
        return guideChannelMeta(
          {
            id: encodedId,
            name: channel.name,
            logo: channel.logo,
            language: channel.language,
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
    const channelId = decodeChannelId(id);
    const data = await loadXmltv(this.config);
    const channel = data.channels.find(
      (item) => item.id.trim().toLowerCase() === channelId
    );
    if (!channel) throw new Error(`Channel not found: ${channelId}`);
    const encodedId = encodeChannelId(channel.id);
    const guideDate = resolveGuideDate();
    return {
      id: encodedId,
      type: TV_TYPE,
      name: channel.name,
      poster: channel.logo,
      posterShape: 'square',
      behaviorHints: { hasScheduledVideos: true },
      videos: programsForChannel(data, channel.id)
        .filter((program) => programOverlapsUtcDay(program, guideDate))
        .map((program) => mapProgramToVideo(encodedId, program)),
    };
  }
}
