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
} from '@aiostreams/core';

const router: Router = Router();

const logger = createLogger('server');
const MAX_CHANNELS_PER_CATALOG = 10_000;
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

      const aio = await new AIOStreams(validatedUserData).initialise();
      type Candidate = {
        id: string;
        name: string;
        poster?: string | null;
        addonId: string;
        addonName: string;
        epgProvider: boolean;
        canStream: boolean;
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
          }
        >;
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

      for (const catalog of aio
        .getCatalogs()
        .filter((item) => item.type === constants.CHANNEL_TYPE)) {
        const addonId = catalog.id.split('.', 1)[0];
        const addon = aio.getAddon(addonId);
        const manifest = aio.getManifest(addonId);
        if (!addon || !manifest) continue;
        const supportsStream = manifest.resources.some((resource) =>
          typeof resource === 'string'
            ? resource === 'stream'
            : resource.name === 'stream'
        );
        const canStream =
          supportsStream &&
          (!addon.resources?.length || addon.resources.includes('stream'));
        const paginated = catalogSupportsSkip(catalog.extra);
        let skip = 0;
        const seenCatalogItems = new Set<string>();
        while (true) {
          const response = await aio.getCatalog(
            catalog.type,
            catalog.id,
            paginated ? `skip=${skip}` : undefined
          );
          let added = 0;
          for (const item of response.data) {
            if (seenCatalogItems.has(item.id)) continue;
            seenCatalogItems.add(item.id);
            added++;
            const key = `${addonId}\0${item.id}`;
            if (candidates.has(key)) continue;
            candidates.set(key, {
              id: item.id,
              name: item.name ?? item.id,
              poster: item.poster,
              addonId,
              addonName: addon.name,
              epgProvider: manifest.behaviorHints?.epgProvider === true,
              canStream,
              tvgId: typeof item.tvgId === 'string' ? item.tvgId : undefined,
              aliases: Array.isArray(item.aliases) ? item.aliases : undefined,
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
            skip + response.data.length >= MAX_CHANNELS_PER_CATALOG
          )
            break;
          skip += response.data.length;
        }
      }

      const channels: Channel[] = [];
      const assigned = new Set<string>();
      const addSource = (
        channel: Channel,
        candidate: Candidate,
        confidence: number,
        enabled = true
      ) => {
        channel.mappings.push({
          ...candidate,
          channelId: candidate.id,
          confidence,
          enabled,
        });
        assigned.add(`${candidate.addonId}\0${candidate.id}`);
      };

      for (const configured of configuredMappings) {
        const sources =
          configured.streams?.flatMap((source) => {
            const candidate = source.channelId
              ? candidates.get(`${source.addonId}\0${source.channelId}`)
              : undefined;
            return candidate ? [{ candidate, source }] : [];
          }) ?? [];
        if (!sources.length) continue;
        const canonical =
          sources.find(
            ({ candidate }) =>
              candidate.id === configured.id &&
              (!configured.canonicalAddonId ||
                candidate.addonId === configured.canonicalAddonId)
          )?.candidate ?? sources[0].candidate;
        const channel: Channel = {
          id: canonical.id,
          name: canonical.name,
          poster: canonical.poster,
          canonicalAddonId: canonical.addonId,
          enabled: configured.enabled !== false,
          rejectedStreams: configured.rejectedStreams ?? [],
          mappings: [],
        };
        for (const { candidate, source } of sources) {
          addSource(
            channel,
            candidate,
            source.confidence ?? (candidate === canonical ? 1 : 0),
            source.enabled !== false
          );
        }
        channels.push(channel);
      }

      // ponytail: O(n²) is adequate for configuration-time channel lists;
      // index normalized fields only if real guides make this measurably slow.
      for (const candidate of [...candidates.values()].sort(
        (a, b) => Number(b.epgProvider) - Number(a.epgProvider)
      )) {
        if (assigned.has(`${candidate.addonId}\0${candidate.id}`)) continue;
        let best: { channel: Channel; confidence: number } | undefined;
        for (const channel of channels) {
          if (
            channel.mappings.some(
              (mapping) => mapping.addonId === candidate.addonId
            )
          )
            continue;
          const canonical = channel.mappings.find(
            (mapping) => mapping.addonId === channel.canonicalAddonId
          )!;
          const confidence = getChannelMatchConfidence(
            { ...candidate, logo: candidate.poster ?? undefined },
            { ...canonical, logo: canonical.poster ?? undefined }
          );
          if (
            isHighConfidenceChannelMatch(confidence) &&
            (!best || confidence > best.confidence)
          )
            best = { channel, confidence };
        }
        if (best) {
          if (!isRejected(best.channel.id, candidate)) {
            addSource(best.channel, candidate, best.confidence);
          }
        } else {
          const channel: Channel = {
            id: candidate.id,
            name: candidate.name,
            poster: candidate.poster,
            canonicalAddonId: candidate.addonId,
            enabled: true,
            rejectedStreams: [],
            mappings: [],
          };
          addSource(channel, candidate, 1);
          channels.push(channel);
        }
      }

      res.status(200).json(
        createResponse({
          success: true,
          data: channels.sort((a, b) =>
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
