import type {
  CatalogModification,
  Manifest,
  MergedCatalog,
  UserData,
} from '../db/index.js';
import { TV_TYPE } from '../utils/constants.js';
import { normalizeChannelGroup } from '../utils/channelName.js';
import {
  LIVE_TV_MERGED_CATALOG_ID,
  isMergedCatalogId,
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
    if (isMergedCatalogId(catalog.id)) return false;
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
  channelMappings: UserData['channelMappings']
) {
  const options = [
    ...new Set(
      (channelMappings ?? [])
        .filter((mapping) => mapping.enabled !== false && !mapping.hidden)
        .map((mapping) => normalizeChannelGroup(mapping.group))
        .filter((group): group is string => Boolean(group))
    ),
  ].sort((left, right) => left.localeCompare(right, 'pt-BR'));
  if (!options.length) return extras;

  const genreExtra = extras.find((extra) => extra.name === 'genre');
  if (!genreExtra) {
    extras.push({ name: 'genre', isRequired: false, options });
    return extras;
  }

  genreExtra.options = [
    ...new Set([...(genreExtra.options ?? []), ...options]),
  ].sort((left, right) => String(left).localeCompare(String(right), 'pt-BR'));
  return extras;
}
