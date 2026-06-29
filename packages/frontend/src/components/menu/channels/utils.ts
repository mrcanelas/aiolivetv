import type { ChannelInfo } from '@/lib/api';

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
