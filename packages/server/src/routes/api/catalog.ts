import { iptvOrgSourceUrl, iptvEpgSourceUrl } from '@aiolivetv/core';
import { Router, Request, Response, NextFunction } from 'express';
import { createResponse } from '../../utils/responses.js';
import { catalogApiRateLimiter } from '../../middlewares/ratelimit.js';
import { attachSession, injectAccessKey } from '../../middlewares/auth.js';
import { z } from 'zod';
import {
  createLogger,
  UserData,
  AIOStreams,
  UserDataSchema,
  validateConfig,
  APIError,
  constants,
  UserRepository,
  mergeConfigs,
  getPreparedChannelMatchConfidence,
  prepareChannelMatchCandidate,
  type PreparedChannelMatchCandidate,
  isHighConfidenceChannelMatch,
  bindsOwnCatalogStreams,
  findPossibleDuplicateChannels,
  catalogSupportsSkip,
  addonProvidesResource,
  decodeHtmlEntities,
  MANUAL_STREAM_ADDON_ID,
  isManualStreamSource,
  isLiveChannelType,
  normalizeChannelGroup,
  parseDeclaredStreamInfo,
  type DeclaredStreamInfo,
  config as appConfig,
  Cache,
  getSimpleTextHash,
  M3uAddon,
  clearM3uSourceCache,
  clearXmltvSourceCache,
  TMDBMetadata,
} from '@aiolivetv/core';

const router: Router = Router();

const logger = createLogger('server');
const MAX_CHANNELS_PER_CATALOG = 50_000;
const MAX_STREAM_ONLY_CANDIDATES = 2_000;
const MAX_CATALOG_PAGES = 2_500;
const MAX_AUTO_MATCH_PAIRS = 5_000_000;
const PAGE_OVERLAP = 10;
const ONE_OFF_CATALOG =
  /(?:^|[^a-z])(?:events?|replays?|highlights?)(?:$|[^a-z])/i;

type Candidate = {
  id: string;
  name: string;
  poster?: string | null;
  addonId: string;
  addonName: string;
  epgProvider: boolean;
  canStream: boolean;
  contributesChannels: boolean;
  tvgId?: string;
  aliases?: string[];
  country?: string;
  language?: string;
  categories?: string[];
};
type SourceDiagnostic = {
  instanceId: string;
  name: string;
  presetType?: string;
  contributesChannels: boolean;
  canStream: boolean;
  epgProvider: boolean;
  ok: boolean;
  error?: string;
  durationMs: number;
  fetchedAt: string;
  channelCount: number;
  streamCount: number;
  programCount?: number;
  truncated?: boolean;
  skippedCatalogs?: string[];
};
const channelInventoryCache = Cache.getInstance<
  string,
  Array<{ diagnostic: SourceDiagnostic; found: Candidate[] } | undefined>
>('channel-scan-inventory', 16, 'memory');

/**
 * Wall-clock budget for one Channels scan (`resources.timeouts.channelScan` /
 * `CHANNEL_SCAN_BUDGET_MS`). When configured, the scan stops early and
 * returns what it has. Defaults to `0` (no limit).
 */
function channelScanBudgetMs(): number {
  const budget = appConfig.resources.timeouts.channelScan;
  return Number.isFinite(budget) && budget > 0 ? budget : 0;
}

type CatalogPageItem = {
  id: string;
  name?: string | null;
  poster?: string | null;
  tvgId?: string;
  aliases?: string[];
  country?: string;
  language?: string;
  genres?: string[] | null;
  videos?: Array<unknown> | null;
  behaviorHints?: { hasStreams?: boolean };
};

function catalogPageItems(response: {
  data: unknown[];
  metasDetailed?: unknown[];
}): CatalogPageItem[] {
  const items = response.metasDetailed?.length
    ? response.metasDetailed
    : response.data;
  return items as CatalogPageItem[];
}

function catalogErrorMessage(response: {
  errors: Array<{ title?: string; description?: string }>;
}) {
  const error = response.errors[0];
  return error?.description || error?.title || 'Catalog fetch failed';
}

router.use(catalogApiRateLimiter);
router.use(attachSession);

async function validateDraft(
  req: Request,
  userData: UserData,
  options?: { lenientAddons?: boolean; bypassManifestCache?: boolean }
) {
  let configToValidate: UserData = userData;
  if (userData.parentConfig?.uuid) {
    let parent: UserData;
    try {
      const rawParent = await UserRepository.getRawUser(
        userData.parentConfig.uuid,
        userData.parentConfig.password
      );
      if (!rawParent) throw new Error('Parent config not found');
      parent = rawParent;
    } catch (error) {
      throw new APIError(
        constants.ErrorCode.PARENT_CONFIG_UNAVAILABLE,
        undefined,
        error instanceof APIError ? error.message : String(error)
      );
    }
    const merged = mergeConfigs(parent, userData);
    merged.trusted = parent.trusted || userData.trusted;
    configToValidate = merged;
  }

  injectAccessKey(req, configToValidate);

  try {
    return await validateConfig(configToValidate, {
      // The Channels preview reports unreachable addons per source instead of
      // failing the whole scan because one manifest timed out.
      skipErrorsFromAddonsOrProxies: options?.lenientAddons === true,
      decryptValues: true,
      increasedManifestTimeout: true,
      bypassManifestCache: options?.bypassManifestCache ?? true,
    });
  } catch (error) {
    if (
      error instanceof APIError &&
      error.code === constants.ErrorCode.ADDON_PASSWORD_INVALID
    ) {
      throw new APIError(
        constants.ErrorCode.ADDON_PASSWORD_INVALID,
        undefined,
        'Please make sure the addon password is provided and correct by attempting to create/save a user first'
      );
    }
    throw new APIError(
      constants.ErrorCode.USER_INVALID_CONFIG,
      undefined,
      error instanceof Error ? error.message : undefined
    );
  }
}

