import type { ParsedStream } from '../../../../../../core/src/db/schemas';
import {
  formatDeclaredStreamSummary,
  parseDeclaredStreamInfo,
} from '../../../../../../core/src/streams/declared';
import {
  inferStreamUrlFormat,
  sanitiseStreamUrl,
} from '../../../../../../core/src/streams/url-format';
import type {
  LiveMatchStatus,
  LiveProviderType,
  LiveStreamMetadata,
} from '../../../../../../core/src/streams/live-metadata';

export type PreviewStreamType = 'live' | 'http';

export interface PreviewInput {
  scenario: string;

  channelId: string;
  channelName: string;
  canonicalName: string;
  tvgId: string;
  group: string;
  country: string;
  language: string;
  logo: string;

  providerName: string;
  providerType: LiveProviderType;
  matchConfidence: number | undefined;
  matchStatus: LiveMatchStatus;
  priority: number | undefined;
  epgProvider: boolean;
  hasSchedule: boolean;
  addonName: string;
  presetId: string;
  manifestUrl: string;

  streamName: string;
  streamUrl: string;
  type: PreviewStreamType;
  proxied: boolean;
  message: string;

  resolution: string;
  encode: string;
  languages: string;
  visualTags: string;
  audioTags: string;
  audioChannels: string;
  subtitles: string;

  regexMatched: string;
  regexScore: number | undefined;
  maxRegexScore: number | undefined;
  seMatched: string;
  seScore: number | undefined;
  maxSeScore: number | undefined;
  rseMatched: string;
  rankedRegexMatched: string;
}

export const PREVIEW_SCENARIOS: { id: string; label: string }[] = [
  { id: 'm3u', label: 'M3U' },
  { id: 'xtream', label: 'Xtream' },
  { id: 'epg-m3u', label: 'EPG + M3U' },
  { id: 'manual-hls', label: 'Manual HLS' },
  { id: 'bare', label: 'Sem metadados' },
];

const STORAGE_KEY = 'aiolivetv:formatter-preview';

const PRESET_FROM_PROVIDER: Record<LiveProviderType, string> = {
  m3u: 'm3u',
  xtream: 'xtream',
  xmltv: 'xmltv',
  vivo: 'vivo-tv',
  claro: 'claro-tv',
  mitv: 'mi-tv',
  hdhomerun: 'hdhomerun',
  tvheadend: 'tvheadend',
  jellyfin: 'jellyfin',
  plex: 'plex',
  nextpvr: 'nextpvr',
  addon: 'custom',
  manual: 'manual',
};

function baseInput(partial: Partial<PreviewInput>): PreviewInput {
  return {
    scenario: 'm3u',
    channelId: 'aiolivetv:axn',
    channelName: 'AXN',
    canonicalName: 'AXN',
    tvgId: 'AXN.br',
    group: 'Filmes e Séries',
    country: 'BR',
    language: 'Portuguese (Brazil)',
    logo: '',
    providerName: 'M3U Brasil',
    providerType: 'm3u',
    matchConfidence: 1,
    matchStatus: 'auto',
    priority: 0,
    epgProvider: false,
    hasSchedule: false,
    addonName: 'M3U Brasil',
    presetId: 'm3u-1',
    manifestUrl: 'http://localhost:3000/manifest.json',
    streamName: 'AXN H265 FHD LEG',
    streamUrl: 'https://cdn.example.com/live/axn/index.m3u8',
    type: 'live',
    proxied: false,
    message: '',
    resolution: '',
    encode: '',
    languages: '',
    visualTags: '',
    audioTags: '',
    audioChannels: '',
    subtitles: '',
    regexMatched: '',
    regexScore: 25,
    maxRegexScore: 50,
    seMatched: '',
    seScore: 150,
    maxSeScore: 100,
    rseMatched: '',
    rankedRegexMatched: '',
    ...partial,
  };
}

export const DEFAULT_PREVIEW_INPUT: PreviewInput = baseInput({});

