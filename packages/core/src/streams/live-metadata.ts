import type { ParsedStream } from '../db/schemas.js';
import type {
  ChannelMapping,
  ChannelStreamSource,
} from '../db/channelMapping.js';
import { MANUAL_STREAM_ADDON_ID } from '../main/channelMappings.js';
import { inferStreamUrlFormat } from './url-format.js';

export type LiveProviderType =
  | 'm3u'
  | 'xtream'
  | 'xmltv'
  | 'vivo'
  | 'claro'
  | 'mitv'
  | 'addon'
  | 'manual';

export type LiveMatchStatus =
  | 'canonical'
  | 'auto'
  | 'suggested'
  | 'manual'
  | 'fallback';

export interface LiveStreamMetadata {
  channelId?: string;
  channelName?: string;
  canonicalName?: string;
  tvgId?: string;
  logo?: string;
  group?: string;
  country?: string;
  language?: string;

  providerName?: string;
  providerType?: LiveProviderType;

  streamName?: string;
  streamUrl?: string;
  matchConfidence?: number;
  matchStatus?: LiveMatchStatus;
  priority?: number;

  epgProvider?: boolean;
  hasSchedule?: boolean;

  protocol?: string;
  extension?: string;
  deliveryFormat?: string;
  deliveryFormatLabel?: string;
  adaptive?: boolean;
  isHls?: boolean;
  isMpegTs?: boolean;
  isDash?: boolean;

  programTitle?: string;
  programSubtitle?: string;
  programStart?: string;
  programEnd?: string;
  programProgress?: number;
  isCurrentProgram?: boolean;

  replayAvailable?: boolean;
  catchupDays?: number;
  healthStatus?: string;
  responseTimeMs?: number;
}

export interface LiveMetadataContext {
  channelId?: string;
  channelName?: string;
  canonicalName?: string;
  tvgId?: string;
  group?: string;
  country?: string;
  language?: string;
  logo?: string;
  mapping?: ChannelMapping;
  hasSchedule?: boolean;
  epgProvider?: boolean;
}

const PRESET_PROVIDER_TYPE: Record<string, LiveProviderType> = {
  m3u: 'm3u',
  xtream: 'xtream',
  xmltv: 'xmltv',
  'vivo-tv': 'vivo',
  'claro-tv': 'claro',
  'mi-tv': 'mitv',
  manual: 'manual',
};

export function providerTypeFromPreset(
  presetType?: string | null
): LiveProviderType {
  if (!presetType) return 'addon';
  return PRESET_PROVIDER_TYPE[presetType] ?? 'addon';
}

function streamAddonId(stream: ParsedStream): string | undefined {
  return stream.addon.instanceId ?? stream.addon.preset?.id;
}

function findMappedSource(
  stream: ParsedStream,
  mapping?: ChannelMapping
): { source: ChannelStreamSource; index: number } | undefined {
  const sources = mapping?.streams;
  if (!sources?.length) return undefined;
  if (stream.url) {
    const byUrl = sources.findIndex(
      (source) => source.url && source.url === stream.url
    );
    if (byUrl >= 0) return { source: sources[byUrl], index: byUrl };
  }
  const addonId = streamAddonId(stream);
  if (!addonId) return undefined;
  const byAddon = sources.findIndex((source) => source.addonId === addonId);
  if (byAddon >= 0) return { source: sources[byAddon], index: byAddon };
  return undefined;
}

function resolveMatchStatus(
  stream: ParsedStream,
  source: ChannelStreamSource | undefined,
  mapping?: ChannelMapping
): LiveMatchStatus {
  const addonId = source?.addonId ?? streamAddonId(stream);
  if (addonId === MANUAL_STREAM_ADDON_ID || source?.url) return 'manual';
  if (mapping?.canonicalAddonId && addonId === mapping.canonicalAddonId) {
    return 'canonical';
  }
  const confidence = source?.confidence;
  if (confidence != null && confidence > 0 && confidence < 0.9) {
    return 'suggested';
  }
  if (confidence == null || confidence >= 0.9) return 'auto';
  return 'fallback';
}

export function attachLiveMetadata(
  stream: ParsedStream,
  ctx: LiveMetadataContext = {}
): ParsedStream {
  const format = inferStreamUrlFormat(stream.url);
  const mapped = findMappedSource(stream, ctx.mapping);
  const source = mapped?.source;
  const providerType = providerTypeFromPreset(stream.addon.preset?.type);
  const channelName =
    ctx.channelName ?? ctx.mapping?.name ?? ctx.canonicalName;
  const live: LiveStreamMetadata = {
    channelId: ctx.channelId ?? ctx.mapping?.id,
    channelName,
    canonicalName: ctx.canonicalName ?? ctx.mapping?.name ?? channelName,
    tvgId: ctx.tvgId,
    logo: ctx.logo ?? ctx.mapping?.poster,
    group: ctx.group,
    country: ctx.country,
    language: ctx.language,
    providerName: stream.addon.name,
    providerType,
    streamName: source?.name ?? stream.filename ?? stream.message,
    streamUrl: stream.url,
    matchConfidence: source?.confidence,
    matchStatus: resolveMatchStatus(stream, source, ctx.mapping),
    priority: mapped?.index,
    epgProvider: ctx.epgProvider,
    hasSchedule: ctx.hasSchedule,
    protocol: format.protocol,
    extension: format.extension,
    deliveryFormat: format.format,
    deliveryFormatLabel:
      format.format === 'unknown' ? undefined : format.label,
    adaptive: format.isAdaptive,
    isHls: format.format === 'hls',
    isMpegTs: format.format === 'mpegts',
    isDash: format.format === 'dash',
  };

  const parsedFile = stream.parsedFile
    ? {
        ...stream.parsedFile,
        extension: stream.parsedFile.extension ?? format.extension,
        container:
          stream.parsedFile.container ??
          (format.format === 'unknown' ? undefined : format.label),
      }
    : format.format === 'unknown'
      ? stream.parsedFile
      : {
          audioChannels: [],
          visualTags: [],
          audioTags: [],
          languages: [],
          extension: format.extension,
          container: format.label,
        };

  return {
    ...stream,
    parsedFile,
    live: {
      ...stream.live,
      ...live,
    },
  };
}

export function attachLiveMetadataToStreams(
  streams: ParsedStream[],
  ctx: LiveMetadataContext = {}
): ParsedStream[] {
  return streams.map((stream) => attachLiveMetadata(stream, ctx));
}
