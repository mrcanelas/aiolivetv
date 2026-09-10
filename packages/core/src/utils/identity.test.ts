import { describe, expect, it } from 'vitest';
import {
  LIVE_TV_MERGED_CATALOG_ID,
  createErrorMetaId,
  errorMetaPayload,
  isErrorMetaId,
  isLiveTvMergedCatalogId,
  isMergedCatalogId,
  migrateLegacyIdentityIds,
  toCanonicalMergedCatalogId,
} from './identity.js';

describe('identity', () => {
  it('recognises current and legacy merged catalog ids', () => {
    expect(isMergedCatalogId(LIVE_TV_MERGED_CATALOG_ID)).toBe(true);
    expect(isMergedCatalogId('aiostreams.merged.live-tv')).toBe(true);
    expect(isMergedCatalogId('aiolivetv.merged.123')).toBe(true);
    expect(isMergedCatalogId('xmltv-1.channels')).toBe(false);
    expect(isLiveTvMergedCatalogId('aiostreams.merged.live-tv')).toBe(true);
  });

  it('rewrites legacy merged catalog ids', () => {
    expect(toCanonicalMergedCatalogId('aiostreams.merged.live-tv')).toBe(
      LIVE_TV_MERGED_CATALOG_ID
    );
    expect(toCanonicalMergedCatalogId('aiostreams.merged.171')).toBe(
      'aiolivetv.merged.171'
    );
  });

  it('accepts current and legacy error meta ids', () => {
    const id = createErrorMetaId('payload');
    expect(id.startsWith('aiolivetverror.')).toBe(true);
    expect(isErrorMetaId(id)).toBe(true);
    expect(isErrorMetaId('aiostreamserror.payload')).toBe(true);
    expect(errorMetaPayload('aiostreamserror.a.b')).toBe('a.b');
  });

  it('migrates persisted catalog ids in user data', () => {
    const config = migrateLegacyIdentityIds({
      catalogModifications: [{ id: 'aiostreams.merged.live-tv', type: 'tv' }],
      mergedCatalogs: [{ id: 'aiostreams.merged.99' }],
    });
    expect(config.catalogModifications[0].id).toBe(LIVE_TV_MERGED_CATALOG_ID);
    expect(config.mergedCatalogs[0].id).toBe('aiolivetv.merged.99');
  });
});
