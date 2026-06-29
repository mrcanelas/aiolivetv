import type { ParsedStream, UserData } from '../db/index.js';
import { CHANNEL_TYPE, LIVE_STREAM_TYPE, TV_TYPE } from '../utils/constants.js';
import {
  compactChannelName,
  containsNormalizedChannelName,
  getChannelNameSimilarity,
  normalizeChannelName,
} from '../utils/channelName.js';
import { decodeHtmlEntities } from '../utils/text.js';

export interface ChannelMatchCandidate {
  id: string;
  name: string;
  tvgId?: string;
  aliases?: string[];
  country?: string;
  language?: string;
  categories?: string[];
  logo?: string;
}

export function getCanonicalChannelId(id: string) {
  return id.split(':epg:', 1)[0];
}

export const MANUAL_STREAM_ADDON_ID = 'manual' as const;

export function isManualStreamSource(source: {
  addonId?: string;
  url?: string;
}) {
  return Boolean(source.url) || source.addonId === MANUAL_STREAM_ADDON_ID;
}

export function isLiveChannelType(type: string) {
  return type === CHANNEL_TYPE || type === TV_TYPE;
}

export function getChannelMapping(userData: UserData, channelId: string) {
  channelId = getCanonicalChannelId(channelId);
  return userData.channelMappings?.find((channel) => channel.id === channelId);
}

function normaliseId(value?: string) {
  return decodeHtmlEntities(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function equalId(left?: string, right?: string) {
  const normalizedLeft = normaliseId(left);
  return Boolean(normalizedLeft && normalizedLeft === normaliseId(right));
}

function equalOptional(a?: string, b?: string) {
  const left = normaliseId(a);
  return Boolean(left && left === normaliseId(b));
}

function overlaps(left: string[] = [], right: string[] = []) {
  const values = new Set(left.map(normalizeChannelName).filter(Boolean));
  return right.some((value) => values.has(normalizeChannelName(value)));
}

function collectNameEntries(candidate: ChannelMatchCandidate) {
  const entries: Array<{ value: string; alias: boolean }> = [];
  if (candidate.name) entries.push({ value: candidate.name, alias: false });
  for (const alias of candidate.aliases ?? []) {
    entries.push({ value: alias, alias: true });
  }
  return entries;
}

function scoreNamePair(
  left: { value: string; alias: boolean },
  right: { value: string; alias: boolean }
) {
  const leftNorm = normalizeChannelName(left.value);
  const rightNorm = normalizeChannelName(right.value);
  if (!leftNorm || !rightNorm) return 0;

  const aliasMatch = left.alias || right.alias;
  const leftCompact = compactChannelName(left.value);
  const rightCompact = compactChannelName(right.value);
  const minCompact = Math.min(leftCompact.length, rightCompact.length);

  if (
    leftNorm === rightNorm ||
    (leftCompact.length >= 2 && leftCompact === rightCompact)
  ) {
    return aliasMatch ? 0.88 : 0.9;
  }

  if (minCompact <= 3) return 0;

  let score = Math.max(
    getChannelNameSimilarity(leftNorm, rightNorm),
    getChannelNameSimilarity(leftCompact, rightCompact)
  );

  if (
    containsNormalizedChannelName(left.value, right.value) ||
    containsNormalizedChannelName(right.value, left.value)
  ) {
    score = Math.max(score, 0.85);
  }

  if (!score) return 0;
  if (aliasMatch) return Math.min(score, 0.88);
  return score;
}

function matchNormalizedNames(
  left: ChannelMatchCandidate,
  right: ChannelMatchCandidate
) {
  let best = 0;
  for (const leftEntry of collectNameEntries(left)) {
    for (const rightEntry of collectNameEntries(right)) {
      best = Math.max(best, scoreNamePair(leftEntry, rightEntry));
    }
  }
  return best;
}

export function getChannelMatchConfidence(
  left: ChannelMatchCandidate,
  right: ChannelMatchCandidate
) {
  if (
    equalId(left.tvgId, right.tvgId) ||
    equalId(left.tvgId, right.id) ||
    equalId(left.id, right.tvgId)
  ) {
    return 1;
  }

  let score = matchNormalizedNames(left, right);
  if (!score) return 0;

  if (equalOptional(left.country, right.country)) score += 0.03;
  if (equalOptional(left.language, right.language)) score += 0.03;
  if (overlaps(left.categories, right.categories)) score += 0.02;
  if (equalOptional(left.logo, right.logo)) score += 0.02;
  return Math.min(score, 0.99);
}

export const CHANNEL_AUTO_MERGE_CONFIDENCE = 0.9;

export const isHighConfidenceChannelMatch = (confidence: number) =>
  confidence >= CHANNEL_AUTO_MERGE_CONFIDENCE;

export const isChannelMappingSuggestion = (confidence: number) =>
  confidence > 0 && confidence < CHANNEL_AUTO_MERGE_CONFIDENCE;

export function isChannelAddonEnabled(
  userData: UserData,
  channelId: string,
  addonId: string,
  streamChannelId?: string
) {
  return (
    getChannelMapping(userData, channelId)?.streams?.find((stream) =>
      streamChannelId
        ? stream.channelId === streamChannelId
        : stream.addonId === addonId
    )?.enabled !== false
  );
}

export function buildManualParsedStreams(
  userData: UserData,
  channelId: string
): ParsedStream[] {
  const mapping = getChannelMapping(userData, channelId);
  if (!mapping?.streams) return [];
  return mapping.streams
    .filter(
      (source) =>
        source.url &&
        source.addonId === MANUAL_STREAM_ADDON_ID &&
        source.enabled !== false
    )
    .map((source, index) => ({
      id: `manual-${channelId}-${source.channelId ?? index}`,
      type: LIVE_STREAM_TYPE,
      url: source.url!,
      message: source.name ?? 'Manual HLS',
      addon: {
        instanceId: MANUAL_STREAM_ADDON_ID,
        name: 'Manual HLS',
        manifestUrl: 'https://aiolivetv.local/manual',
        enabled: true,
        timeout: 10_000,
        preset: { id: '', type: 'manual', options: {} },
      },
    }));
}

export function orderLiveStreamsByMapping(
  fetched: ParsedStream[],
  manual: ParsedStream[],
  sources: NonNullable<ReturnType<typeof getChannelMapping>>['streams']
): ParsedStream[] {
  if (!sources?.length) return [...manual, ...fetched];
  const fetchedByAddon = new Map<string, ParsedStream[]>();
  for (const stream of fetched) {
    const addonId = stream.addon.instanceId ?? stream.addon.preset.id;
    const list = fetchedByAddon.get(addonId) ?? [];
    list.push(stream);
    fetchedByAddon.set(addonId, list);
  }
  const manualByUrl = new Map(
    manual
      .filter((stream) => stream.url)
      .map((stream) => [stream.url!, stream] as const)
  );
  const ordered: ParsedStream[] = [];
  for (const source of sources) {
    if (isManualStreamSource(source) && source.url) {
      const stream = manualByUrl.get(source.url);
      if (stream) ordered.push(stream);
      continue;
    }
    if (!source.addonId) continue;
    ordered.push(...(fetchedByAddon.get(source.addonId) ?? []));
  }
  return ordered.length ? ordered : [...manual, ...fetched];
}

export { normalizeChannelName } from '../utils/channelName.js';
