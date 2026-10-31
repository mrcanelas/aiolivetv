import { z } from 'zod';
import type { Manifest, Meta, MetaPreview } from '../../db/index.js';
import { M3uAddon } from '../m3u-reader/addon.js';
import { XmltvAddon } from '../xmltv-reader/addon.js';
import {
  buildProgramsByChannelId,
  type XmltvData,
} from '../xmltv-reader/parser.js';
import { decodeChannelId } from '../live-tv/shared.js';
import {
  IptvOrgConfigSchema,
  IptvEpgConfigSchema,
  iptvOrgSourceUrl,
  iptvEpgSourceUrl,
} from './config.js';

const PLACEHOLDERS = new Set(['no data', 'no game today', 'no event today']);

/** Normalize this provider only; generic XMLTV imports remain untouched. */
export function normalizeIptvEpg(data: XmltvData, country: string): XmltvData {
  const prefix = new RegExp(
    `^(?:${country}|${country === 'gb' ? 'uk' : country})\\s*[-:|]\\s*`,
    'i'
  );
  const programs = data.programs.filter(
    (program) => !PLACEHOLDERS.has(program.title.trim().toLowerCase())
  );
  return {
    channels: data.channels.map((channel) => ({
      ...channel,
      name: channel.name.replace(prefix, '').trim() || channel.name,
      aliases: channel.aliases
        ?.map((name) => name.replace(prefix, '').trim())
        .filter(Boolean),
    })),
    programs,
    programsByChannelId: buildProgramsByChannelId(programs),
  };
}

function discoveryChannel<T extends MetaPreview | Meta>(
  channel: T,
  country: string
): T {
  const [baseId, feed] = decodeChannelId(channel.id).split('@');
  // Keep regional/timeshift variants distinct, including when the playlist
  // label omits the feed name. Only quality/national feeds share a base TVG ID;
  // playback IDs always retain the original feed.
  const genericFeeds = new Set(['sd', 'hd', 'fhd', 'uhd', '4k', country]);
  const displayName = (channel.name ?? baseId)
    .replace(/\s*\(\d{3,4}p\)/gi, '')
    .replace(/\s*\[(?:Geo-blocked|Not 24\/7)\]/gi, '')
    .trim();
  const generic = !feed || genericFeeds.has(feed);
  const name = generic ? displayName : `${displayName} (${feed})`;
  return {
    ...channel,
    name,
    tvgId: generic ? baseId : `${baseId}@${feed}`,
    country: country === 'uk' ? 'GB' : country.toUpperCase(),
  };
}

/** Playlist channels and streams, also usable as a stream-only preset. */
export class IptvOrgAddon extends M3uAddon {
  private readonly country: string;

  constructor(input: z.input<typeof IptvOrgConfigSchema>) {
    const config = IptvOrgConfigSchema.parse(input);
    super({ ...config, sourceUrl: iptvOrgSourceUrl(config.country) });
    this.country = config.country;
  }

  override async getManifest(): Promise<Manifest> {
    const manifest = await super.getManifest();
    return {
      ...manifest,
      id: 'org.aiolivetv.iptv-org',
      name: 'IPTV-org',
      description:
        'Community IPTV-org streams. Availability and geographic restrictions vary by channel.',
    };
  }

  override async getCatalog(skip = 0, genre?: string): Promise<MetaPreview[]> {
    return (await super.getCatalog(skip, genre)).map((channel) =>
      discoveryChannel(channel, this.country)
    );
  }

  override async getMeta(id: string): Promise<Meta> {
    return discoveryChannel(await super.getMeta(id), this.country);
  }
}

/** Guide source, independent of any stream provider. */
export class IptvEpgAddon extends XmltvAddon {
  private readonly country: string;

  constructor(input: z.input<typeof IptvEpgConfigSchema>) {
    const config = IptvEpgConfigSchema.parse(input);
    super(
      { ...config, sourceUrl: iptvEpgSourceUrl(config.country) },
      {
        cacheNamespace: `iptv-epg:${config.country}:v1`,
        transform: (data) => normalizeIptvEpg(data, config.country),
      }
    );
    this.country = config.country;
  }

  override async getManifest(): Promise<Manifest> {
    const manifest = await super.getManifest();
    return {
      ...manifest,
      id: 'org.aiolivetv.iptv-epg',
      name: 'IPTV-EPG',
      description:
        'Channel metadata and programme guides from IPTV-EPG.org. No streams.',
    };
  }

  private withCountry<T extends MetaPreview | Meta>(channel: T): T {
    return { ...channel, country: this.country.toUpperCase() };
  }

  override async getCatalog(skip = 0): Promise<MetaPreview[]> {
    return (await super.getCatalog(skip)).map((channel) =>
      this.withCountry(channel)
    );
  }

  override async getCatalogGuide(skip = 0, date?: string): Promise<Meta[]> {
    return (await super.getCatalogGuide(skip, date)).map((channel) =>
      this.withCountry(channel)
    );
  }

  override async getMeta(id: string): Promise<Meta> {
    return this.withCountry(await super.getMeta(id));
  }
}
