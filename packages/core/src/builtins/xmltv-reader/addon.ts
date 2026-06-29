import type { Manifest, Meta, MetaPreview } from '../../db/index.js';
import { Cache } from '../../utils/index.js';
import {
  CHANNEL_ID_PREFIX,
  decodeChannelId,
  encodeChannelId,
  fetchSourceText,
  LiveTvSourceConfig,
  LiveTvSourceConfigSchema,
  LIVE_TV_CATALOG_PAGE_SIZE,
  programLinks,
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
          id: 'aiolivetv-channels',
          type: 'channel',
          name: 'Channels',
          extra: [{ name: 'skip' }],
        },
      ],
      behaviorHints: { epgProvider: true },
    };
  }

  async getCatalog(skip = 0): Promise<MetaPreview[]> {
    return (await loadXmltv(this.config)).channels
      .slice(skip, skip + LIVE_TV_CATALOG_PAGE_SIZE)
      .map((channel) => ({
        id: encodeChannelId(channel.id),
        type: 'channel',
        name: channel.name,
        poster: channel.logo,
        posterShape: 'square',
        tvgId: channel.id,
        aliases: channel.aliases,
        language: channel.language,
      }));
  }

  async getMeta(id: string): Promise<Meta> {
    const channelId = decodeChannelId(id);
    const data = await loadXmltv(this.config);
    const channel = data.channels.find(
      (item) => item.id.trim().toLowerCase() === channelId
    );
    if (!channel) throw new Error(`Channel not found: ${channelId}`);
    return {
      id,
      type: 'channel',
      name: channel.name,
      poster: channel.logo,
      posterShape: 'square',
      videos: data.programs
        .filter(
          (program) => program.channelId.trim().toLowerCase() === channelId
        )
        .map((program) => {
          const links = programLinks(
            program.categories,
            program.cast,
            program.directors
          );
          return {
            id: `${id.split(':epg:', 1)[0]}:epg:${program.startTime}`,
            title: program.title,
            subtitle: program.subtitle,
            overview: program.description,
            thumbnail: program.thumbnail,
            genres: program.categories,
            cast: program.cast,
            directors: program.directors,
            links: links.length ? links : undefined,
            released: program.released ?? program.startTime,
            releaseInfo:
              program.released?.slice(0, 4) ?? program.startTime.slice(0, 4),
            runtime: program.runtime,
            startTime: program.startTime,
            endTime: program.endTime,
          };
        })
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    };
  }
}
