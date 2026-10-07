import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIOStreamsContext } from './types.js';
import type { MetaPreview } from '../db/schemas.js';

const fixture = vi.hoisted(() => {
  process.env.BASE_URL = 'http://127.0.0.1:3000';
  return {
    fetch: vi.fn(),
    cache: new Map<string, { value: unknown; expires: number }>(),
  };
});
vi.mock('./wrapper.js', () => ({
  Wrapper: class {
    getCatalogResponse(...args: unknown[]) {
      return fixture.fetch(...args);
    }
  },
}));
vi.mock('./caches.js', () => ({
  shuffleCache: { get: vi.fn(), set: vi.fn() },
  mergedCatalogCache: {
    get: async (key: string) => {
      const entry = fixture.cache.get(key);
      return entry && entry.expires > Date.now()
        ? structuredClone(entry.value)
        : undefined;
    },
    set: async (key: string, value: unknown, ttl: number) => {
      fixture.cache.set(key, {
        value: structuredClone(value),
        expires: Date.now() + ttl * 1000,
      });
    },
  },
}));
vi.mock('../poster/index.js', () => ({ createPosterService: () => null }));
vi.mock('../utils/index.js', async () => ({
  ExtrasParser: (await import('../utils/extras.js')).ExtrasParser,
  constants: await import('../utils/constants.js'),
  getSimpleTextHash: (value: string) => value,
  getTimeTakenSincePoint: () => '',
  createLogger: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  maskSensitiveInfo: (value: string) => value,
}));
import { getMergedCatalog } from './catalog.js';
import {
  buildLiveTvMergedCatalog,
  LIVE_TV_MERGED_CATALOG_ID,
} from './liveTvMergedCatalog.js';

function context(): AIOStreamsContext {
  return {
    userData: {
      uuid: 'fixture',
      mergedCatalogs: [
        {
          id: LIVE_TV_MERGED_CATALOG_ID,
          name: 'TV',
          type: 'tv',
          enabled: true,
          catalogIds: ['id=fixture.channels&type=tv'],
        },
      ],
    },
    addons: [{ instanceId: 'fixture', name: 'Fixture' }],
    manifests: {
      fixture: {
        catalogs: [
          {
            id: 'channels',
            type: 'tv',
            extra: [{ name: 'skip' }, { name: 'search' }, { name: 'date' }],
          },
        ],
      },
    },
    addonInitialisationErrors: [],
  } as unknown as AIOStreamsContext;
}

function provideChannels(count: number, detailed = false) {
  const items = Array.from({ length: count }, (_, index) => ({
    id: `channel:${index}`,
    type: 'tv',
    name: `Channel ${String(index).padStart(4, '0')}`,
    genres: [index % 2 ? 'News' : 'Sports'],
    ...(detailed
      ? { videos: [{ id: `programme:${index}`, title: 'News' }] }
      : {}),
  }));
  fixture.fetch.mockImplementation(async (_type, _id, extras) => {
    const skip = Number(new URLSearchParams(extras).get('skip') || 0);
    return {
      [detailed ? 'metasDetailed' : 'metas']: items.slice(skip, skip + 25),
    };
  });
  return items;
}

beforeEach(() => {
  fixture.fetch.mockReset();
  fixture.cache.clear();
  vi.useRealTimers();
});

