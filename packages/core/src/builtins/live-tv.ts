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
const sourceCache = Cache.getInstance<string, XmltvData | M3uEntry[]>(
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
  aliases?: string[];
  language?: string;
}

interface XmltvProgram {
  channelId: string;
  title: string;
  startTime: string;
  endTime: string;
  description?: string;
  thumbnail?: string;
  categories?: string[];
}

interface XmltvData {
  channels: XmltvChannel[];
  programs: XmltvProgram[];
}

export interface M3uEntry {
  channelId: string;
  name: string;
  url: string;
  logo?: string;
  group?: string;
  country?: string;
  language?: string;
}

export function encodeChannelId(channelId: string): string {
  return `${CHANNEL_ID_PREFIX}${toUrlSafeBase64(channelId.trim().toLowerCase())}`;
}

export function decodeChannelId(id: string): string {
  id = id.split(':epg:', 1)[0];
  if (!id.startsWith(CHANNEL_ID_PREFIX))
    throw new Error(`Unsupported ID: ${id}`);
  return fromUrlSafeBase64(id.slice(CHANNEL_ID_PREFIX.length));
}

function value(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

function parseXmltvDate(input: unknown): string | undefined {
  const raw = value(input);
  const match = raw?.match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s+([+-])(\d{2})(\d{2}))?/
  );
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second, sign, tzHour, tzMinute] =
    match;
  let timestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
  if (sign) {
    const offset = (Number(tzHour) * 60 + Number(tzMinute)) * 60_000;
    timestamp += sign === '+' ? -offset : offset;
  }
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

async function parseXmltvData(xml: string): Promise<XmltvData> {
  const document = await parseStringPromise(xml);
  const channels = Array.isArray(document?.tv?.channel)
    ? document.tv.channel
    : [];

  const parsedChannels = channels
    .map((channel: any): XmltvChannel | undefined => {
      const id = value(channel?.$?.id);
      const names: string[] = (channel?.['display-name'] ?? [])
        .map((entry: any) =>
          value(typeof entry === 'string' ? entry : entry?._)
        )
        .filter((entry: string | undefined): entry is string => Boolean(entry));
      const name = names[0];
      if (!id || !name) return undefined;
      return {
        id,
        name,
        logo: value(channel?.icon?.[0]?.$?.src),
        aliases: [...new Set(names.slice(1))],
        language: value(channel?.['display-name']?.[0]?.$?.lang),
      };
    })
    .filter((channel: XmltvChannel | undefined): channel is XmltvChannel =>
      Boolean(channel)
    )
    .sort((a: XmltvChannel, b: XmltvChannel) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );

  const programs = (
    Array.isArray(document?.tv?.programme) ? document.tv.programme : []
  )
    .map((program: any): XmltvProgram | undefined => {
      const channelId = value(program?.$?.channel);
      const title = value(program?.title?.[0]?._ ?? program?.title?.[0]);
      const startTime = parseXmltvDate(program?.$?.start);
      const endTime = parseXmltvDate(program?.$?.stop);
      if (
        !channelId ||
        !title ||
        !startTime ||
        !endTime ||
        endTime <= startTime
      )
        return undefined;
      return {
        channelId,
        title,
        startTime,
        endTime,
        description: value(program?.desc?.[0]?._ ?? program?.desc?.[0]),
        thumbnail: value(program?.icon?.[0]?.$?.src),
        categories: (program?.category ?? [])
          .map((entry: any) => value(entry?._ ?? entry))
          .filter((entry: string | undefined): entry is string =>
            Boolean(entry)
          ),
      };
    })
    .filter((program: XmltvProgram | undefined): program is XmltvProgram =>
      Boolean(program)
    );

  return { channels: parsedChannels, programs };
}

export async function parseXmltv(xml: string): Promise<XmltvChannel[]> {
  return (await parseXmltvData(xml)).channels;
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
      const channelId = metadata['tvg-id'] || name;
      if (name && channelId) {
        entries.push({
          channelId,
          name,
          url: line,
          logo: metadata['tvg-logo'],
          group: metadata['group-title'],
          country: metadata['tvg-country'],
          language: metadata['tvg-language'],
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

async function loadXmltv(config: LiveTvSourceConfig): Promise<XmltvData> {
  const cacheKey = `xmltv:${config.sourceUrl}`;
  const cached = await sourceCache.get(cacheKey);
  if (cached) return cached as unknown as XmltvData;
  const data = await parseXmltvData(await fetchSource(config));
  await sourceCache.set(cacheKey, data, SOURCE_CACHE_TTL);
  return data;
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
      behaviorHints: { epgProvider: true },
    };
  }

  async getCatalog(): Promise<MetaPreview[]> {
    return (await loadXmltv(this.config)).channels.map((channel) => ({
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
        .map((program) => ({
          id: `${id.split(':epg:', 1)[0]}:epg:${program.startTime}`,
          title: program.title,
          overview: program.description,
          thumbnail: program.thumbnail,
          genres: program.categories,
          released: program.startTime,
          startTime: program.startTime,
          endTime: program.endTime,
        })),
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
        {
          name: 'catalog',
          types: ['channel'],
          idPrefixes: [CHANNEL_ID_PREFIX],
        },
        { name: 'meta', types: ['channel'], idPrefixes: [CHANNEL_ID_PREFIX] },
        { name: 'stream', types: ['channel'], idPrefixes: [CHANNEL_ID_PREFIX] },
      ],
      catalogs: [
        { id: 'aiolivetv-channels', type: 'channel', name: 'Channels' },
      ],
    };
  }

  async getCatalog(): Promise<MetaPreview[]> {
    const entries = await loadM3u(this.config);
    return [
      ...new Map(
        entries.map((entry) => [entry.channelId.toLowerCase(), entry])
      ).values(),
    ]
      .map((entry) => ({
        id: encodeChannelId(entry.channelId),
        type: 'channel',
        name: entry.name,
        poster: entry.logo,
        posterShape: 'square' as const,
        tvgId: entry.channelId,
        country: entry.country,
        language: entry.language,
        genres: entry.group ? [entry.group] : undefined,
      }))
      .sort((a, b) =>
        (a.name ?? a.id).localeCompare(b.name ?? b.id, undefined, {
          sensitivity: 'base',
        })
      );
  }

  async getMeta(id: string): Promise<Meta> {
    const channelId = decodeChannelId(id);
    const entry = (await loadM3u(this.config)).find(
      (item) => item.channelId.trim().toLowerCase() === channelId
    );
    if (!entry) throw new Error(`Channel not found: ${channelId}`);
    return {
      id: id.split(':epg:', 1)[0],
      type: 'channel',
      name: entry.name,
      poster: entry.logo,
      posterShape: 'square',
      country: entry.country,
      language: entry.language,
      genres: entry.group ? [entry.group] : undefined,
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
