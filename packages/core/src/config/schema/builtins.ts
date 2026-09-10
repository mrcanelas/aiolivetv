import { z } from 'zod';
import {
  boolOrList,
  positiveInt,
  seconds,
  serviceTimeMap,
  urlString,
} from './helpers.js';
import type { RuntimeConfigSection } from '../types.js';

const titleLangMap = z.union([
  z.record(z.string(), z.array(z.string())),
  z.string().transform((value) => {
    const out: Record<string, string[]> = {};
    if (!value.trim()) return out;
    let currentKey: string | null = null;
    for (const token of value
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)) {
      const colon = token.indexOf(':');
      if (colon !== -1) {
        currentKey = token.slice(0, colon).trim().toLowerCase();
        const first = token
          .slice(colon + 1)
          .trim()
          .toLowerCase();
        if (currentKey) out[currentKey] = first ? [first] : [];
      } else if (currentKey) {
        out[currentKey].push(token.toLowerCase());
      }
    }
    return out;
  }),
]);

const debridStore = z.enum(['redis', 'sql', 'memory']);
const boolOrDebridStore = z.union([z.boolean(), debridStore]);

const Day = 86400;
const Week = 7 * Day;

/**
 * Built-in addons.
 */
export const builtinsSchema = {
  stremthru: {
    url: {
      schema: urlString,
      default: 'https://stremthru.13377001.xyz',
      label: 'StremThru URL',
      description:
        'Base URL of the StremThru instance used by the built-in addons.',
      env: 'BUILTIN_STREMTHRU_URL',
      requiresRestart: false,
      secret: false,
    },
    torboxUsenetViaStremthru: {
      schema: z.boolean(),
      default: false,
      label: 'Torbox usenet via StremThru',
      description:
        'Route Torbox usenet operations entirely through StremThru rather than the Torbox API.',
      env: 'TORBOX_USENET_VIA_STREMTHRU',
      requiresRestart: true,
      secret: false,
    },
  },
  debrid: {
    instantAvailabilityCacheTtl: {
      schema: seconds,
      default: 1800,
      label: 'Instant availability cache TTL (s)',
      description: 'Cache TTL for instant-availability checks.',
      env: 'BUILTIN_DEBRID_INSTANT_AVAILABILITY_CACHE_TTL',
      requiresRestart: false,
      secret: false,
    },
    playbackLinkCacheTtl: {
      schema: seconds,
      default: 3600,
      label: 'Playback link cache TTL (s)',
      description: 'Cache TTL for resolved playback links.',
      env: 'BUILTIN_DEBRID_PLAYBACK_LINK_CACHE_TTL',
      requiresRestart: false,
      secret: false,
    },
    errorCacheTtl: {
      schema: seconds,
      default: 3600,
      label: 'Error cache TTL (s)',
      description:
        'How long content-level failures (e.g. download status = failed/invalid) are cached globally to suppress retries.',
      env: 'BUILTIN_DEBRID_ERROR_CACHE_TTL',
      requiresRestart: false,
      secret: false,
    },
    libraryCacheTtl: {
      schema: seconds,
      default: Week,
      label: 'Library cache TTL (s)',
      description: 'Cache TTL for library list results (listMagnets/listNzbs).',
      env: 'BUILTIN_DEBRID_LIBRARY_CACHE_TTL',
      requiresRestart: false,
      secret: false,
    },
    libraryStaleThreshold: {
      schema: seconds,
      default: 600,
      label: 'Library stale threshold (s)',
      description:
        'Time after which cached library data is treated as stale (background refresh while serving cached data).',
      env: 'BUILTIN_DEBRID_LIBRARY_STALE_THRESHOLD',
      requiresRestart: false,
      secret: false,
    },
    libraryPageLimit: {
      schema: positiveInt,
      default: 1,
      label: 'Library page limit',
      description: 'Maximum pages fetched per listMagnets / listNzbs request.',
      env: 'BUILTIN_DEBRID_LIBRARY_PAGE_LIMIT',
      requiresRestart: false,
      secret: false,
    },
    libraryPageSize: {
      schema: positiveInt,
      default: 500,
      label: 'Library page size',
      description:
        'Maximum items per page when listing library items. StremThru caps at 500, Torbox at 1000.',
      env: 'BUILTIN_DEBRID_LIBRARY_PAGE_SIZE',
      requiresRestart: false,
      secret: false,
    },
    useTorrentDownloadUrl: {
      schema: z.boolean(),
      default: true,
      label: 'Use torrent download URLs',
      description:
        'Prefer .torrent URLs over magnets for better private-tracker compatibility.',
      env: 'BUILTIN_DEBRID_USE_TORRENT_DOWNLOAD_URL',
      requiresRestart: false,
      secret: false,
    },
    metadataStore: {
      schema: z.union([debridStore, z.null()]),
      default: null,
      label: 'Metadata store',
      description:
        'Backend used to persist debrid metadata. Defaults to the platform-default when unset.',
      env: 'BUILTIN_DEBRID_METADATA_STORE',
      requiresRestart: true,
      secret: false,
    },
    fileinfoStore: {
      schema: boolOrDebridStore,
      default: true,
      label: 'Fileinfo store',
      description:
        'Backend (or `true`/`false`) used for the debrid fileinfo store.',
      env: 'BUILTIN_DEBRID_FILEINFO_STORE',
      requiresRestart: true,
      secret: false,
    },
    playbackLinkValidity: {
      schema: seconds,
      default: Day,
      label: 'Playback link validity (s)',
      description:
        'How long a generated playback link is treated as valid (seconds).',
      env: 'BUILTIN_PLAYBACK_LINK_VALIDITY',
      requiresRestart: false,
      secret: false,
    },
    downloadPollInterval: {
      schema: serviceTimeMap,
      default: {
        nzbdav: 2000,
        altmount: 2000,
        stremthru_newz: 2000,
        '*': 10000,
      } as Record<string, number>,
      label: 'Download poll intervals (ms)',
      description:
        'Per-service download-status poll interval. Env shape: `service:duration,...`. Wildcard `*` covers unlisted services.',
      env: 'BUILTIN_DOWNLOAD_POLL_INTERVAL',
      requiresRestart: false,
      secret: false,
    },
    downloadMaxWaitTime: {
      schema: serviceTimeMap,
      default: {
        nzbdav: 90000,
        altmount: 90000,
        stremthru_newz: 90000,
        '*': 120000,
      } as Record<string, number>,
      label: 'Download max wait times (ms)',
      description:
        'Per-service maximum wait time before timing out a download check. Env shape: `service:duration,...`.',
      env: 'BUILTIN_DOWNLOAD_MAX_WAIT_TIME',
      requiresRestart: false,
      secret: false,
    },
  },
  scrape: {
    withAllTitles: {
      schema: boolOrList,
      default: false,
      label: 'Scrape with alternative titles',
      description: {
        ui: 'Use alternative titles when scraping built-in addons. Either a boolean or a comma-separated hostname list.',
        env: 'By default, built-in addons only use the primary title for text-based queries. `true` enables all alternative titles for every indexer; `false` (default) uses the primary title only; a comma-separated hostname list (e.g. `jackett,knaben.org`) enables it only for those indexers. Superseded per-indexer by BUILTIN_SCRAPE_TITLE_LANGUAGES.',
      },
      env: 'BUILTIN_SCRAPE_WITH_ALL_TITLES',
      requiresRestart: false,
      secret: false,
    },
    titleLanguages: {
      schema: titleLangMap,
      default: {} as Record<string, string[]>,
      label: 'Title languages',
      description: {
        ui: 'Per-domain control over which titles to use when scraping. Format: `domain:spec,...` where spec is one of `default`, `all`, `original`, or an ISO 639-1 code.',
        env:
          'Fine-grained alternative-title control, per indexer hostname, indexer name, or addon type. Supersedes BUILTIN_SCRAPE_WITH_ALL_TITLES. ' +
          'Format: `<key>:<spec>[,<spec>...][,<key>:<spec>...]`. ' +
          'Keys (checked in priority order): exact indexer hostname (e.g. `my-indexer.com`); auto-extracted indexer name (Jackett `/api/v2.0/indexers/<name>/...`, NZBHydra2 `?indexers=<name>`); addon-id (`newznab`, `torznab`, `easynews`, `knaben`, `prowlarr`, `torrent-galaxy`); `*` wildcard fallback. ' +
          'Specs: `default` (primary/English-style title), `all` (all alternative titles up to BUILTIN_SCRAPE_TITLE_LIMIT), `original` (TMDB original-language title), `<lang>` (ISO 639-1 code, e.g. `de`, `fr`). ' +
          'Multiple specs under one key are combined (duplicates removed); only the highest-priority matching key applies; always falls back to the primary title. ' +
          'Examples: `*:default,original` — every indexer gets default + TMDB original-language title. `*:default,newznab:default,original,de` — newznab indexers query English + original + German, others English only. `*:default,germanindexer.com:de,default` — germanindexer.com queries German + English, all others English only.',
      },
      env: 'BUILTIN_SCRAPE_TITLE_LANGUAGES',
      requiresRestart: false,
      secret: false,
    },
    titleLimit: {
      schema: positiveInt,
      default: 3,
      label: 'Title limit',
      description: 'Maximum alternative titles used per scrape.',
      env: 'BUILTIN_SCRAPE_TITLE_LIMIT',
      requiresRestart: false,
      secret: false,
    },
    queryConcurrency: {
      schema: positiveInt,
      default: 5,
      label: 'Query concurrency',
      description: 'Maximum concurrent scrape queries.',
      env: 'BUILTIN_SCRAPE_QUERY_CONCURRENCY',
      requiresRestart: false,
      secret: false,
    },
  },
  getTorrent: {
    timeout: {
      schema: positiveInt,
      default: 5000,
      label: 'Get-torrent timeout (ms)',
      description: 'Timeout for fetching torrent files.',
      env: 'BUILTIN_GET_TORRENT_TIMEOUT',
      requiresRestart: false,
      secret: false,
    },
    concurrency: {
      schema: positiveInt,
      default: 100,
      label: 'Get-torrent concurrency',
      description: 'Maximum concurrent torrent fetches.',
      env: 'BUILTIN_GET_TORRENT_CONCURRENCY',
      requiresRestart: false,
      secret: false,
    },
    lazily: {
      schema: z.boolean(),
      default: true,
      label: 'Lazy torrent fetching',
      description:
        'Fetch torrents lazily in the background. First search returns immediately with available results.',
      env: 'BUILTIN_GET_TORRENT_LAZILY',
      requiresRestart: false,
      secret: false,
    },
  },
  torrent: {
    metadataCacheTtl: {
      schema: seconds,
      default: Week,
      label: 'Torrent metadata cache TTL (s)',
      description: 'Cache TTL for torrent metadata.',
      env: 'BUILTIN_TORRENT_METADATA_CACHE_TTL',
      requiresRestart: false,
      secret: false,
    },
    minimumBackgroundRefreshInterval: {
      schema: seconds,
      default: Day,
      label: 'Minimum background refresh interval (s)',
      description:
        'Minimum interval between background search-cache refreshes triggered during normal searches.',
      env: 'BUILTIN_MINIMUM_BACKGROUND_REFRESH_INTERVAL',
      requiresRestart: false,
      secret: false,
    },
  },
} as const satisfies RuntimeConfigSection;
