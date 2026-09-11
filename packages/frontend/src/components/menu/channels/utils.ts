import type {
  ChannelInfo,
  ChannelsResponse,
  UnmatchedStreamInfo,
} from '@/lib/api';

export function isChannelSuggestion(confidence: number) {
  return confidence > 0 && confidence < 0.9;
}

export function countSuggestions(channels: ChannelInfo[]) {
  return channels.reduce(
    (total, channel) =>
      total +
      channel.mappings.filter((mapping) =>
        isChannelSuggestion(mapping.confidence)
      ).length,
    0
  );
}

export function getMappingStats(channel: ChannelInfo) {
  const total = channel.mappings.length;
  const pending = channel.mappings.filter((mapping) =>
    isChannelSuggestion(mapping.confidence)
  ).length;
  const accepted = total - pending;
  return { accepted, pending, total };
}

export function getChannelSourceLabel(channel: ChannelInfo) {
  const canonical = channel.mappings.find(
    (mapping) => mapping.addonId === channel.canonicalAddonId
  );
  return canonical?.addonName ?? channel.mappings[0]?.addonName ?? 'Other';
}

export type ChannelSortMode = 'alphabetical' | 'source';

export const MANUAL_STREAM_ADDON_ID = 'manual';

export function buildManualStreamChannelId(url: string) {
  return `manual:${encodeURIComponent(url)}`;
}

export function isManualStreamMapping(mapping: {
  addonId: string;
  url?: string | null;
}) {
  return Boolean(mapping.url) || mapping.addonId === MANUAL_STREAM_ADDON_ID;
}

export function isValidStreamUrl(url: string) {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function sortChannels(
  channels: ChannelInfo[],
  mode: ChannelSortMode
): ChannelInfo[] {
  if (mode === 'alphabetical') {
    return [...channels].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );
  }
  return [...channels].sort((a, b) => {
    const sourceCompare = getChannelSourceLabel(a).localeCompare(
      getChannelSourceLabel(b),
      undefined,
      { sensitivity: 'base' }
    );
    if (sourceCompare !== 0) return sourceCompare;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

export function groupChannelsBySource(channels: ChannelInfo[]) {
  const groups = new Map<string, ChannelInfo[]>();
  for (const channel of channels) {
    const label = getChannelSourceLabel(channel);
    const list = groups.get(label) ?? [];
    list.push(channel);
    groups.set(label, list);
  }
  return [...groups.entries()].sort(([a], [b]) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
}

export function emptyChannelsResponse(): ChannelsResponse {
  return {
    channels: [],
    sources: [],
    unmatchedStreams: [],
    unavailableStreams: [],
    duplicates: [],
  };
}

export function asChannelsResponse(
  data: ChannelsResponse | ChannelInfo[] | undefined
): ChannelsResponse {
  if (!data) return emptyChannelsResponse();
  if (Array.isArray(data)) {
    return { ...emptyChannelsResponse(), channels: data };
  }
  return {
    channels: data.channels ?? [],
    sources: data.sources ?? [],
    unmatchedStreams: data.unmatchedStreams ?? [],
    unavailableStreams: data.unavailableStreams ?? [],
    duplicates: data.duplicates ?? [],
  };
}

export function channelHasPlayableStream(channel: ChannelInfo) {
  return channel.mappings.some(
    (mapping) =>
      mapping.canStream &&
      mapping.enabled &&
      !isChannelSuggestion(mapping.confidence)
  );
}

export function channelHasSchedule(channel: ChannelInfo) {
  return (
    channel.epgProvider === true ||
    channel.mappings.some((mapping) => mapping.epgProvider)
  );
}

export type ChannelReviewFilter =
  | 'all'
  | 'no-stream'
  | 'suggestions'
  | 'duplicates'
  | 'no-schedule'
  | 'unmatched'
  | 'unavailable';

export function compactChannelLabel(name: string) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(hd|fhd|uhd|4k|sd|tv|channel|canal|live)\b/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

export function findDuplicateGroups(channels: ChannelInfo[]) {
  const groups = new Map<string, { name: string; channelIds: string[] }>();
  for (const channel of channels) {
    if (!channel.enabled) continue;
    const key = compactChannelLabel(channel.name);
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

export function filterChannelsByReview(
  channels: ChannelInfo[],
  filter: ChannelReviewFilter,
  duplicateIds: Set<string>
) {
  switch (filter) {
    case 'no-stream':
      return channels.filter(
        (channel) => channel.enabled && !channelHasPlayableStream(channel)
      );
    case 'suggestions':
      return channels.filter((channel) =>
        channel.mappings.some((mapping) =>
          isChannelSuggestion(mapping.confidence)
        )
      );
    case 'duplicates':
      return channels.filter((channel) => duplicateIds.has(channel.id));
    case 'no-schedule':
      return channels.filter(
        (channel) => channel.enabled && !channelHasSchedule(channel)
      );
    case 'unmatched':
    case 'unavailable':
      return channels;
    default:
      return channels;
  }
}

export function visibleUnmatchedStreams(
  unmatched: UnmatchedStreamInfo[],
  channels: ChannelInfo[]
) {
  const bound = new Set(
    channels.flatMap((channel) =>
      channel.mappings.map(
        (mapping) => `${mapping.addonId}\0${mapping.channelId}`
      )
    )
  );
  return unmatched.filter(
    (item) => !bound.has(`${item.addonId}\0${item.channelId}`)
  );
}

export function formatDurationMs(ms: number) {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function formatFetchedAt(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}
