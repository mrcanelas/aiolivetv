import { describe, expect, it } from 'vitest';
import {
  buildLiveTvMergedCatalog,
  LIVE_TV_MERGED_CATALOG_ID,
} from './liveTvMergedCatalog.js';

describe('buildLiveTvMergedCatalog', () => {
  it('returns undefined when there are no tv catalogs', () => {
    expect(
      buildLiveTvMergedCatalog(
        [{ id: 'movies', type: 'movie', name: 'Movies' }],
        'AIOLiveTV'
      )
    ).toBeUndefined();
  });

  it('merges every tv source into a single catalog', () => {
    const merged = buildLiveTvMergedCatalog(
      [
        { id: '0bbe3b0.vivo-tv-channels', type: 'tv', name: 'Vivo TV' },
        { id: '77ee3b0.claro-tv-channels', type: 'tv', name: 'Claro TV' },
        { id: 'movies', type: 'movie', name: 'Movies' },
      ],
      'AIOLiveTV'
    );

    expect(merged).toEqual({
      id: LIVE_TV_MERGED_CATALOG_ID,
      name: 'AIOLiveTV',
      type: 'tv',
      catalogIds: [
        'id=0bbe3b0.vivo-tv-channels&type=tv',
        'id=77ee3b0.claro-tv-channels&type=tv',
      ],
      enabled: true,
    });
  });

  it('omits source catalogs the user disabled', () => {
    const merged = buildLiveTvMergedCatalog(
      [
        { id: '0bbe3b0.vivo-tv-channels', type: 'tv', name: 'Vivo TV' },
        { id: '77ee3b0.claro-tv-channels', type: 'tv', name: 'Claro TV' },
      ],
      'AIOLiveTV',
      [{ id: '77ee3b0.claro-tv-channels', type: 'tv', enabled: false }]
    );

    expect(merged?.catalogIds).toEqual([
      'id=0bbe3b0.vivo-tv-channels&type=tv',
    ]);
  });
});