const SCENARIO_INPUTS: Record<string, PreviewInput> = {
  m3u: DEFAULT_PREVIEW_INPUT,
  xtream: baseInput({
    scenario: 'xtream',
    providerName: 'Xtream IPTV',
    providerType: 'xtream',
    addonName: 'Xtream IPTV',
    presetId: 'xtream-1',
    streamUrl: 'http://provider.example.com/live/user/pass/301.ts',
    matchStatus: 'auto',
    matchConfidence: 0.96,
  }),
  'epg-m3u': baseInput({
    scenario: 'epg-m3u',
    providerName: 'M3U Brasil',
    providerType: 'm3u',
    addonName: 'M3U Brasil',
    epgProvider: true,
    hasSchedule: true,
    matchStatus: 'canonical',
    matchConfidence: 1,
    tvgId: 'AXN.br',
    group: 'Entertainment',
  }),
  'manual-hls': baseInput({
    scenario: 'manual-hls',
    channelId: 'aiolivetv:caras',
    channelName: 'Caras TV',
    canonicalName: 'Caras TV',
    tvgId: '',
    group: '',
    providerName: 'Manual HLS',
    providerType: 'manual',
    addonName: 'Manual HLS',
    presetId: 'manual',
    streamName: 'Caras TV FHD',
    streamUrl: 'https://example.com/live.m3u8',
    matchStatus: 'manual',
    matchConfidence: 0,
    epgProvider: false,
    hasSchedule: false,
  }),
  bare: baseInput({
    scenario: 'bare',
    channelId: '',
    channelName: '',
    canonicalName: '',
    tvgId: '',
    group: '',
    country: '',
    language: '',
    providerName: 'Addon',
    providerType: 'addon',
    addonName: 'Live TV',
    presetId: 'custom',
    streamName: '',
    streamUrl: 'https://provider.example.com/live/12345',
    matchStatus: 'fallback',
    matchConfidence: undefined,
    priority: undefined,
    message: '',
    regexScore: undefined,
    maxRegexScore: undefined,
    seScore: undefined,
    maxSeScore: undefined,
  }),
};

export function applyScenario(id: string): PreviewInput {
  return SCENARIO_INPUTS[id] ?? DEFAULT_PREVIEW_INPUT;
}

export function loadPreviewInput(): PreviewInput {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREVIEW_INPUT;
    const parsed = JSON.parse(raw) as Partial<PreviewInput>;
    return baseInput({ ...parsed });
  } catch {
    return DEFAULT_PREVIEW_INPUT;
  }
}

export function savePreviewInput(input: PreviewInput) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(input));
  } catch {
    // preference is best-effort
  }
}

