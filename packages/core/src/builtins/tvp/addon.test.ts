import { beforeEach, describe, expect, it, vi } from 'vitest';

const cacheStores = new Map<string, Map<string, unknown>>();

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cacheStore(name: string) {
  let store = cacheStores.get(name);
  if (!store) {
    store = new Map();
    cacheStores.set(name, store);
  }
  return store;
}

vi.mock('../../utils/index.js', () => ({
  Cache: {
    getInstance: (name: string) => ({
      get: async (key: string) => cacheStore(name).get(key),
      set: async (key: string, value: unknown) => {
        cacheStore(name).set(key, jsonClone(value));
      },
    }),
  },
  decodeHtmlEntities: (value: string) => value,
  fromUrlSafeBase64: (value: string) =>
    Buffer.from(value, 'base64url').toString(),
  makeRequest: vi.fn(),
  toUrlSafeBase64: (value: string) => Buffer.from(value).toString('base64url'),
}));

const { TvpAddon } = await import('./addon.js');
const { makeRequest } = await import('../../utils/index.js');

const CHANNEL = {
  id: 399699,
  title: 'TVP INFO',
  type: 'LIVE',
  logoImages: { '1x1': [{ url: 'https://cdn.example/logo.png' }] },
};

function jsonResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  } as unknown as Awaited<ReturnType<typeof makeRequest>>;
}

