import type { UserData } from '../db/schemas.js';
import {
  getCanonicalChannelId,
  getEffectiveChannelGroup,
  isLiveChannelVisible,
} from '../main/channelMappings.js';

export type ExportChannel = {
  /** Stable id used as tvg-id / XMLTV channel id */
  id: string;
  name: string;
  logo?: string;
  group?: string;
  /** True when at least one enabled stream source is mapped */
  hasStreamSource: boolean;
  warning?: string;
};

/**
 * Build the export channel list from saved channelMappings.
 * Does not contact providers or start streams.
 */
export function collectExportChannels(userData: UserData): ExportChannel[] {
  const mappings = userData.channelMappings ?? [];
  const channels: ExportChannel[] = [];

  for (const mapping of mappings) {
    const id = getCanonicalChannelId(mapping.id);
    if (!isLiveChannelVisible(userData, id)) continue;

    const enabledStreams = (mapping.streams ?? []).filter(
      (stream) => stream.enabled !== false
    );
    const hasStreamSource = enabledStreams.length > 0;
    const name = (mapping.name || id).trim() || id;
    const group = getEffectiveChannelGroup(userData, id, mapping.group);
    const logo = mapping.poster?.trim() || undefined;

    channels.push({
      id,
      name,
      logo,
      group,
      hasStreamSource,
      warning: hasStreamSource
        ? undefined
        : 'Nenhuma fonte de reprodução habilitada neste canal',
    });
  }

  channels.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
  return channels;
}

/** Sanitize a value for use as M3U attribute / XMLTV channel id. */
export function toTvgId(channelId: string): string {
  return getCanonicalChannelId(channelId)
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\w.:@+/-]+/g, '_');
}