function splitList(value: string): string[] | undefined {
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

export function declaredSummary(input: PreviewInput): string | undefined {
  return formatDeclaredStreamSummary(
    parseDeclaredStreamInfo({
      name: input.streamName,
      group: input.group,
    })?.parsedFile
  );
}

export function buildPreviewStream(input: PreviewInput): ParsedStream {
  const declared = parseDeclaredStreamInfo({
    name: input.streamName,
    group: input.group,
  });
  const urlInfo = inferStreamUrlFormat(input.streamUrl);
  const urlSafe = sanitiseStreamUrl(input.streamUrl);
  const deliveryFormatKnown = urlInfo.format !== 'unknown';
  const languages =
    splitList(input.languages) ?? declared?.parsedFile.languages;
  const visualTags =
    splitList(input.visualTags) ?? declared?.parsedFile.visualTags;
  const audioTags =
    splitList(input.audioTags) ?? declared?.parsedFile.audioTags;
  const audioChannels =
    splitList(input.audioChannels) ?? declared?.parsedFile.audioChannels;
  const subtitles =
    splitList(input.subtitles) ?? declared?.parsedFile.subtitles;

  const live: LiveStreamMetadata = {
    channelId: input.channelId || undefined,
    channelName: input.channelName || undefined,
    canonicalName: input.canonicalName || input.channelName || undefined,
    tvgId: input.tvgId || undefined,
    logo: input.logo || undefined,
    group: input.group || undefined,
    country: input.country || undefined,
    language: input.language || undefined,
    providerName: input.providerName || input.addonName || undefined,
    providerType: input.providerType,
    streamName: input.streamName || undefined,
    streamUrl: input.streamUrl || undefined,
    ...urlSafe,
    matchConfidence: input.matchConfidence,
    matchStatus: input.matchStatus,
    priority: input.priority,
    epgProvider: input.epgProvider,
    hasSchedule: input.hasSchedule,
    protocol: urlInfo.protocol,
    extension: urlInfo.extension,
    deliveryFormat: urlInfo.format,
    deliveryFormatLabel: urlInfo.label,
    deliveryFormatKnown,
    adaptive: urlInfo.isAdaptive,
    isHls: urlInfo.format === 'hls',
    isMpegTs: urlInfo.format === 'mpegts',
    isDash: urlInfo.format === 'dash',
  };

  const presetType = PRESET_FROM_PROVIDER[input.providerType] ?? 'custom';

  return {
    id: 'preview',
    type: input.type,
    url: input.streamUrl || undefined,
    filename: input.streamName || undefined,
    originalName: input.streamName || undefined,
    message: input.message || undefined,
    proxied: input.proxied,
    library: false,
    parsedFile: {
      ...(declared?.parsedFile ?? {
        audioChannels: [],
        visualTags: [],
        audioTags: [],
        languages: [],
      }),
      resolution: input.resolution || declared?.parsedFile.resolution,
      encode: input.encode || declared?.parsedFile.encode,
      languages: languages ?? [],
      visualTags: visualTags ?? [],
      audioTags: audioTags ?? [],
      audioChannels: audioChannels ?? [],
      subtitles,
      extension: declared?.parsedFile.extension ?? urlInfo.extension,
      container:
        declared?.parsedFile.container ??
        (deliveryFormatKnown ? urlInfo.label : undefined),
    },
    live,
    addon: {
      name: input.addonName || input.providerName || 'Live TV',
      preset: {
        type: presetType,
        id: input.presetId || 'preview',
        options: {},
      },
      enabled: true,
      manifestUrl: input.manifestUrl || 'http://localhost:3000/manifest.json',
      timeout: 10_000,
    },
    regexMatched: input.regexMatched
      ? { name: input.regexMatched, index: 0 }
      : undefined,
    regexScore: input.regexScore,
    streamExpressionScore: input.seScore,
    streamExpressionMatched: input.seMatched
      ? { name: input.seMatched, index: 0 }
      : undefined,
    rankedStreamExpressionsMatched: splitList(input.rseMatched) ?? [],
    rankedRegexesMatched: splitList(input.rankedRegexMatched) ?? [],
  };
}

const TAB_FIELDS: Record<string, readonly string[]> = {
  channel: [
    'live.channelId',
    'live.channelName',
    'live.canonicalName',
    'live.tvgId',
    'live.logo',
    'live.group',
    'live.country',
    'live.language',
  ],
  source: [
    'live.providerName',
    'live.providerType',
    'live.matchConfidence',
    'live.matchStatus',
    'live.priority',
    'live.epgProvider',
    'live.hasSchedule',
    'addon.name',
    'addon.presetId',
    'addon.manifestUrl',
  ],
  stream: [
    'live.streamName',
    'live.streamUrl',
    'live.streamUrlSafe',
    'live.streamHost',
    'live.streamPathType',
    'live.deliveryFormat',
    'live.deliveryFormatLabel',
    'live.deliveryFormatKnown',
    'live.protocol',
    'live.extension',
    'live.adaptive',
    'live.isHls',
    'live.isMpegTs',
    'live.isDash',
    'stream.type',
    'stream.proxied',
    'stream.message',
    'stream.filename',
  ],
  parsed: [
    'stream.resolution',
    'stream.encode',
    'stream.languages',
    'stream.uLanguages',
    'stream.languageEmojis',
    'stream.visualTags',
    'stream.audioTags',
    'stream.audioChannels',
    'stream.subtitles',
    'stream.subbed',
  ],
  scoring: [
    'stream.regexMatched',
    'stream.rankedRegexMatched',
    'stream.regexScore',
    'stream.nRegexScore',
    'stream.seScore',
    'stream.nSeScore',
    'stream.seMatched',
    'stream.rseMatched',
  ],
};

export function tabHasUsedField(
  tab: string,
  used: ReadonlySet<string>
): boolean {
  return (TAB_FIELDS[tab] ?? []).some((field) => used.has(field));
}

export function inferredDeliveryLabel(input: PreviewInput): string {
  const info = inferStreamUrlFormat(input.streamUrl);
  return info.format === 'unknown' ? info.label : info.label;
}
