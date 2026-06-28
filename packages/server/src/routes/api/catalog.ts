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
} from '@aiostreams/core';

const router: Router = Router();

const logger = createLogger('server');
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
      const channels = new Map<
        string,
        {
          id: string;
          name: string;
          poster?: string | null;
          enabled: boolean;
          mappings: Array<{
            addonId: string;
            addonName: string;
            count: number;
            enabled: boolean;
          }>;
        }
      >();

      for (const catalog of aio
        .getCatalogs()
        .filter((item) => item.type === constants.CHANNEL_TYPE)) {
        const response = await aio.getCatalog(catalog.type, catalog.id);
        for (const item of response.data) {
          if (channels.has(item.id)) continue;
          const configured = configuredMappings.find(
            (channel) => channel.id === item.id
          );
          channels.set(item.id, {
            id: item.id,
            name: item.name ?? item.id,
            poster: item.poster,
            enabled: configured?.enabled !== false,
            mappings: [],
          });
        }
      }

      // ponytail: sequential requests keep the shared AIOStreams context safe;
      // isolate contexts in a worker pool only if large guides prove too slow.
      for (const channel of channels.values()) {
        const response = await aio.getStreams(
          channel.id,
          constants.CHANNEL_TYPE
        );
        const grouped = new Map<string, { name: string; count: number }>();
        for (const stream of response.data.streams) {
          const addonId = stream.addon.instanceId!;
          const current = grouped.get(addonId);
          grouped.set(addonId, {
            name: stream.addon.name,
            count: (current?.count ?? 0) + 1,
          });
        }
        const configured = configuredMappings.find(
          (item) => item.id === channel.id
        );
        channel.mappings = [...grouped.entries()].map(([addonId, mapping]) => ({
          addonId,
          addonName: mapping.name,
          count: mapping.count,
          enabled:
            configured?.streams?.find((stream) => stream.addonId === addonId)
              ?.enabled !== false,
        }));
      }

      res.status(200).json(
        createResponse({
          success: true,
          data: [...channels.values()].sort((a, b) =>
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