describe('TVP builtin', () => {
  beforeEach(() => {
    cacheStores.clear();
    vi.mocked(makeRequest).mockReset();
  });

  it('exposes catalog, EPG and stream metadata', () => {
    const addon = new TvpAddon({ timeout: 1000 });
    const manifest = addon.getManifest();
    expect(manifest.behaviorHints?.epgProvider).toBe(true);
    expect(manifest.resources.map((resource) =>
      typeof resource === 'string' ? resource : resource.name
    )).toEqual(['catalog', 'meta', 'stream']);
    expect(manifest.catalogs[0].extra).toEqual([
      { name: 'skip' },
      { name: 'date' },
    ]);
  });

  it('maps live channels from the TVP API', async () => {
    vi.mocked(makeRequest).mockImplementation(async (url: string) => {
      if (String(url).includes('products/lives?')) {
        return jsonResponse({ items: [CHANNEL] });
      }
      return { ok: false, json: async () => ({}) } as never;
    });

    const catalog = await new TvpAddon({ timeout: 1000 }).getCatalog();
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
      name: 'TVP INFO',
      type: 'tv',
      country: 'PL',
      language: 'pl',
      tvgId: 'TVP INFO',
    });
    expect(catalog[0]?.poster).toBe('https://cdn.example/logo.png');
  });

  it('returns programme videos for a UTC day', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T12:00:00.000Z'));
    vi.mocked(makeRequest).mockImplementation(async (url: string) => {
      const href = String(url);
      if (href.includes('products/lives?')) {
        return jsonResponse({ items: [CHANNEL] });
      }
      if (href.includes('products/lives/programmes')) {
        return jsonResponse([
          {
            id: 11,
            title: 'Wiadomości',
            since: '2026-09-17T12:00:00+0000',
            till: '2026-09-17T12:30:00+0000',
            live: { id: 399699 },
            description: 'Serwis informacyjny',
            year: 2026,
            rating: '12',
          },
        ]);
      }
      return { ok: false, json: async () => ({}) } as never;
    });

    const addon = new TvpAddon({ timeout: 1000 });
    const catalog = await addon.getCatalog();
    const meta = await addon.getMeta(catalog[0]!.id);
    vi.useRealTimers();

    expect(meta.videos?.[0]).toMatchObject({
      title: 'Wiadomości',
      overview: 'Serwis informacyjny',
      startTime: '2026-09-17T12:00:00.000Z',
      endTime: '2026-09-17T12:30:00.000Z',
      ratings: [
        {
          value: '12',
          system: 'TVP',
          icon: 'https://s.tvp.pl/files/portale-v4/tvp-pl/default/assets/images/elements/12.svg',
        },
      ],
    });
  });

  it('attaches TVP age, JM and subtitle icons', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T12:00:00.000Z'));
    vi.mocked(makeRequest).mockImplementation(async (url: string) => {
      const href = String(url);
      if (href.includes('products/lives?')) {
        return jsonResponse({ items: [CHANNEL] });
      }
      if (href.includes('products/lives/programmes')) {
        return jsonResponse([
          {
            id: 11,
            title: 'Wiadomości JM',
            since: '2026-09-17T12:00:00+0000',
            till: '2026-09-17T12:30:00+0000',
            live: { id: 399699 },
            rating: 0,
            napisy: true,
            ad: true,
          },
        ]);
      }
      return { ok: false, json: async () => ({}) } as never;
    });

    const meta = await new TvpAddon({ timeout: 1000 }).getMeta(
      (await new TvpAddon({ timeout: 1000 }).getCatalog())[0]!.id
    );
    vi.useRealTimers();

    expect(meta.videos?.[0]?.ratings).toEqual([
      {
        value: '0',
        system: 'TVP',
        icon: 'https://s.tvp.pl/files/portale-v4/tvp-pl/default/assets/images/elements/smile_green.svg',
      },
      {
        value: 'JM',
        system: 'TVP',
        icon: 'https://s.tvp.pl/files/portale-v4/tvp-pl/default/assets/images/elements/jm.svg',
      },
      {
        value: 'N',
        system: 'TVP',
        icon: 'https://s.tvp.pl/files/portale-v4/tvp-pl/default/assets/images/elements/N.svg',
      },
      {
        value: 'AD',
        system: 'TVP',
        icon: 'https://s.tvp.pl/files/portale-v4/tvp-pl/default/assets/images/elements/AD.svg',
      },
    ]);
  });

  it('returns guide videos from Warsaw-offset rows without live.id', async () => {
    vi.mocked(makeRequest).mockImplementation(async (url: string) => {
      const href = String(url);
      if (href.includes('products/lives?')) {
        return jsonResponse({
          items: [CHANNEL, { id: 11, title: 'TVP 1', type: 'LIVE' }],
        });
      }
      if (href.includes('products/lives/programmes')) {
        const liveId = new URL(href).searchParams.get('liveId[]');
        return jsonResponse([
          {
            id: Number(liveId) === 399699 ? 21 : 22,
            title: Number(liveId) === 399699 ? 'Wiadomości' : 'Teleexpress',
            since: '2026-09-17T14:00:00+02:00',
            till: '2026-09-17T14:30:00+02:00',
          },
        ]);
      }
      return { ok: false, json: async () => ({}) } as never;
    });

    const guide = await new TvpAddon({ timeout: 1000 }).getCatalogGuide(
      0,
      '2026-09-17'
    );

    expect(guide.map((meta) => meta.videos?.[0]?.title)).toEqual([
      'Teleexpress',
      'Wiadomości',
    ]);
    expect(guide[0]?.videos?.[0]).toMatchObject({
      startTime: '2026-09-17T12:00:00.000Z',
      endTime: '2026-09-17T12:30:00.000Z',
    });
    expect(
      vi
        .mocked(makeRequest)
        .mock.calls.filter(([url]) =>
          String(url).includes('products/lives/programmes')
        )
    ).toHaveLength(2);
  });

  it('returns direct HLS streams and skips DRM playlists', async () => {
    vi.mocked(makeRequest).mockImplementation(async (url: string) => {
      const href = String(url);
      if (href.includes('products/lives?')) {
        return jsonResponse({ items: [CHANNEL] });
      }
      if (href.includes('videos/playlist')) {
        return jsonResponse({
          drm: { widevine: true },
          sources: {
            HLS: [{ src: 'https://cdn.example/live.m3u8' }],
          },
        });
      }
      return { ok: false, json: async () => ({}) } as never;
    });

    const addon = new TvpAddon({ timeout: 1000 });
    const catalog = await addon.getCatalog();
    expect(await addon.getStreams(catalog[0]!.id)).toEqual([]);

    cacheStores.clear();
    vi.mocked(makeRequest).mockImplementation(async (url: string) => {
      const href = String(url);
      if (href.includes('products/lives?')) {
        return jsonResponse({ items: [CHANNEL] });
      }
      if (href.includes('videos/playlist')) {
        return jsonResponse({
          sources: {
            HLS: [{ src: 'https://cdn.example/live.m3u8' }],
            DASH: [{ src: 'https://cdn.example/live.mpd' }],
          },
        });
      }
      return { ok: false, json: async () => ({}) } as never;
    });

    const streams = await addon.getStreams((await addon.getCatalog())[0]!.id);
    expect(streams.map((stream) => stream.url)).toEqual([
      'https://cdn.example/live.m3u8',
      'https://cdn.example/live.mpd',
    ]);
    expect(streams[0]?.name).toBe('TVP · HLS');
    expect(streams[0]?.behaviorHints).toEqual({
      notWebReady: true,
      proxyHeaders: {
        request: {
          Origin: 'https://vod.tvp.pl',
          Referer: 'https://vod.tvp.pl/',
        },
      },
    });
  });
});
