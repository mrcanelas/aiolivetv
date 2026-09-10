export const MERGED_CATALOG_PREFIX = 'aiolivetv.merged.';
export const LEGACY_MERGED_CATALOG_PREFIX = 'aiostreams.merged.';

export const LIVE_TV_MERGED_CATALOG_ID = `${MERGED_CATALOG_PREFIX}live-tv`;
export const LEGACY_LIVE_TV_MERGED_CATALOG_ID = `${LEGACY_MERGED_CATALOG_PREFIX}live-tv`;

export const ERROR_META_ID_PREFIX = 'aiolivetverror';
export const LEGACY_ERROR_META_ID_PREFIX = 'aiostreamserror';

export function isMergedCatalogId(id: string): boolean {
  return (
    id.startsWith(MERGED_CATALOG_PREFIX) ||
    id.startsWith(LEGACY_MERGED_CATALOG_PREFIX)
  );
}

export function isLiveTvMergedCatalogId(id: string): boolean {
  return (
    id === LIVE_TV_MERGED_CATALOG_ID || id === LEGACY_LIVE_TV_MERGED_CATALOG_ID
  );
}

export function toCanonicalMergedCatalogId(id: string): string {
  if (id === LEGACY_LIVE_TV_MERGED_CATALOG_ID) {
    return LIVE_TV_MERGED_CATALOG_ID;
  }
  if (id.startsWith(LEGACY_MERGED_CATALOG_PREFIX)) {
    return `${MERGED_CATALOG_PREFIX}${id.slice(LEGACY_MERGED_CATALOG_PREFIX.length)}`;
  }
  return id;
}

export function isErrorMetaId(id: string): boolean {
  return (
    id.startsWith(`${ERROR_META_ID_PREFIX}.`) ||
    id.startsWith(`${LEGACY_ERROR_META_ID_PREFIX}.`)
  );
}

export function errorMetaPayload(id: string): string {
  return id.split('.').slice(1).join('.');
}

export function createErrorMetaId(payload: string): string {
  return `${ERROR_META_ID_PREFIX}.${payload}`;
}

/** Rewrite persisted catalog IDs from the AIOStreams prefix to AIOLiveTV. */
export function migrateLegacyIdentityIds<T>(config: T): T {
  const data = config as {
    catalogModifications?: Array<{ id?: string }>;
    mergedCatalogs?: Array<{ id?: string }>;
  };
  if (data.catalogModifications) {
    for (const modification of data.catalogModifications) {
      if (modification.id && isMergedCatalogId(modification.id)) {
        modification.id = toCanonicalMergedCatalogId(modification.id);
      }
    }
  }
  if (data.mergedCatalogs) {
    for (const catalog of data.mergedCatalogs) {
      if (catalog.id && isMergedCatalogId(catalog.id)) {
        catalog.id = toCanonicalMergedCatalogId(catalog.id);
      }
    }
  }
  return config;
}
