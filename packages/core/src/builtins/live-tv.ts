import { parseStringPromise } from 'xml2js';
import { z } from 'zod';
import type { Manifest, Meta, MetaPreview, Stream } from '../db/index.js';
import {
  Cache,
  fromUrlSafeBase64,
  makeRequest,
  toUrlSafeBase64,
} from '../utils/index.js';

const SOURCE_CACHE_TTL = 300;
const CHANNEL_ID_PREFIX = 'aiolivetv:';
const sourceCache = Cache.getInstance<string, XmltvChannel[] | M3uEntry[]>(
  'live-tv-sources'
);

export const LiveTvSourceConfigSchema = z.object({
  sourceUrl: z.url(),
  timeout: z.number().int().positive(),
});

export type LiveTvSourceConfig = z.infer<typeof LiveTvSourceConfigSchema>;

export interface XmltvChannel {
  id: string;
  name: string;
  logo?: string;
}

export interface M3uEntry {
  channelId: string;
  name: string;
  url: string;
  logo?: string;
  group?: string;
}

export function encodeChannelId(channelId: string): string {
  return `${CHANNEL_ID_PREFIX}${toUrlSafeBase64(channelId.trim().toLowerCase())}`;
}

export function decodeChannelId(id: string): string {
  if (!id.startsWith(CHANNEL_ID_PREFIX))
    throw new Error(`Unsupported ID: ${id}`);
  return fromUrlSafeBase64(id.slice(CHANNEL_ID_PREFIX.length));
}

function value(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

export async function parseXmltv(xml: string): Promise<XmltvChannel[]> {
  const document = await parseStringPromise(xml);
  const channels = Array.isArray(document?.tv?.channel)
    ? document.tv.channel
    : [];

  return channels
    .map((channel: any): XmltvChannel | undefined => {
      const id = value(channel?.$?.id);
      const name = value(channel?.['display-name']?.[0]);
      if (!id || !name) return undefined;
      return { id, name, logo: value(channel?.icon?.[0]?.$?.src) };
    })
    .filter((channel: XmltvChannel | undefined): channel is XmltvChannel =>
      Boolean(channel)
    )
    .sort((a: XmltvChannel, b: XmltvChannel) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );
}

function splitExtinf(line: string): [string, string] {
  let quote = '';
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (
      (character === '"' || character === "'") &&
      (!quote || quote === character)
    ) {
      quote = quote ? '' : character;
    } else if (character === ',' && !quote) {
      return [line.slice(0, index), line.slice(index + 1).trim()];
    }
  }
  return [line, ''];
}

export function parseM3u(playlist: string): M3uEntry[] {
  const lines = playlist.replace(/^\uFEFF/, '').split(/\r?\n/);
  const entries: M3uEntry[] = [];
  let metadata: Record<string, string> | undefined;
  let displayName = '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('#EXTINF:')) {
      const [attributes, name] = splitExtinf(line);
      metadata = {};
      displayName = name;
      for (const match of attributes.matchAll(
        /([\w-]+)=("[^"]*"|'[^']*'|[^\s]+)/g
      )) {
        metadata[match[1].toLowerCase()] = match[2].replace(/^["']|["']$/g, '');
      }
    } else if (line && !line.startsWith('#') && metadata) {
      const name = metadata['tvg-name'] || displayName;
      const channelId = metadata['tvg-id'];
      if (name && channelId) {
        entries.push({
          channelId,
          name,
          url: line,
          logo: metadata['tvg-logo'],
          group: metadata['group-title'],
        });
      }
      metadata = undefined;
      displayName = '';
    }
  }

  return entries;
}

async function fetchSource(config: LiveTvSourceConfig): Promise<string> {
  const response = await makeRequest(config.sourceUrl, {
    timeout: config.timeout,
  });
  if (!response.ok) {
    throw new Error(
      `Source returned ${response.status} ${response.statusText}`
    );
  }
  return response.text();
}

async function loadXmltv(config: LiveTvSourceConfig): Promise<XmltvChannel[]> {
  const cacheKey = `xmltv:${config.sourceUrl}`;
  const cached = await sourceCache.get(cacheKey);
  if (cached) return cached as XmltvChannel[];
  const channels = await parseXmltv(await fetchSource(config));
  await sourceCache.set(cacheKey, channels, SOURCE_CACHE_TTL);
  return channels;
}

async function loadM3u(config: LiveTvSourceConfig): Promise<M3uEntry[]> {
  const cacheKey = `m3u:${config.sourceUrl}`;
  const cached = await sourceCache.get(cacheKey);
  if (cached) return cached as M3uEntry[];
  const entries = parseM3u(await fetchSource(config));
  await sourceCache.set(cacheKey, entries, SOURCE_CACHE_TTL);
  return entries;
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
        { id: 'aiolivetv-channels', type: 'channel', name: 'Channels' },
      ],
    };
  }

  async getCatalog(): Promise<MetaPreview[]> {
    return (await loadXmltv(this.config)).map((channel) => ({
      id: encodeChannelId(channel.id),
      type: 'channel',
      name: channel.name,
      poster: channel.logo,
      posterShape: 'square',
    }));
  }

  async getMeta(id: string): Promise<Meta> {
    const channelId = decodeChannelId(id);
    const channel = (await loadXmltv(this.config)).find(
      (item) => item.id.trim().toLowerCase() === channelId
    );
    if (!channel) throw new Error(`Channel not found: ${channelId}`);
    return {
      id,
      type: 'channel',
      name: channel.name,
      poster: channel.logo,
      posterShape: 'square',
    };
  }
}

export class M3uAddon {
  private readonly config: LiveTvSourceConfig;

  constructor(config: LiveTvSourceConfig) {
    this.config = LiveTvSourceConfigSchema.parse(config);
  }

  getManifest(): Manifest {
    return {
      id: 'org.aiolivetv.m3u',
      name: 'M3U',
      version: '1.0.0',
      description: 'Live TV streams from M3U',
      types: ['channel'],
      resources: [
        { name: 'stream', types: ['channel'], idPrefixes: [CHANNEL_ID_PREFIX] },
      ],
      catalogs: [],
    };
  }

  async getStreams(id: string): Promise<Stream[]> {
    const channelId = decodeChannelId(id);
    return (await loadM3u(this.config))
      .filter((entry) => entry.channelId.trim().toLowerCase() === channelId)
      .map((entry) => ({
        url: entry.url,
        name: entry.name,
        description: entry.group,
      }));
  }
}
