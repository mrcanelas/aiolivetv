import type { CatalogModification, MergedCatalog } from '../db/schemas.js';
import type { Manifest } from '../db/index.js';
import { TV_TYPE } from '../utils/constants.js';

export const LIVE_TV_MERGED_CATALOG_ID = 'aiostreams.merged.live-tv';

export function buildLiveTvMergedCatalog(
  catalogs: Manifest['catalogs'],
  name: string,
  catalogModifications?: CatalogModification[]
): MergedCatalog | undefined {
  const tvCatalogs = catalogs.filter((catalog) => {
    if (catalog.type !== TV_TYPE) return false;
    if (catalog.id.startsWith('aiostreams.merged.')) return false;
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