describe('merged Live TV pagination', () => {
  it('paginates sources that do not expose skip themselves', async () => {
    const ctx = context();
    ctx.manifests.fixture!.catalogs[0].extra = [];
    const items = provideChannels(60);
    fixture.fetch.mockResolvedValue({ metas: items });
    const first = await getMergedCatalog(ctx, 'tv', LIVE_TV_MERGED_CATALOG_ID);
    const second = await getMergedCatalog(
      ctx,
      'tv',
      LIVE_TV_MERGED_CATALOG_ID,
      'skip=25'
    );
    expect(first.data.map((item) => item.id)).toEqual(
      items.slice(0, 25).map((item) => item.id)
    );
    expect(second.data.map((item) => item.id)).toEqual(
      items.slice(25, 50).map((item) => item.id)
    );
    expect(fixture.fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps reverse ordering stable across pages', async () => {
    const ctx = context();
    const items = provideChannels(60);
    ctx.userData.catalogModifications = [
      { id: LIVE_TV_MERGED_CATALOG_ID, type: 'tv', reverse: true },
    ];
    const first = await getMergedCatalog(ctx, 'tv', LIVE_TV_MERGED_CATALOG_ID);
    const second = await getMergedCatalog(
      ctx,
      'tv',
      LIVE_TV_MERGED_CATALOG_ID,
      'skip=25'
    );
    expect([...first.data, ...second.data].map((item) => item.id)).toEqual(
      [...items]
        .reverse()
        .slice(0, 50)
        .map((item) => item.id)
    );
  });

  it('returns every channel exactly once in pages of 25 without rescanning sources', async () => {
    const ctx = context();
    const items = provideChannels(1287);
    const collected: MetaPreview[] = [];
    for (let skip = 0; skip < 1300; skip += 25) {
      const response = await getMergedCatalog(
        ctx,
        'tv',
        LIVE_TV_MERGED_CATALOG_ID,
        `skip=${skip}`
      );
      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(
        Math.min(25, Math.max(0, items.length - skip))
      );
      collected.push(...response.data);
    }
    expect(collected.map((item) => item.id)).toEqual(
      items.map((item) => item.id)
    );
    expect(fixture.fetch).toHaveBeenCalledTimes(53);
    expect(
      (
        await getMergedCatalog(
          ctx,
          'tv',
          LIVE_TV_MERGED_CATALOG_ID,
          'skip=1300'
        )
      ).data
    ).toEqual([]);
    expect(fixture.fetch).toHaveBeenCalledTimes(53);
  });

  it('applies visibility, deduplication and genre filters before pagination', async () => {
    const ctx = context();
    const items = provideChannels(80);
    ctx.userData.channelMappings = [
      { id: 'channel:1', hidden: true },
      { id: 'channel:3', enabled: false },
      {
        id: 'channel:5',
        streams: [{ addonId: 'fixture', channelId: 'channel:7' }],
      },
    ];
    const expected = items.filter(
      (item, index) => index % 2 && ![1, 3, 7].includes(index)
    );
    const first = await getMergedCatalog(
      ctx,
      'tv',
      LIVE_TV_MERGED_CATALOG_ID,
      'genre=News'
    );
    const second = await getMergedCatalog(
      ctx,
      'tv',
      LIVE_TV_MERGED_CATALOG_ID,
      'genre=News&skip=25'
    );
    expect([...first.data, ...second.data].map((item) => item.id)).toEqual(
      expected.map((item) => item.id)
    );
  });

  it('keeps dates, searches and configuration changes isolated in the cache', async () => {
    const ctx = context();
    provideChannels(30);
    await getMergedCatalog(ctx, 'tv', LIVE_TV_MERGED_CATALOG_ID);
    expect(fixture.fetch).toHaveBeenCalledTimes(3);
    await getMergedCatalog(
      ctx,
      'tv',
      LIVE_TV_MERGED_CATALOG_ID,
      'search=Channel'
    );
    expect(fixture.fetch).toHaveBeenCalledTimes(6);
    ctx.userData.channelMappings = [{ id: 'channel:0', hidden: true }];
    const response = await getMergedCatalog(
      ctx,
      'tv',
      LIVE_TV_MERGED_CATALOG_ID
    );
    expect(fixture.fetch).toHaveBeenCalledTimes(9);
    expect(response.data[0].id).toBe('channel:1');
  });

  it('paginates Native EPG without losing programmes and separates guide dates', async () => {
    const ctx = context();
    provideChannels(30, true);
    const first = await getMergedCatalog(
      ctx,
      'tv',
      LIVE_TV_MERGED_CATALOG_ID,
      'date=2026-10-07'
    );
    const second = await getMergedCatalog(
      ctx,
      'tv',
      LIVE_TV_MERGED_CATALOG_ID,
      'date=2026-10-07&skip=25'
    );
    expect(first.data).toEqual([]);
    expect(first.metasDetailed).toHaveLength(25);
    expect(second.metasDetailed).toHaveLength(5);
    expect(second.metasDetailed?.[0].videos?.[0].id).toBe('programme:25');
    expect(fixture.fetch).toHaveBeenCalledTimes(3);
    await getMergedCatalog(
      ctx,
      'tv',
      LIVE_TV_MERGED_CATALOG_ID,
      'date=2026-10-08'
    );
    expect(fixture.fetch).toHaveBeenCalledTimes(6);
  });

  it('expires the consolidated cache after five minutes', async () => {
    vi.useFakeTimers();
    const ctx = context();
    provideChannels(30);
    await getMergedCatalog(ctx, 'tv', LIVE_TV_MERGED_CATALOG_ID);
    vi.advanceTimersByTime(300001);
    await getMergedCatalog(ctx, 'tv', LIVE_TV_MERGED_CATALOG_ID, 'skip=25');
    expect(fixture.fetch).toHaveBeenCalledTimes(6);
  });

  it('does not cache upstream failures or partial scans', async () => {
    const ctx = context();
    const items = provideChannels(30);
    fixture.fetch.mockRejectedValueOnce(new Error('Unavailable'));
    expect(
      (await getMergedCatalog(ctx, 'tv', LIVE_TV_MERGED_CATALOG_ID)).success
    ).toBe(false);
    fixture.fetch
      .mockResolvedValueOnce({ metas: items.slice(0, 25) })
      .mockRejectedValueOnce(new Error('Unavailable'));
    expect(
      (await getMergedCatalog(ctx, 'tv', LIVE_TV_MERGED_CATALOG_ID)).data
    ).toHaveLength(25);
    expect(fixture.cache.size).toBe(0);
    expect(
      (await getMergedCatalog(ctx, 'tv', LIVE_TV_MERGED_CATALOG_ID, 'skip=25'))
        .data
    ).toHaveLength(5);
  });
});

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

    expect(merged?.catalogIds).toEqual(['id=0bbe3b0.vivo-tv-channels&type=tv']);
  });
});
