import type { ParsedFile, ParsedStream, UserData } from '../db/index.js';
import { parseDeclaredStreamInfo } from '../streams/declared.js';
import { CHANNEL_TYPE, LIVE_STREAM_TYPE, TV_TYPE } from '../utils/constants.js';
import type { ChannelStreamSource } from '../db/channelMapping.js';
import {
  compactChannelName,
  containsAsWordSequence,
  getChannelNameSimilarity,
  normalizeChannelGroup,
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
  hasSchedule?: boolean;
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

/** Catalog+stream builtins already key streams by the same channel id. */
export function bindsOwnCatalogStreams(source: {
  contributesChannels?: boolean;
  canStream?: boolean;
}): boolean {
  return Boolean(source.contributesChannels && source.canStream);
}

export function getChannelMapping(userData: UserData, channelId: string) {
  channelId = getCanonicalChannelId(channelId);
  return userData.channelMappings?.find((channel) => channel.id === channelId);
}

export function findChannelMappingForId(userData: UserData, channelId: string) {
  const canonicalId = getCanonicalChannelId(channelId);
  return userData.channelMappings?.find(
    (mapping) =>
      mapping.id === canonicalId ||
      mapping.streams?.some((stream) => stream.channelId === canonicalId)
  );
}

export function deduplicateLiveTvItems<
  T extends { id: string; name?: string | null },
>(userData: UserData, items: T[]): T[] {
  const kept: T[] = [];
  const seenMappingIds = new Set<string>();

  for (const item of items) {
    if (!isLiveChannelVisible(userData, item.id)) continue;

    const mapping = findChannelMappingForId(userData, item.id);
    if (mapping) {
      if (mapping.id !== getCanonicalChannelId(item.id)) continue;
      if (seenMappingIds.has(mapping.id)) continue;
      seenMappingIds.add(mapping.id);
      kept.push(item);
      continue;
    }

    kept.push(item);
  }

  return kept;
}

export function isLiveChannelVisible(userData: UserData, channelId: string) {
  const mapping = getChannelMapping(userData, channelId);
  if (!mapping) return true;
  if (mapping.hidden) return false;
  if (mapping.enabled === false) return false;
  return true;
}

export function getEffectiveChannelGroup(
  userData: UserData,
  channelId: string,
  sourceGroup?: string
): string | undefined {
  const override = normalizeChannelGroup(
    getChannelMapping(userData, channelId)?.group
  );
  return override || normalizeChannelGroup(sourceGroup);
}

export function applyLiveChannelGroupOverlay<
  T extends {
    id: string;
    name?: string | null;
    poster?: string | null;
    logo?: string | null;
    genres?: string[] | null;
  },
>(userData: UserData, items: T[]): T[] {
  return items.map((item) => {
    const mapping = getChannelMapping(userData, item.id);
    const group = getEffectiveChannelGroup(
      userData,
      item.id,
      Array.isArray(item.genres) ? item.genres[0] : undefined
    );
    const name = mapping?.name?.trim();
    const poster = mapping?.poster?.trim();
    return {
      ...item,
      ...(name ? { name } : {}),
      ...(poster ? { poster, logo: poster } : {}),
      ...(group ? { genres: [group] } : {}),
    };
  });
}

export function sortLiveCatalogItems<
  T extends { id: string; name?: string | null },
>(items: T[]): T[] {
  return [...items].sort((left, right) =>
    (left.name ?? left.id).localeCompare(right.name ?? right.id, undefined, {
      sensitivity: 'base',
    })
  );
}

function normaliseId(value?: string) {
  return decodeHtmlEntities(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Normalized once per candidate and reused throughout a Channels scan. */
export function prepareChannelMatchCandidate(candidate: ChannelMatchCandidate) {
  return {
    id: normaliseId(candidate.id),
    tvgId: normaliseId(candidate.tvgId),
    country: normaliseId(candidate.country),
    language: normaliseId(candidate.language),
    logo: normaliseId(candidate.logo),
    categories: new Set(
      (candidate.categories ?? []).map(normalizeChannelName).filter(Boolean)
    ),
    names: [
      ...(candidate.name ? [{ value: candidate.name, alias: false }] : []),
      ...(candidate.aliases ?? []).map((value) => ({ value, alias: true })),
    ].map(({ value, alias }) => {
      const normalized = normalizeChannelName(value);
      return { normalized, compact: normalized.replace(/\s+/g, ''), alias };
    }),
  };
}

export type PreparedChannelMatchCandidate = ReturnType<
  typeof prepareChannelMatchCandidate
>;

function equalPreparedId(left: string, right: string) {
  return Boolean(left && left === right);
}

export function getPreparedChannelMatchConfidence(
  left: PreparedChannelMatchCandidate,
  right: PreparedChannelMatchCandidate
) {
  if (
    equalPreparedId(left.tvgId, right.tvgId) ||
    equalPreparedId(left.tvgId, right.id) ||
    equalPreparedId(left.id, right.tvgId)
  ) {
    return 1;
  }

  let best = 0;
  for (const a of left.names) {
    for (const b of right.names) {
      if (!a.normalized || !b.normalized) continue;
      const alias = a.alias || b.alias;
      let score: number;
      if (
        a.normalized === b.normalized ||
        (a.compact.length >= 2 && a.compact === b.compact)
      ) {
        score = alias ? 0.88 : 0.9;
      } else {
        if (Math.min(a.compact.length, b.compact.length) <= 3) continue;
        // Dice already removes spaces, so the normalized-name pass is redundant.
        score = getChannelNameSimilarity(a.compact, b.compact);
        const shorter =
          a.compact.length <= b.compact.length ? a.compact : b.compact;
        const longer =
          a.compact.length > b.compact.length ? a.compact : b.compact;
        const shortNorm =
          a.normalized.length <= b.normalized.length
            ? a.normalized
            : b.normalized;
        const longNorm =
          a.normalized.length > b.normalized.length
            ? a.normalized
            : b.normalized;
        if (
          shorter.length >= 4 &&
          ((shorter.length >= 5 && longer.includes(shorter)) ||
            containsAsWordSequence(longNorm, shortNorm))
        ) {
          score = Math.max(score, 0.85);
        }
        if (alias) score = Math.min(score, 0.88);
      }
      best = Math.max(best, score);
    }
  }
  if (!best) return 0;
  if (equalPreparedId(left.country, right.country)) best += 0.03;
  if (equalPreparedId(left.language, right.language)) best += 0.03;
  for (const category of right.categories) {
    if (left.categories.has(category)) {
      best += 0.02;
      break;
    }
  }
  if (equalPreparedId(left.logo, right.logo)) best += 0.02;
  return Math.min(best, 0.99);
}

export function getChannelMatchConfidence(
  left: ChannelMatchCandidate,
  right: ChannelMatchCandidate
) {
  return getPreparedChannelMatchConfidence(
    prepareChannelMatchCandidate(left),
    prepareChannelMatchCandidate(right)
  );
}

export function findPossibleDuplicateChannels(
  channels: Array<{ id: string; name: string; enabled?: boolean }>
): Array<{ name: string; channelIds: string[] }> {
  const groups = new Map<string, { name: string; channelIds: string[] }>();
  for (const channel of channels) {
    if (channel.enabled === false) continue;
    const key = compactChannelName(channel.name);
    if (key.length < 2) continue;
    const group = groups.get(key);
    if (group) {
      group.channelIds.push(channel.id);
    } else {
      groups.set(key, { name: channel.name, channelIds: [channel.id] });
    }
  }
  return [...groups.values()].filter((group) => group.channelIds.length > 1);
}

export const CHANNEL_AUTO_MERGE_CONFIDENCE = 0.9;
export const CHANNEL_LINK_STREAM_CONFIDENCE = 0.5;

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

function compactHeaders(
  headers: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const compact = Object.fromEntries(
    Object.entries(headers).filter(
      ([name, value]) => name.trim() && value.trim()
    )
  );
  return Object.keys(compact).length ? compact : undefined;
}

function parsedFileForManualSource(
  source: ChannelStreamSource
): ParsedFile | undefined {
  const declared = parseDeclaredStreamInfo({ name: source.name });
  const languages = source.languages?.length
    ? source.languages
    : (declared?.parsedFile.languages ?? []);
  const audioChannels = source.audioChannels?.length
    ? source.audioChannels
    : (declared?.parsedFile.audioChannels ?? []);
  const visualTags = source.visualTags?.length
    ? source.visualTags
    : (declared?.parsedFile.visualTags ?? []);
  const parsedFile: ParsedFile = {
    audioChannels,
    visualTags,
    audioTags: declared?.parsedFile.audioTags ?? [],
    languages,
    resolution: source.resolution ?? declared?.parsedFile.resolution,
    encode: source.encode ?? declared?.parsedFile.encode,
    quality: source.quality ?? declared?.parsedFile.quality,
  };
  if (
    !parsedFile.resolution &&
    !parsedFile.encode &&
    !parsedFile.quality &&
    !parsedFile.languages.length &&
    !parsedFile.audioChannels.length &&
    !parsedFile.visualTags.length
  ) {
    return undefined;
  }
  return parsedFile;
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
    .map((source, index) => {
      const requestHeaders = compactHeaders(source.headers);
      const name = source.name ?? 'Manual HLS';
      return {
        id: `manual-${channelId}-${source.channelId ?? index}`,
        type: LIVE_STREAM_TYPE,
        url: source.url!,
        filename: name,
        originalName: name,
        message: name,
        parsedFile: parsedFileForManualSource(source),
        requestHeaders,
        notWebReady: requestHeaders ? true : undefined,
        addon: {
          instanceId: MANUAL_STREAM_ADDON_ID,
          name: 'Manual HLS',
          manifestUrl: 'https://aiolivetv.local/manual',
          enabled: true,
          timeout: 10_000,
          preset: { id: '', type: 'manual', options: {} },
        },
      };
    });
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
