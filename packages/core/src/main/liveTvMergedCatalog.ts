import type {
  CatalogModification,
  Manifest,
  MergedCatalog,
  UserData,
} from '../db/index.js';
import { TV_TYPE } from '../utils/constants.js';
import {
  normalizeChannelGroup,
  resolveChannelGroup,
} from '../utils/channelName.js';
import {
  LIVE_TV_MERGED_CATALOG_ID,
  isMergedCatalogId,
  isSportsCatalogId,
} from '../utils/identity.js';

export {
  LIVE_TV_MERGED_CATALOG_ID,
  LEGACY_LIVE_TV_MERGED_CATALOG_ID,
  isLiveTvMergedCatalogId,
  isMergedCatalogId,
  toCanonicalMergedCatalogId,
} from '../utils/identity.js';

export function buildLiveTvMergedCatalog(
  catalogs: Manifest['catalogs'],
  name: string,
  catalogModifications?: CatalogModification[]
): MergedCatalog | undefined {
  const tvCatalogs = catalogs.filter((catalog) => {
    if (catalog.type !== TV_TYPE) return false;
    if (isMergedCatalogId(catalog.id) || isSportsCatalogId(catalog.id))
      return false;
    const modification = catalogModifications?.find(
      (mod) => mod.id === catalog.id && mod.type === catalog.type
    );
    return modification?.enabled !== false;
  });
  if (tvCatalogs.length === 0) return undefined;
  return {
    id: LIVE_TV_MERGED_CATALOG_ID,
    name,
    type: TV_TYPE,
    catalogIds: tvCatalogs.map(
      (catalog) =>
        `id=${encodeURIComponent(catalog.id)}&type=${encodeURIComponent(catalog.type)}`
    ),
    enabled: true,
  };
}

export function addLiveTvChannelMappingGenreOptions(
  extras: NonNullable<Manifest['catalogs'][number]['extra']>,
  channelMappings: UserData['channelMappings'],
  groupMerges?: UserData['channelGroupMerges']
) {
  const customGroups = (channelMappings ?? [])
    .filter((mapping) => mapping.enabled !== false && !mapping.hidden)
    .map((mapping) => normalizeChannelGroup(mapping.group))
    .filter((group): group is string => Boolean(group));
  if (!customGroups.length && !Object.keys(groupMerges ?? {}).length) {
    return extras;
  }
  const genreExtra = extras.find((extra) => extra.name === 'genre');
  const destinations = new Set(Object.values(groupMerges ?? {}));
  const options = [
    ...new Set(
      [...(genreExtra?.options ?? []), ...customGroups].map((group) => {
        if (group === null || group === 'None') return group;
        const normalized = normalizeChannelGroup(group);
        const resolved = resolveChannelGroup(normalized, groupMerges);
        return resolved &&
          (resolved !== normalized || destinations.has(resolved))
          ? resolved
          : group;
      })
    ),
  ].sort((left, right) => String(left).localeCompare(String(right), 'pt-BR'));
  if (options.length) {
    if (genreExtra) genreExtra.options = options;
    else extras.push({ name: 'genre', isRequired: false, options });
  }
  return extras;
}