router.post(
  '/tmdb/languages',
  async (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const auth = z
        .object({
          apiKey: z.string().trim().max(2048).optional(),
          accessToken: z.string().trim().max(4096).optional(),
        })
        .parse(req.body ?? {});
      const languages = await new TMDBMetadata(auth).getLanguages();
      res.json(createResponse({ success: true, data: { languages } }));
    } catch {
      res.status(400).json(
        createResponse({
          success: false,
          error: {
            code: 'TMDB_LANGUAGES_UNAVAILABLE',
            message:
              'Could not load TMDB languages. Check the API key or read access token and try again.',
          },
        })
      );
    }
  }
);

router.post(
  '/m3u/epg',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z
        .object({
          sourceUrl: z.url().refine((url) => /^https?:\/\//i.test(url)),
          timeout: z.number().int().positive().max(120_000).optional(),
        })
        .parse(req.body);
      const addon = new M3uAddon({
        sourceUrl: body.sourceUrl,
        timeout: body.timeout ?? 10_000,
        maxBytes: appConfig.resources.liveTvSourceMaxBytes,
      });
      res.json(
        createResponse({
          success: true,
          data: { urls: await addon.getEpgUrls() },
        })
      );
    } catch (error) {
      next(error);
    }
  }
);

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const { userData } = req.body;
  try {
    const validatedUserData = await validateDraft(req, userData);
    validatedUserData.catalogModifications = undefined;

    const aio = new AIOStreams(validatedUserData);
    await aio.initialise();
    // return minimal catalog data
    const catalogs = aio.getCatalogs().map((catalog) => ({
      id: catalog.id,
      name: catalog.name,
      type: catalog.type,
      addonName: aio.getAddon(catalog.id.split('.')[0])?.name,

      hideable: catalog.extra
        ? catalog.extra.every((e) => !e.isRequired)
        : true,
      searchable: catalog.extra
        ? catalog.extra?.findIndex(
            (e) => e.name === 'search' && !e.isRequired
          ) !== -1
        : false,
    }));
    res.status(200).json(createResponse({ success: true, data: catalogs }));
  } catch (error) {
    if (error instanceof APIError) {
      next(error);
    } else {
      next(new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR));
    }
  }
});

