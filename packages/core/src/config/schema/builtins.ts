import { z } from 'zod';
import { positiveInt } from './helpers.js';
import type { RuntimeConfigSection } from '../types.js';

/**
 * Built-in addons.
 */
export const builtinsSchema = {
  tvheadend: {
    enabled: {
      schema: z.boolean(),
      default: true,
      label: 'TVHeadend enabled',
      description:
        'Allow users to add the TVHeadend provider. Disable on instances that must not reach user-supplied TVHeadend servers.',
      env: 'TVHEADEND_ENABLED',
      requiresRestart: false,
      secret: false,
    },
    disabledReason: {
      schema: z.string(),
      default: 'Disabled by this instance administrator',
      label: 'TVHeadend disabled reason',
      description:
        'Reason shown in the UI when TVHeadend is disabled for this instance.',
      env: 'TVHEADEND_DISABLED_REASON',
      requiresRestart: false,
      secret: false,
    },
    proxyEnabled: {
      schema: z.boolean(),
      default: false,
      label: 'TVHeadend proxy playback',
      description:
        'Allow video to be proxied through this AIOLiveTV instance. Keep false on public hosts unless you intentionally accept the bandwidth and trust model. Self-hosted LAN setups may set true.',
      env: 'TVHEADEND_PROXY_ENABLED',
      requiresRestart: false,
      secret: false,
    },
  },
  plutotv: {
    enabled: {
      schema: z.boolean(),
      default: true,
      label: 'Pluto TV enabled',
      description:
        'Allow users to add the Pluto TV provider (community M3U + XMLTV regional catalogs for live channels, EPG and streams).',
      env: 'PLUTOTV_ENABLED',
      requiresRestart: false,
      secret: false,
    },
    disabledReason: {
      schema: z.string(),
      default: 'Disabled by this instance administrator',
      label: 'Pluto TV disabled reason',
      description:
        'Reason shown in the UI when Pluto TV is disabled for this instance.',
      env: 'PLUTOTV_DISABLED_REASON',
      requiresRestart: false,
      secret: false,
    },
  },
  export: {
    enabled: {
      schema: z.boolean(),
      default: true,
      label: 'M3U / XMLTV export enabled',
      description:
        'Allow users to export Live TV playlists (M3U) and guides (XMLTV) for Jellyfin and other players.',
      env: 'EXPORT_ENABLED',
      requiresRestart: false,
      secret: false,
    },
    disabledReason: {
      schema: z.string(),
      default: 'Disabled by this instance administrator',
      label: 'Export disabled reason',
      description: 'Reason shown when M3U/XMLTV export is disabled.',
      env: 'EXPORT_DISABLED_REASON',
      requiresRestart: false,
      secret: false,
    },
    proxyEnabled: {
      schema: z.boolean(),
      default: false,
      label: 'Export stream proxy',
      description:
        'Allow exported playback URLs to proxy video through this instance. Independent from export itself — a public host may allow M3U/XMLTV without carrying video. Self-hosted setups may enable this when Jellyfin cannot reach sources directly.',
      env: 'EXPORT_PROXY_ENABLED',
      requiresRestart: false,
      secret: false,
    },
    epgWindowHours: {
      schema: positiveInt,
      default: 48,
      label: 'Export EPG window (hours)',
      description:
        'How many hours of future programme data to include in exported XMLTV guides.',
      env: 'EXPORT_EPG_WINDOW_HOURS',
      requiresRestart: false,
      secret: false,
    },
  },
} as const satisfies RuntimeConfigSection;
