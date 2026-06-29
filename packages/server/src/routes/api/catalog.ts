import { Router, Request, Response, NextFunction } from 'express';
import { createResponse } from '../../utils/responses.js';
import { catalogApiRateLimiter } from '../../middlewares/ratelimit.js';
import { attachSession, injectAccessKey } from '../../middlewares/auth.js';
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
  getChannelMatchConfidence,
  isHighConfidenceChannelMatch,
  catalogSupportsSkip,
  addonProvidesResource,
  decodeHtmlEntities,
  MANUAL_STREAM_ADDON_ID,
  isManualStreamSource,
  isLiveChannelType,
} from '@aiostreams/core';

const router: Router = Router();

const logger = createLogger('server');
const MAX_CHANNELS_PER_CATALOG = 10_000;
const MAX_STREAM_ONLY_CANDIDATES = 2_000;
const MAX_CATALOG_PAGES = 50;
const MAX_AUTO_MATCH_PAIRS = 5_000_000;
router.use(catalogApiRateLimiter);
router.use(attachSession);

async function validateDraft(req: Request, userData: UserData) {
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
      skipErrorsFromAddonsOrProxies: false,
      decryptValues: true,
      increasedManifestTimeout: true,
      bypassManifestCache: true,
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
    try {
      const validatedUserData = await validateDraft(req, req.body.userData);
      const configuredMappings = validatedUserData.channelMappings ?? [];
      validatedUserData.channelMappings = undefined;
      const hiddenChannelIds = new Set(
        configuredMappings.filter((mapping) => mapping.hidden).map((mapping) => mapping.id)
      );

      const aio = await new AIOStreams(validatedUserData).initialise();
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
      type Channel = {
        id: string;
        name: string;
        poster?: string | null;
        canonicalAddonId: string;
        enabled: boolean;
        rejectedStreams: Array<{ addonId: string; channelId: string }>;
        mappings: Array<
          Candidate & {
            channelId: string;
            confidence: number;
            enabled: boolean;
            url?: string;
          }
        >;
        availableStreamSources: Array<{
          addonId: string;
          addonName: string;
          channelId: string;
          name: string;
          poster?: string | null;
        }>;
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

      for (const addon of aio.getAddons()) {
        const instanceId = addon.instanceId;
        if (!instanceId) continue;
        const manifest = aio.getManifest(instanceId);
        if (!manifest) continue;
        const contributesChannels = addonProvidesResource(addon, 'catalog');
        const supportsStream = manifest.resources.some((resource) =>
          typeof resource === 'string'
            ? resource === 'stream'
            : resource.name === 'stream'
        );
        const canStream =
          supportsStream && addonProvidesResource(addon, 'stream');
        if (!contributesChannels && !canStream) continue;

        for (const catalog of manifest.catalogs.filter((item) =>
          isLiveChannelType(item.type)
        )) {
          const addonId = instanceId;
          const catalogId = `${addonId}.${catalog.id}`;
          const paginated = catalogSupportsSkip(catalog.extra);
          const maxCandidates = contributesChannels
            ? MAX_CHANNELS_PER_CATALOG
            : MAX_STREAM_ONLY_CANDIDATES;
          let skip = 0;
          let page = 0;
          let addonCandidateCount = 0;
          const seenCatalogItems = new Set<string>();
          while (true) {
            page++;
            if (page > MAX_CATALOG_PAGES || addonCandidateCount >= maxCandidates) {
              break;
            }
            const response = await aio.getCatalog(
              catalog.type,
              catalogId,
              paginated ? `skip=${skip}` : undefined
            );
            let added = 0;
            for (const item of response.data) {
              if (addonCandidateCount >= maxCandidates) break;
              if (seenCatalogItems.has(item.id)) continue;
              seenCatalogItems.add(item.id);
              added++;
              const key = `${addonId}\0${item.id}`;
              if (candidates.has(key)) continue;
              addonCandidateCount++;
              candidates.set(key, {
                id: item.id,
                name: decodeHtmlEntities(item.name ?? item.id),
                poster: item.poster,
                addonId,
                addonName: addon.name,
                epgProvider: manifest.behaviorHints?.epgProvider === true,
                canStream,
                contributesChannels,
                tvgId: typeof item.tvgId === 'string' ? item.tvgId : undefined,
                aliases: Array.isArray(item.aliases)
                  ? item.aliases.map((alias) => decodeHtmlEntities(alias))
                  : undefined,
                country:
                  typeof item.country === 'string' ? item.country : undefined,
                language:
                  typeof item.language === 'string' ? item.language : undefined,
                categories: Array.isArray(item.genres) ? item.genres : undefined,
              });
            }
            if (
              !paginated ||
              response.data.length === 0 ||
              added === 0 ||
              addonCandidateCount >= maxCandidates ||
              skip + response.data.length >= MAX_CHANNELS_PER_CATALOG
            )
              break;
            skip += response.data.length;
          }
        }
      }

      const streamCandidates = [...candidates.values()].filter(
        (candidate) => candidate.canStream
      );
      const channels: Channel[] = [];
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
        }
      ) => {
        channel.mappings.push({
          id: source.channelId,
          addonId: MANUAL_STREAM_ADDON_ID,
          addonName: 'Manual HLS',
          channelId: source.channelId,
          name: source.name ?? 'Manual HLS',
          url: source.url,
          poster: null,
          epgProvider: false,
          canStream: true,
          contributesChannels: false,
          confidence: source.confidence ?? 0,
          enabled: source.enabled !== false,
        });
      };
      const markChannelAssigned = (candidate: Candidate) => {
        assigned.add(candidateKey(candidate.addonId, candidate.id));
      };
      const buildAvailableStreamSources = (channel: Channel) => {
        const used = new Set(
          channel.mappings.map(
            (mapping) => `${mapping.addonId}\0${mapping.channelId}`
          )
        );
        return streamCandidates
          .filter(
            (candidate) =>
              !used.has(`${candidate.addonId}\0${candidate.id}`) &&
              !isRejected(channel.id, candidate)
          )
          .map((candidate) => ({
            addonId: candidate.addonId,
            addonName: candidate.addonName,
            channelId: candidate.id,
            name: candidate.name,
            poster: candidate.poster,
          }))
          .sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
          );
      };

      for (const configured of configuredMappings) {
        if (configured.hidden) continue;
        const manualSources =
          configured.streams?.filter((source) => isManualStreamSource(source)) ??
          [];
        const streamSources =
          configured.streams?.flatMap((source) => {
            if (isManualStreamSource(source)) return [];
            const candidate = source.channelId
              ? candidates.get(candidateKey(source.addonId, source.channelId))
              : undefined;
            return candidate?.canStream ? [{ candidate, source }] : [];
          }) ?? [];
        const canonical =
          (configured.canonicalAddonId
            ? candidates.get(
                candidateKey(configured.canonicalAddonId, configured.id)
              )
            : undefined) ??
          streamSources.find(
            ({ candidate }) => candidate.id === configured.id
          )?.candidate;
        if (!canonical && manualSources.length === 0) continue;
        const channel: Channel = {
          id: configured.id,
          name: configured.name ?? canonical?.name ?? configured.id,
          poster: configured.poster ?? canonical?.poster,
          canonicalAddonId:
            configured.canonicalAddonId ?? canonical?.addonId ?? configured.id,
          enabled: configured.enabled !== false,
          rejectedStreams: configured.rejectedStreams ?? [],
          mappings: [],
          availableStreamSources: [],
        };
        for (const source of manualSources) {
          if (!source.url || !source.channelId) continue;
          addManualStreamSource(channel, {
            channelId: source.channelId,
            url: source.url,
            name: source.name,
            confidence: source.confidence,
            enabled: source.enabled,
          });
        }
        for (const { candidate, source } of streamSources) {
          addStreamSource(
            channel,
            candidate,
            source.confidence ?? 0,
            source.enabled !== false
          );
        }
        markChannelAssigned(canonical ?? {
          id: configured.id,
          name: channel.name,
          poster: channel.poster,
          addonId: channel.canonicalAddonId,
          addonName: aio.getAddon(channel.canonicalAddonId)?.name ?? 'Channel',
          epgProvider: false,
          canStream: false,
          contributesChannels: true,
        });
        channels.push(channel);
      }

      // ponytail: O(n²) is adequate for configuration-time channel lists;
      // index normalized fields only if real guides make this measurably slow.
      // Pass 1: channels defined by catalog/meta sources that do not provide streams.
      for (const candidate of candidates.values()) {
        if (hiddenChannelIds.has(candidate.id)) continue;
        if (!candidate.contributesChannels || candidate.canStream) continue;
        if (assigned.has(candidateKey(candidate.addonId, candidate.id))) continue;
        channels.push({
          id: candidate.id,
          name: candidate.name,
          poster: candidate.poster,
          canonicalAddonId: candidate.addonId,
          enabled: true,
          rejectedStreams: [],
          mappings: [],
          availableStreamSources: [],
        });
        markChannelAssigned(candidate);
      }

      // Pass 2: attach stream sources to existing channels or create stream-native channels.
      const autoMatchStreams =
        streamCandidates.length * channels.length <= MAX_AUTO_MATCH_PAIRS;
      for (const candidate of streamCandidates.sort(
        (a, b) => Number(b.epgProvider) - Number(a.epgProvider)
      )) {
        if (hiddenChannelIds.has(candidate.id)) continue;
        if (assigned.has(candidateKey(candidate.addonId, candidate.id))) continue;
        let best: { channel: Channel; confidence: number } | undefined;
        let suggestion: { channel: Channel; confidence: number } | undefined;
        if (autoMatchStreams) {
          for (const channel of channels) {
            if (
              channel.mappings.some(
                (mapping) =>
                  mapping.addonId === candidate.addonId &&
                  mapping.channelId === candidate.id
              )
            )
              continue;
            const canonical = resolveCanonical(channel);
            const confidence = getChannelMatchConfidence(
              { ...candidate, logo: candidate.poster ?? undefined },
              { ...canonical, logo: canonical.poster ?? undefined }
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
        if (best) {
          if (!isRejected(best.channel.id, candidate)) {
            addStreamSource(best.channel, candidate, 1);
          }
        } else if (
          suggestion &&
          suggestion.confidence > 0 &&
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
            rejectedStreams: [],
            mappings: [],
            availableStreamSources: [],
          };
          addStreamSource(channel, candidate, 1);
          channels.push(channel);
        }
      }

      res.status(200).json(
        createResponse({
          success: true,
          data: channels
            .filter((channel) => !hiddenChannelIds.has(channel.id))
            .map((channel) => ({
              ...channel,
              availableStreamSources: buildAvailableStreamSources(channel),
            }))
            .sort((a, b) =>
              a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
            ),
        })
      );
    } catch (error) {
      next(
        error instanceof APIError
          ? error
          : new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR)
      );
    }
  }
);

export default router;