router.post(
  '/channels',
  async (req: Request, res: Response, next: NextFunction) => {
    // JSON whitespace keeps idle proxies alive without changing the API payload.
    const heartbeat = setInterval(() => {
      if (res.destroyed || res.writableEnded) return;
      if (!res.headersSent) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
      }
      res.write('\n');
    }, 5_000);
    const stopHeartbeat = () => clearInterval(heartbeat);
    res.once('close', stopHeartbeat);
    const respond = (
      status: number,
      body: ReturnType<typeof createResponse>
    ) => {
      stopHeartbeat();
      if (res.destroyed) return;
      if (res.headersSent) res.end(JSON.stringify(body));
      else res.status(status).json(body);
    };
    try {
      const scanStartedAt = Date.now();
      const scanBudgetMs = channelScanBudgetMs();
      const autoMatch = req.body.autoMatch === true;
      const requestDeadline =
        scanBudgetMs > 0
          ? scanStartedAt + scanBudgetMs
          : Number.POSITIVE_INFINITY;
      const sourceScanDeadline =
        autoMatch && scanBudgetMs > 0
          ? scanStartedAt + Math.floor(scanBudgetMs * 0.8)
          : requestDeadline;
      const withinScanBudget = async <T>(
        request: () => Promise<T>
      ): Promise<T | 'deadline'> => {
        const remaining = sourceScanDeadline - Date.now();
        if (remaining <= 0) return 'deadline';
        if (!Number.isFinite(remaining)) return request();
        let timer: NodeJS.Timeout | undefined;
        try {
          return await Promise.race([
            request(),
            new Promise<'deadline'>((resolve) => {
              timer = setTimeout(() => resolve('deadline'), remaining);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      };
      const alternativesFor =
        typeof req.body.alternativesFor === 'string'
          ? req.body.alternativesFor
          : undefined;
      if (req.body.refresh === true && !alternativesFor) {
        const { presets } = UserDataSchema.pick({ presets: true }).parse(
          req.body.userData
        );
        for (const preset of presets) {
          if (preset.type === 'iptv-org' || preset.type === 'iptv-epg') {
            const guide = preset.type === 'iptv-epg';
            const countries = preset.options.countries ?? [guide ? 'gb' : 'uk'];
            if (Array.isArray(countries))
              for (const country of countries) {
                if (guide) clearXmltvSourceCache(iptvEpgSourceUrl(country));
                else clearM3uSourceCache(iptvOrgSourceUrl(country));
              }
          }
          if (typeof preset.options.sourceUrl !== 'string') continue;
          if (preset.type === 'm3u')
            clearM3uSourceCache(preset.options.sourceUrl);
          if (preset.type === 'xmltv')
            clearXmltvSourceCache(preset.options.sourceUrl);
        }
      }
      const prepared = await withinScanBudget(async () => {
        const validatedUserData = await validateDraft(req, req.body.userData, {
          lenientAddons: true,
          bypassManifestCache: !alternativesFor,
        });
        if (Date.now() >= sourceScanDeadline) return 'deadline' as const;
        const configuredMappings = validatedUserData.channelMappings ?? [];
        validatedUserData.channelMappings = undefined;
        const aio = await new AIOStreams(validatedUserData, {
          bypassCatalogCache: req.body.refresh === true,
          bypassManifestCache: !alternativesFor,
        }).initialise();
        return { validatedUserData, configuredMappings, aio };
      });
      if (prepared === 'deadline') {
        respond(
          503,
          createResponse({
            success: false,
            error: {
              code: constants.ErrorCode.INTERNAL_SERVER_ERROR,
              message:
                'Channel scan timed out while initialising providers. Retry or check slow provider manifests.',
            },
          })
        );
        return;
      }
      const { validatedUserData, configuredMappings, aio } = prepared;
      const hiddenChannelIds = new Set(
        configuredMappings
          .filter((mapping) => mapping.hidden)
          .map((mapping) => mapping.id)
      );

      type Channel = {
        id: string;
        name: string;
        poster?: string | null;
        canonicalAddonId: string;
        enabled: boolean;
        epgProvider: boolean;
        group?: string;
        sourceGroup?: string;
        rejectedStreams: Array<{ addonId: string; channelId: string }>;
        mappings: Array<
          Candidate & {
            channelId: string;
            confidence: number;
            enabled: boolean;
            url?: string;
            headers?: Record<string, string>;
            resolution?: string;
            encode?: string;
            quality?: string;
            languages?: string[];
            audioChannels?: string[];
            visualTags?: string[];
            declared?: DeclaredStreamInfo | null;
          }
        >;
        availableStreamSources: Array<{
          addonId: string;
          addonName: string;
          channelId: string;
          name: string;
          poster?: string | null;
          confidence?: number;
        }>;
      };
      type UnavailableStream = {
        channelId: string;
        channelName: string;
        addonId: string;
        addonName: string;
        streamChannelId: string;
        name: string;
        reason: string;
      };
      const candidates = new Map<string, Candidate>();
      const rejectedPairs = new Set(
        configuredMappings.flatMap((mapping) =>
          (mapping.rejectedStreams ?? []).map(
            (rejected) =>
              `${mapping.id}\0${rejected.addonId}\0${rejected.channelId}`
          )
        )
      );
      const isRejected = (channelId: string, candidate: Candidate) =>
        rejectedPairs.has(
          `${channelId}\0${candidate.addonId}\0${candidate.id}`
        );

      const sources = new Map<string, SourceDiagnostic>();
      const todayUtc = new Date().toISOString().slice(0, 10);
      let scanTruncated = false;
      let matchingTruncated = false;
      let matchingPairs = 0;
      const matchingCheckpoint = async (yieldToRequests = false) => {
        if (yieldToRequests) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        if (
          matchingPairs >= MAX_AUTO_MATCH_PAIRS ||
          Date.now() >= requestDeadline ||
          res.destroyed
        ) {
          matchingTruncated = true;
          return false;
        }
        return true;
      };
      const nextMatchingPair = async () => {
        if (matchingPairs >= MAX_AUTO_MATCH_PAIRS) return matchingCheckpoint();
        if (
          matchingPairs % 128 === 0 &&
          !(await matchingCheckpoint(matchingPairs > 0))
        )
          return false;
        matchingPairs++;
        return true;
      };

      type CatalogPage = Awaited<ReturnType<typeof aio.getCatalog>>;
      // Fetch one catalog page, but never past the scan deadline. On a
      // platform with a hard request limit (Vercel), returning partial results
      // is far better than the whole request being killed with a 504.
      const fetchPageWithinBudget = async (
        type: string,
        catalogId: string,
        extras: string | undefined
      ): Promise<CatalogPage | 'deadline'> => {
        return withinScanBudget(() =>
          aio.getCatalog(type, catalogId, extras, { strictErrors: true }).catch(
            (error: unknown): CatalogPage => ({
              success: false,
              data: [],
              errors: [
                {
                  title: 'Catalog fetch failed',
                  description:
                    error instanceof Error ? error.message : String(error),
                },
              ],
            })
          )
        );
      };

      const scanAddon = async (
        addon: ReturnType<typeof aio.getAddons>[number]
      ): Promise<
        { diagnostic: SourceDiagnostic; found: Candidate[] } | undefined
      > => {
        const instanceId = addon.instanceId;
        if (!instanceId) return undefined;
        const startedAt = Date.now();
        const manifest = aio.getManifest(instanceId);
        if (!manifest) return undefined;
        const contributesChannels = addonProvidesResource(addon, 'catalog');
        const supportsStream = manifest.resources.some((resource) =>
          typeof resource === 'string'
            ? resource === 'stream'
            : resource.name === 'stream'
        );
        const canStream =
          supportsStream && addonProvidesResource(addon, 'stream');
        if (!contributesChannels && !canStream) return undefined;
        const epgProvider = manifest.behaviorHints?.epgProvider === true;
        const includeGuide =
          epgProvider &&
          ['xmltv', 'iptv-epg'].includes(addon.preset.type) &&
          manifest.catalogs.some((item) =>
            item.extra?.some((extra) => extra.name === 'date')
          );
        const diagnostic: SourceDiagnostic = {
          instanceId,
          name: addon.name,
          presetType: addon.preset.type,
          contributesChannels,
          canStream,
          epgProvider,
          ok: true,
          durationMs: 0,
          fetchedAt: new Date().toISOString(),
          channelCount: 0,
          streamCount: 0,
        };
        const found: Candidate[] = [];
        const foundKeys = new Set<string>();
        const errors: string[] = [];
        const skippedCatalogs: string[] = [];
        const markTruncated = (reason: string) => {
          scanTruncated = true;
          diagnostic.truncated = true;
          errors.push(reason);
        };
        let stopped = false;

        for (const catalog of manifest.catalogs.filter((item) =>
          isLiveChannelType(item.type)
        )) {
          const addonId = instanceId;
          if (
            canStream &&
            !contributesChannels &&
            ONE_OFF_CATALOG.test(`${catalog.id} ${catalog.name ?? ''}`)
          ) {
            skippedCatalogs.push(`${catalog.id} (one-off events)`);
            continue;
          }
          const catalogId = `${addonId}.${catalog.id}`;
          const paginated = catalogSupportsSkip(catalog.extra);
          const catalogHasDate = catalog.extra?.some(
            (extra) => extra.name === 'date'
          );
          // The scanner only ever supplies `skip` (and `date` for XMLTV
          // guides). A catalog that requires anything else (a search term,
          // a genre) cannot be listed and would only burn a timeout.
          const supplied = new Set<string>(['skip']);
          if (includeGuide && catalogHasDate) supplied.add('date');
          const missing = (catalog.extra ?? [])
            .filter((extra) => extra.isRequired && !supplied.has(extra.name))
            .map((extra) => extra.name);
          if (missing.length > 0) {
            skippedCatalogs.push(`${catalog.id} (needs ${missing.join(', ')})`);
            continue;
          }
          const maxCandidates = alternativesFor
            ? Number.POSITIVE_INFINITY
            : contributesChannels
              ? MAX_CHANNELS_PER_CATALOG
              : MAX_STREAM_ONLY_CANDIDATES;
          let skip = 0;
          let page = 0;
          let addonCandidateCount = 0;
          let nextPageBoundary: number | undefined;
          let supportsOverlap = true;
          let largestPageSize = 0;
          const seenCatalogItems = new Set<string>();
          while (true) {
            if (res.destroyed) {
              markTruncated(`${catalog.id}: channel scan cancelled`);
              stopped = true;
              break;
            }
            page++;
            if (!alternativesFor && page > MAX_CATALOG_PAGES) {
              markTruncated(
                `${catalog.id}: reached the ${MAX_CATALOG_PAGES} page scan limit; more channels may be available`
              );
              break;
            }
            const extras = [
              paginated ? `skip=${skip}` : undefined,
              addon.preset.type === 'xtream' ? 'limit=500' : undefined,
              includeGuide && catalogHasDate ? `date=${todayUtc}` : undefined,
            ]
              .filter(Boolean)
              .join('&');
            const response = await fetchPageWithinBudget(
              catalog.type,
              catalogId,
              extras || undefined
            );
            if (response === 'deadline') {
              scanTruncated = true;
              diagnostic.truncated = true;
              errors.push(
                `${catalog.id}: stopped at the ${Math.round(scanBudgetMs / 1000)}s scan time limit (page ${page})`
              );
              stopped = true;
              break;
            }
            if (!response.success) {
              // Some addons signal the end of pagination with HTTP 404.
              if (
                page > 1 &&
                seenCatalogItems.size > 0 &&
                /^404\s*-/.test(catalogErrorMessage(response))
              )
                break;
              errors.push(
                `${catalog.id}${page > 1 ? ` (page ${page})` : ''}: ${catalogErrorMessage(response)}`
              );
              break;
            }
            const items = catalogPageItems(response);
            let added = 0;
            for (const item of items) {
              if (addonCandidateCount >= maxCandidates) break;
              if (seenCatalogItems.has(item.id)) continue;
              seenCatalogItems.add(item.id);
              added++;
              if (Array.isArray(item.videos) && item.videos.length > 0) {
                diagnostic.programCount =
                  (diagnostic.programCount ?? 0) + item.videos.length;
              }
              const key = `${addonId}\0${item.id}`;
              if (foundKeys.has(key)) continue;
              foundKeys.add(key);
              addonCandidateCount++;
              found.push({
                id: item.id,
                name: decodeHtmlEntities(item.name ?? item.id),
                poster: item.poster,
                addonId,
                addonName: addon.name,
                epgProvider,
                canStream:
                  canStream && item.behaviorHints?.hasStreams !== false,
                contributesChannels,
                tvgId: typeof item.tvgId === 'string' ? item.tvgId : undefined,
                aliases: Array.isArray(item.aliases)
                  ? item.aliases.map((alias) => decodeHtmlEntities(alias))
                  : undefined,
                country:
                  typeof item.country === 'string' ? item.country : undefined,
                language:
                  typeof item.language === 'string' ? item.language : undefined,
                categories: Array.isArray(item.genres)
                  ? item.genres
                  : undefined,
              });
            }
            if (
              addonCandidateCount >= maxCandidates ||
              (!alternativesFor &&
                skip + items.length >= MAX_CHANNELS_PER_CATALOG)
            ) {
              markTruncated(
                `${catalog.id}: reached the ${maxCandidates} candidate scan limit; more channels may be available`
              );
              break;
            }
            if (!paginated || items.length === 0) break;
            if (added === 0) {
              // Some providers round an overlapping offset down to a page boundary.
              if (nextPageBoundary !== undefined) {
                skip = nextPageBoundary;
                nextPageBoundary = undefined;
                supportsOverlap = false;
                continue;
              }
              break;
            }
            // Limit overhead on small pages to roughly 10%, up to ten items.
            largestPageSize = Math.max(largestPageSize, items.length);
            const overlap =
              supportsOverlap &&
              items.length > 20 &&
              items.length === largestPageSize
                ? Math.min(PAGE_OVERLAP, Math.floor(items.length / 10))
                : 0;
            nextPageBoundary = overlap ? skip + items.length : undefined;
            skip += items.length - overlap;
          }
          if (stopped) break;
        }
        if (errors.length > 0) {
          diagnostic.ok = false;
          diagnostic.error = errors.join(' · ');
        }
        if (skippedCatalogs.length > 0) {
          diagnostic.skippedCatalogs = skippedCatalogs;
        }
        diagnostic.durationMs = Date.now() - startedAt;
        diagnostic.fetchedAt = new Date().toISOString();
        if (!diagnostic.ok) {
          logger.warn(
            {
              source: addon.name,
              err: diagnostic.error,
              durationMs: diagnostic.durationMs,
            },
            'channel scan source had errors'
          );
        }
        return { diagnostic, found };
      };

      // Sources are scanned in parallel: one slow addon no longer delays the
      // others. Pages within a single catalog remain sequential.
      const inventoryKey = getSimpleTextHash(
        JSON.stringify({
          config: validatedUserData,
          manifests: aio
            .getAddons()
            .map((addon) => aio.getManifest(addon.instanceId!)),
          day: todayUtc,
        })
      );
      // Initial scans/refreshes replace the inventory; alternatives reuse it.
      if (!alternativesFor) await channelInventoryCache.delete(inventoryKey);
      const cachedInventory = alternativesFor
        ? await channelInventoryCache.get(inventoryKey)
        : undefined;
      const scanned =
        cachedInventory ?? (await Promise.all(aio.getAddons().map(scanAddon)));
      if (
        !cachedInventory &&
        !scanTruncated &&
        aio.getInitialisationErrors().length === 0 &&
        scanned.every(
          (result) =>
            !result ||
            (result.diagnostic.ok &&
              (result.diagnostic.skippedCatalogs ?? []).every((catalog) =>
                catalog.endsWith(' (one-off events)')
              ))
        ) &&
        Buffer.byteLength(JSON.stringify(scanned)) <= 4 * 1024 * 1024
      ) {
        await channelInventoryCache.set(inventoryKey, scanned, 300);
      }
      for (const result of scanned) {
        if (!result) continue;
        sources.set(result.diagnostic.instanceId, result.diagnostic);
        for (const candidate of result.found) {
          const key = `${candidate.addonId}\0${candidate.id}`;
          if (!candidates.has(key)) candidates.set(key, candidate);
        }
      }
      logger.info(
        {
          durationMs: Date.now() - scanStartedAt,
          budgetMs: scanBudgetMs || null,
          truncated: scanTruncated,
          candidates: candidates.size,
          sources: [...sources.values()].map((source) => ({
            name: source.name,
            ok: source.ok,
            durationMs: source.durationMs,
          })),
        },
        'channel scan complete'
      );

      for (const entry of aio.getInitialisationErrors()) {
        const instanceId = entry.addon.instanceId;
        if (!instanceId || sources.has(instanceId)) continue;
        const presetType =
          'preset' in entry.addon
            ? entry.addon.preset.type
            : 'type' in entry.addon
              ? entry.addon.type
              : undefined;
        sources.set(instanceId, {
          instanceId,
          name:
            'name' in entry.addon && entry.addon.name
              ? entry.addon.name
              : presetType || instanceId,
          presetType,
          contributesChannels: false,
          canStream: false,
          epgProvider: false,
          ok: false,
          error: entry.error,
          durationMs: 0,
          fetchedAt: new Date().toISOString(),
          channelCount: 0,
          streamCount: 0,
        });
      }

      const streamCandidates = [...candidates.values()].filter(
        (candidate) => candidate.canStream
      );
      for (const candidate of candidates.values()) {
        const source = sources.get(candidate.addonId);
        if (!source) continue;
        if (candidate.contributesChannels) source.channelCount += 1;
        if (candidate.canStream) source.streamCount += 1;
      }
      const channels: Channel[] = [];
      const unavailableStreams: UnavailableStream[] = [];
      const assigned = new Set<string>();
      const candidateKey = (addonId: string, channelId: string) =>
        `${addonId}\0${channelId}`;
      const resolveCanonical = (
        channel: Pick<Channel, 'id' | 'name' | 'poster' | 'canonicalAddonId'>
      ): Candidate => {
        const fromCatalog = candidates.get(
          candidateKey(channel.canonicalAddonId, channel.id)
        );
        if (fromCatalog) return fromCatalog;
        const addon = aio.getAddon(channel.canonicalAddonId);
        return {
          id: channel.id,
          name: channel.name,
          poster: channel.poster,
          addonId: channel.canonicalAddonId,
          addonName: addon?.name ?? channel.canonicalAddonId,
          epgProvider: false,
          canStream: false,
          contributesChannels: true,
        };
      };
      const preparedCandidates = new WeakMap<
        Candidate,
        PreparedChannelMatchCandidate
      >();
      const preparedChannels = new WeakMap<
        Channel,
        PreparedChannelMatchCandidate
      >();
      const prepareCandidate = (candidate: Candidate) => {
        let prepared = preparedCandidates.get(candidate);
        if (!prepared) {
          prepared = prepareChannelMatchCandidate({
            ...candidate,
            logo: candidate.poster ?? undefined,
          });
          preparedCandidates.set(candidate, prepared);
        }
        return prepared;
      };
      const prepareCanonical = (channel: Channel) => {
        let prepared = preparedChannels.get(channel);
        if (!prepared) {
          prepared = prepareCandidate(resolveCanonical(channel));
          preparedChannels.set(channel, prepared);
        }
        return prepared;
      };
      const declaredForCandidate = (
        candidate: Pick<Candidate, 'name' | 'categories'>
      ) =>
        parseDeclaredStreamInfo({
          name: candidate.name,
          group: candidate.categories?.[0],
        }) ?? null;
      const addStreamSource = (
        channel: Channel,
        candidate: Candidate,
        confidence: number,
        enabled = true
      ) => {
        if (!candidate.canStream) return;
        channel.mappings.push({
          ...candidate,
          channelId: candidate.id,
          confidence,
          enabled,
          declared: declaredForCandidate(candidate),
        });
        assigned.add(candidateKey(candidate.addonId, candidate.id));
      };
      const addManualStreamSource = (
        channel: Channel,
        source: {
          channelId: string;
          url: string;
          name?: string;
          confidence?: number;
          enabled?: boolean;
          headers?: Record<string, string>;
          resolution?: string;
          encode?: string;
          quality?: string;
          languages?: string[];
          audioChannels?: string[];
          visualTags?: string[];
        }
      ) => {
        const label = source.name ?? 'Manual HLS';
        const declared =
          parseDeclaredStreamInfo({
            name: [label, source.resolution, source.encode]
              .filter(Boolean)
              .join(' '),
          }) ?? null;
        channel.mappings.push({
          id: source.channelId,
          addonId: MANUAL_STREAM_ADDON_ID,
          addonName: 'Manual HLS',
          channelId: source.channelId,
          name: label,
          url: source.url,
          poster: null,
          epgProvider: false,
          canStream: true,
          contributesChannels: false,
          confidence: source.confidence ?? 0,
          enabled: source.enabled !== false,
          headers: source.headers,
          resolution: source.resolution,
          encode: source.encode,
          quality: source.quality,
          languages: source.languages,
          audioChannels: source.audioChannels,
          visualTags: source.visualTags,
          declared,
        });
      };
      const markChannelAssigned = (candidate: Candidate) => {
        assigned.add(candidateKey(candidate.addonId, candidate.id));
      };
      const addConfiguredStreamSource = (
        channel: Channel,
        source: {
          addonId: string;
          channelId: string;
          name?: string;
          confidence?: number;
          enabled?: boolean;
        },
        candidate?: Candidate
      ) => {
        if (candidate?.canStream) {
          addStreamSource(
            channel,
            candidate,
            source.confidence ?? 0,
            source.enabled !== false
          );
          return;
        }
        const addon = aio.getAddon(source.addonId);
        channel.mappings.push({
          id: source.channelId,
          addonId: source.addonId,
          addonName: addon?.name ?? source.addonId,
          channelId: source.channelId,
          name: source.name ?? source.channelId,
          poster: null,
          epgProvider: false,
          canStream: false,
          contributesChannels: false,
          confidence: source.confidence ?? 1,
          enabled: source.enabled !== false,
          declared: source.name
            ? (parseDeclaredStreamInfo({ name: source.name }) ?? null)
            : null,
        });
      };
      const buildAvailableStreamSources = async (channel: Channel) => {
        const used = new Set(
          channel.mappings.map(
            (mapping) => `${mapping.addonId}\0${mapping.channelId}`
          )
        );
        const available: Channel['availableStreamSources'] = [];
        for (const candidate of streamCandidates) {
          if (used.has(`${candidate.addonId}\0${candidate.id}`)) {
            continue;
          }
          available.push({
            addonId: candidate.addonId,
            addonName: candidate.addonName,
            channelId: candidate.id,
            name: candidate.name,
            poster: candidate.poster,
          });
        }
        return available.sort((a, b) => {
          return (
            a.addonName.localeCompare(b.addonName, undefined, {
              sensitivity: 'base',
            }) ||
            a.name.localeCompare(b.name, undefined, {
              sensitivity: 'base',
            })
          );
        });
      };

      for (const configured of configuredMappings) {
        if (configured.hidden) continue;
        const manualSources =
          configured.streams?.filter((source) =>
            isManualStreamSource(source)
          ) ?? [];
        const streamSources =
          configured.streams?.flatMap((source) => {
            if (isManualStreamSource(source)) return [];
            const candidate = source.channelId
              ? candidates.get(candidateKey(source.addonId, source.channelId))
              : undefined;
            return candidate?.canStream ? [{ candidate, source }] : [];
          }) ?? [];
        for (const source of configured.streams ?? []) {
          if (isManualStreamSource(source) || !source.channelId) continue;
          const candidate = candidates.get(
            candidateKey(source.addonId, source.channelId)
          );
          if (candidate?.canStream) continue;
          const sourceDiag = sources.get(source.addonId);
          unavailableStreams.push({
            channelId: configured.id,
            channelName: configured.name ?? configured.id,
            addonId: source.addonId,
            addonName:
              sourceDiag?.name ??
              aio.getAddon(source.addonId)?.name ??
              source.addonId,
            streamChannelId: source.channelId,
            name: source.name ?? source.channelId,
            reason: sourceDiag?.error
              ? sourceDiag.error
              : candidate
                ? 'Source does not provide streams'
                : 'Stream was not returned by the source',
          });
        }
        const canonical =
          (configured.canonicalAddonId
            ? candidates.get(
                candidateKey(configured.canonicalAddonId, configured.id)
              )
            : undefined) ??
          streamSources.find(({ candidate }) => candidate.id === configured.id)
            ?.candidate;
        if (!canonical && manualSources.length === 0) continue;
        const channel: Channel = {
          id: configured.id,
          name: configured.name ?? canonical?.name ?? configured.id,
          poster: configured.poster ?? canonical?.poster,
          canonicalAddonId:
            configured.canonicalAddonId ?? canonical?.addonId ?? configured.id,
          enabled: configured.enabled !== false,
          epgProvider: canonical?.epgProvider === true,
          rejectedStreams: configured.rejectedStreams ?? [],
          mappings: [],
          availableStreamSources: [],
        };
        for (const source of configured.streams ?? []) {
          if (isManualStreamSource(source)) {
            if (source.url)
              addManualStreamSource(channel, { ...source, url: source.url });
          } else {
            addConfiguredStreamSource(
              channel,
              source,
              candidates.get(candidateKey(source.addonId, source.channelId))
            );
          }
        }
        markChannelAssigned(
          canonical ?? {
            id: configured.id,
            name: channel.name,
            poster: channel.poster,
            addonId: channel.canonicalAddonId,
            addonName:
              aio.getAddon(channel.canonicalAddonId)?.name ?? 'Channel',
            epgProvider: false,
            canStream: false,
            contributesChannels: true,
          }
        );
        channels.push(channel);
      }

      // Pass 1: catalog-defined channels stay separate so the user can hide
      // duplicates per provider. Catalog+stream builtins already bind playback
      // to the same channel id — skip name/tvg proximity.
      for (const candidate of candidates.values()) {
        if (hiddenChannelIds.has(candidate.id)) continue;
        if (!candidate.contributesChannels) continue;
        if (assigned.has(candidateKey(candidate.addonId, candidate.id)))
          continue;
        const channel: Channel = {
          id: candidate.id,
          name: candidate.name,
          poster: candidate.poster,
          canonicalAddonId: candidate.addonId,
          enabled: true,
          epgProvider: candidate.epgProvider,
          rejectedStreams: [],
          mappings: [],
          availableStreamSources: [],
        };
        if (
          bindsOwnCatalogStreams(candidate) &&
          !isRejected(candidate.id, candidate)
        ) {
          addStreamSource(channel, candidate, 1);
        } else {
          markChannelAssigned(candidate);
        }
        channels.push(channel);
      }

      // Pass 2: stream-only sources. Match those onto existing channels.
      if (autoMatch) {
        for (const candidate of streamCandidates.sort(
          (a, b) => Number(b.epgProvider) - Number(a.epgProvider)
        )) {
          if (hiddenChannelIds.has(candidate.id)) continue;
          if (bindsOwnCatalogStreams(candidate)) continue;
          if (assigned.has(candidateKey(candidate.addonId, candidate.id)))
            continue;
          let best: { channel: Channel; confidence: number } | undefined;
          let suggestion: { channel: Channel; confidence: number } | undefined;
          if (await matchingCheckpoint()) {
            for (const channel of channels) {
              if (
                channel.mappings.some(
                  (mapping) =>
                    mapping.addonId === candidate.addonId &&
                    mapping.channelId === candidate.id
                )
              )
                continue;
              if (!(await nextMatchingPair())) break;
              const confidence = getPreparedChannelMatchConfidence(
                prepareCandidate(candidate),
                prepareCanonical(channel)
              );
              if (
                confidence > 0 &&
                (!suggestion || confidence > suggestion.confidence)
              ) {
                suggestion = { channel, confidence };
              }
              if (
                isHighConfidenceChannelMatch(confidence) &&
                (!best || confidence > best.confidence)
              )
                best = { channel, confidence };
            }
          }
          if (!(await matchingCheckpoint())) break;
          if (best) {
            if (!isRejected(best.channel.id, candidate)) {
              addStreamSource(best.channel, candidate, 1);
            }
          } else if (
            suggestion &&
            suggestion.confidence > 0.75 &&
            !isRejected(suggestion.channel.id, candidate)
          ) {
            addStreamSource(
              suggestion.channel,
              candidate,
              suggestion.confidence
            );
          } else if (candidate.contributesChannels) {
            const channel: Channel = {
              id: candidate.id,
              name: candidate.name,
              poster: candidate.poster,
              canonicalAddonId: candidate.addonId,
              enabled: true,
              epgProvider: candidate.epgProvider,
              rejectedStreams: [],
              mappings: [],
              availableStreamSources: [],
            };
            addStreamSource(channel, candidate, 1);
            channels.push(channel);
          }
        }
      }

      const catalogById = new Map<string, Candidate>();
      for (const candidate of candidates.values()) {
        if (!catalogById.has(candidate.id)) {
          catalogById.set(candidate.id, candidate);
        }
      }
      const removedChannels = configuredMappings
        .filter((mapping) => mapping.hidden)
        .map((mapping) => {
          const candidate = catalogById.get(mapping.id);
          return {
            id: mapping.id,
            name: mapping.name?.trim() || candidate?.name?.trim() || mapping.id,
            poster: mapping.poster || candidate?.poster || undefined,
            sourceName: candidate?.addonName,
          };
        })
        .sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        );

      const visibleChannels = (
        await Promise.all(
          channels
            .filter(
              (channel) =>
                !hiddenChannelIds.has(channel.id) &&
                (!alternativesFor || channel.id === alternativesFor)
            )
            .map(async (channel) => {
              const canonical = resolveCanonical(channel);
              const configured = configuredMappings.find(
                (mapping) => mapping.id === channel.id
              );
              const sourceGroup = normalizeChannelGroup(
                canonical.categories?.[0] ??
                  channel.mappings.find((mapping) => mapping.categories?.[0])
                    ?.categories?.[0]
              );
              return {
                ...channel,
                epgSource: configured?.epgSource,
                availableEpgSources: alternativesFor
                  ? [...candidates.values()]
                      .filter(
                        (candidate) =>
                          candidate.epgProvider && candidate.contributesChannels
                      )
                      .map((candidate) => ({
                        addonId: candidate.addonId,
                        addonName: candidate.addonName,
                        channelId: candidate.id,
                        name: candidate.name,
                      }))
                  : [],
                sourceName:
                  canonical.addonName ||
                  sources.get(channel.canonicalAddonId)?.name ||
                  undefined,
                sourceGroup,
                country:
                  canonical.country ??
                  channel.mappings.find((mapping) => mapping.country)?.country,
                language:
                  canonical.language ??
                  channel.mappings.find((mapping) => mapping.language)
                    ?.language,
                group: normalizeChannelGroup(configured?.group) ?? sourceGroup,
                epgProvider: configured?.epgSource
                  ? Boolean(
                      candidates.get(
                        candidateKey(
                          configured.epgSource.addonId,
                          configured.epgSource.channelId
                        )
                      )?.epgProvider
                    )
                  : canonical.epgProvider ||
                    channel.mappings.some((mapping) => mapping.epgProvider),
                availableStreamSources: alternativesFor
                  ? await buildAvailableStreamSources(channel)
                  : [],
              };
            })
        )
      ).sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      );
      respond(
        200,
        createResponse({
          success: true,
          data: {
            channels: visibleChannels,
            sources: [...sources.values()].sort((a, b) =>
              a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
            ),
            unmatchedStreams: [],
            unavailableStreams,
            duplicates: findPossibleDuplicateChannels(visibleChannels),
            removedChannels,
            scan: {
              durationMs: Date.now() - scanStartedAt,
              budgetMs: scanBudgetMs || null,
              truncated: scanTruncated,
              matchingTruncated,
              matchingPairs,
            },
          },
        })
      );
    } catch (error) {
      const apiError =
        error instanceof APIError
          ? error
          : new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR);
      if (res.headersSent) {
        respond(
          apiError.statusCode,
          createResponse({
            success: false,
            error: { code: apiError.code, message: apiError.message },
          })
        );
      } else {
        next(apiError);
      }
    } finally {
      stopHeartbeat();
      res.off('close', stopHeartbeat);
    }
  }
);

export default router;
