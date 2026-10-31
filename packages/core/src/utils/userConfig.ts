import type { UserData } from '../db/schemas.js';
import { getLiveTvSortCriteria } from './constants.js';
import { migrateLegacyIdentityIds } from './identity.js';

export function removeInvalidPresetReferences(config: UserData) {
  // remove references to non-existent presets in options:
  const existingPresetIds = config.presets?.map((preset) => preset.instanceId);
  if (config.proxy) {
    config.proxy.proxiedAddons = config.proxy.proxiedAddons?.filter((addon) =>
      existingPresetIds?.includes(addon)
    );
  }
  if (config.groups?.groupings) {
    config.groups.groupings = config.groups.groupings.map((group) => ({
      ...group,
      addons: group.addons?.filter((addon) =>
        existingPresetIds?.includes(addon)
      ),
    }));
  }

  return config;
}

export function applyMigrations(config: any): UserData {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Configuration must be a JSON object');
  }
  config = structuredClone(config);
  migrateLegacyIdentityIds(config);
  if (config.bitrate && typeof config.bitrate === 'object') {
    delete config.bitrate.useMetadataRuntime;
    if (config.bitrate.global && !Array.isArray(config.bitrate.global)) {
      config.bitrate.global = config.bitrate.global.series;
    }
    if (config.bitrate.resolution) {
      for (const [resolution, range] of Object.entries(
        config.bitrate.resolution
      )) {
        if (range && !Array.isArray(range)) {
          config.bitrate.resolution[resolution] = (
            range as Record<string, unknown>
          ).series;
        }
      }
    }
  }
  if (
    config &&
    config.addonPassword !== undefined &&
    config.accessToken === undefined
  ) {
    config.accessToken = config.addonPassword;
  }
  if (config && config.addonPassword !== undefined) {
    delete config.addonPassword;
  }
  if (
    config &&
    config.accessToken !== undefined &&
    config.accessKey === undefined
  ) {
    config.accessKey = config.accessToken;
  }
  if (config && config.accessToken !== undefined) {
    delete config.accessToken;
  }
  if (
    config.deduplicator &&
    typeof config.deduplicator.multiGroupBehaviour === 'string'
  ) {
    switch (config.deduplicator.multiGroupBehaviour as string) {
      case 'remove_uncached':
        config.deduplicator.multiGroupBehaviour = 'aggressive';
        break;
      case 'remove_uncached_same_service':
        config.deduplicator.multiGroupBehaviour = 'conservative';
        break;
      case 'remove_nothing':
        config.deduplicator.multiGroupBehaviour = 'keep_all';
        break;
    }
  }

  if (Array.isArray(config.groups)) {
    config.groups = {
      enabled: config.disableGroups ? false : true,
      groupings: config.groups,
      behaviour: 'parallel',
    };
  }

  if (config.showStatistics || config.statisticsPosition) {
    config.statistics = {
      enabled: config.showStatistics ?? false,
      position: config.statisticsPosition ?? 'bottom',
      statsToShow: ['addon', 'filter', 'timing'],
      ...(config.statistics ?? {}),
    };
    delete config.showStatistics;
    delete config.statisticsPosition;
  }

  const migrateHOSBS = (
    type: 'preferred' | 'required' | 'excluded' | 'included'
  ) => {
    if (Array.isArray(config[type + 'Encodes'])) {
      config[type + 'Encodes'] = config[type + 'Encodes'].filter(
        (encode: string) => {
          if (encode === 'H-OU' || encode === 'H-SBS') {
            // add H-OU and H-SBS to visual tags if in encodes.
            config[type + 'VisualTags'] = [
              ...(config[type + 'VisualTags'] ?? []),
              encode,
            ];
            // filter out H-OU and H-SBS from encodes
            return false;
          }
          return true;
        }
      );
    }
  };

  migrateHOSBS('preferred');
  migrateHOSBS('required');
  migrateHOSBS('excluded');
  migrateHOSBS('included');

  // migrate comparisons of queryType to 'anime' to 'anime.series' or 'anime.movie'
  const migrateAnimeQueryTypeInExpression = (expr?: string) => {
    if (typeof expr !== 'string') return expr as any;
    // Replace equality comparisons
    let updated = expr.replace(
      /queryType\s*==\s*(["'])anime\1/g,
      "(queryType == 'anime.series' or queryType == 'anime.movie')"
    );
    updated = updated.replace(
      /(["'])anime\1\s*==\s*queryType/g,
      "(queryType == 'anime.series' or queryType == 'anime.movie')"
    );
    // Replace inequality comparisons
    updated = updated.replace(
      /queryType\s*!=\s*(["'])anime\1/g,
      "(queryType != 'anime.series' and queryType != 'anime.movie')"
    );
    updated = updated.replace(
      /(["'])anime\1\s*!=\s*queryType/g,
      "(queryType != 'anime.series' and queryType != 'anime.movie')"
    );
    return updated;
  };

  const expressionLists = [
    'excludedStreamExpressions',
    'requiredStreamExpressions',
    'includedStreamExpressions',
    'preferredStreamExpressions',
  ] as const;

  for (const key of expressionLists) {
    if (Array.isArray((config as any)[key])) {
      (config as any)[key] = (config as any)[key].map((expr: unknown) => {
        if (typeof expr === 'string') {
          return migrateAnimeQueryTypeInExpression(expr);
        }
        if (typeof expr === 'object' && expr !== null && 'expression' in expr) {
          return {
            ...(expr as any),
            expression: migrateAnimeQueryTypeInExpression(
              (expr as any).expression
            ),
          };
        }
        return expr;
      });
    }
  }

  if (config.dynamicAddonFetching?.condition) {
    config.dynamicAddonFetching.condition = migrateAnimeQueryTypeInExpression(
      config.dynamicAddonFetching.condition
    );
  }

  if (config.groups?.groupings) {
    config.groups.groupings = config.groups.groupings.map((group: any) => ({
      ...group,
      condition: migrateAnimeQueryTypeInExpression(group.condition),
    }));
  }

  // migrate rpdbUseRedirectApi to usePosterRedirectApi
  if (
    config.rpdbUseRedirectApi !== undefined &&
    config.usePosterRedirectApi === undefined
  ) {
    config.usePosterRedirectApi = config.rpdbUseRedirectApi;
    delete config.rpdbUseRedirectApi;
  }

  // migrate 'rpdb' to 'usePosterService' in all catalog modifications
  if (Array.isArray(config.catalogModifications)) {
    for (const mod of config.catalogModifications) {
      if (mod.usePosterService === undefined && mod.rpdb === true) {
        mod.usePosterService = true;
      }
      delete mod.rpdb;
    }
  }

  // migrate stream expressions from string[] to {expression, enabled}[]
  const streamExpressionKeys = [
    'excludedStreamExpressions',
    'requiredStreamExpressions',
    'preferredStreamExpressions',
    'includedStreamExpressions',
  ] as const;
  for (const key of streamExpressionKeys) {
    if (Array.isArray(config[key])) {
      config[key] = config[key].map((item: unknown) =>
        typeof item === 'string' ? { expression: item, enabled: true } : item
      );
    }
  }

  // migrate forceToTop at addon level to pinPosition set to 'top'
  if (config.presets && Array.isArray(config.presets)) {
    config.presets = config.presets.map((preset: any) => {
      if (
        preset.options?.forceToTop === true &&
        preset.options.pinPosition === undefined
      ) {
        delete preset.options.forceToTop;
        return {
          ...preset,
          options: {
            ...preset.options,
            pinPosition: 'top',
          },
        };
      }
      return preset;
    });
  }

  if (config.formatter && config.formatter.definition) {
    config.formatter.definitions = {
      ...(config.formatter.definitions ?? {}),
      custom: config.formatter.definition,
    };
    delete config.formatter.definition;
  }

  return normalizeUserData(config);
}

/** VOD-only options must not survive imports, saves or exports for Live TV. */
const VOD_FIELDS = [
  'excludedQualities',
  'includedQualities',
  'requiredQualities',
  'preferredQualities',
  'excludedReleaseGroups',
  'includedReleaseGroups',
  'requiredReleaseGroups',
  'preferredReleaseGroups',
  'excludeSeederRange',
  'includeSeederRange',
  'requiredSeederRange',
  'seederRangeTypes',
  'excludeAgeRange',
  'includeAgeRange',
  'requiredAgeRange',
  'ageRangeTypes',
  'digitalReleaseFilter',
  'enableSeadex',
  'excludeSeasonPacks',
  'size',
  'excludeCached',
  'excludeCachedFromAddons',
  'excludeCachedFromServices',
  'excludeCachedFromStreamTypes',
  'excludeCachedMode',
  'excludeUncached',
  'excludeUncachedFromAddons',
  'excludeUncachedFromServices',
  'excludeUncachedFromStreamTypes',
  'excludeUncachedMode',
  'yearMatching',
  'titleMatching',
  'seasonEpisodeMatching',
  'autoPlay',
  'areYouStillThere',
  'precacheNextEpisode',
  'alwaysPrecache',
  'precacheCondition',
  'precacheSelector',
  'precacheSingleStream',
  'preloadStreams',
  'cacheAndPlay',
  'nzbFailover',
  'serviceWrap',
  'checkOwned',
  'externalDownloads',
  'autoRemoveDownloads',
] as const;

export function isLiveTvUserDataField(key: string): boolean {
  return !(VOD_FIELDS as readonly string[]).includes(key);
}

/** Keep the existing UserData contract, with only settings relevant to Live TV. */
export function normalizeUserData(config: UserData): UserData {
  const next = { ...config };
  delete (next as Record<string, unknown>).enrichEpgWithTmdb;
  for (const key of VOD_FIELDS) delete (next as Record<string, unknown>)[key];
  if (
    next.presets?.some(
      (preset) =>
        preset.type === 'custom' &&
        (preset.options?.mediaTypes !== undefined ||
          preset.options?.libraryAddon !== undefined)
    )
  ) {
    next.presets = next.presets.map((preset) => {
      if (preset.type !== 'custom') return preset;
      const options = { ...preset.options };
      delete options.mediaTypes;
      delete options.libraryAddon;
      return { ...preset, options };
    });
  }
  const parent = next.parentConfig;
  const strategies = parent?.mergeStrategies;
  const overrides = strategies?.fieldOverrides;
  if (
    parent &&
    strategies &&
    overrides &&
    Object.keys(overrides).some((key) => !isLiveTvUserDataField(key))
  ) {
    next.parentConfig = {
      ...parent,
      mergeStrategies: {
        ...strategies,
        fieldOverrides: Object.fromEntries(
          Object.entries(overrides).filter(([key]) =>
            isLiveTvUserDataField(key)
          )
        ),
      },
    };
  }
  // These aliases can still occur in old exports, outside the current schema.
  for (const key of ['p2pWrap', 'disableGroups'])
    delete (next as unknown as Record<string, unknown>)[key];

  if (Array.isArray(next.sortCriteria?.global)) {
    next.sortCriteria = {
      global: getLiveTvSortCriteria(next.sortCriteria.global),
    };
  }
  if (Array.isArray(next.services)) {
    next.services = next.services.filter(
      (service) =>
        service.enabled === true ||
        Object.values(service.credentials ?? {}).some(
          (value) => value !== undefined && value !== null && value !== ''
        )
    );
    if (!next.services.length) delete next.services;
  }
  const deduplicator = next.deduplicator;
  if (
    deduplicator &&
    !(['http', 'live', 'youtube', 'external'] as const).some(
      (kind) => deduplicator[kind] && deduplicator[kind] !== 'disabled'
    )
  ) {
    delete next.deduplicator;
  }
  if (
    next.proxy &&
    next.proxy.enabled !== true &&
    Object.entries(next.proxy).every(
      ([key, value]) =>
        key === 'id' ||
        value === undefined ||
        value === null ||
        value === false ||
        value === '' ||
        (Array.isArray(value) && !value.length) ||
        (typeof value === 'object' &&
          value !== null &&
          !Object.keys(value).length)
    )
  ) {
    delete next.proxy;
  }
  if (Array.isArray(next.regexOverrides) && !next.regexOverrides.length)
    delete next.regexOverrides;
  if (Array.isArray(next.selOverrides) && !next.selOverrides.length)
    delete next.selOverrides;
  return next;
}
