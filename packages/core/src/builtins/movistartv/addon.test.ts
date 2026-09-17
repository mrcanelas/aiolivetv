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

const { MovistarTvAddon } = await import('./addon.js');
const { fromUrlSafeBase64, makeRequest } = await import('../../utils/index.js');

const CHANNEL_ID_PREFIX = 'aiolivetv:';

function decodedId(id: string): string {
  return fromUrlSafeBase64(id.slice(CHANNEL_ID_PREFIX.length));
}

describe('Movistar TV builtin', () => {
  beforeEach(() => {
    cacheStores.clear();
    vi.mocked(makeRequest).mockReset();
  });

  it('exposes catalog and EPG metadata for the selected country', () => {
    const addon = new MovistarTvAddon({ timeout: 1000, country: 'ar' });
    const manifest = addon.getManifest();
    expect(manifest.behaviorHints?.epgProvider).toBe(true);
    expect(manifest.name).toBe('Movistar (Argentina)');
    expect(manifest.resources.map((resource) =>
      typeof resource === 'string' ? resource : resource.name
    )).toEqual(['catalog', 'meta']);
    expect(manifest.catalogs[0].extra).toEqual([
      { name: 'skip' },
      { name: 'date' },
    ]);
  });

  it('maps LCH channels and ignores CHA service bundles', async () => {
    vi.mocked(makeRequest).mockImplementation(async (url: string) => {
      if (String(url).includes('contentTypes=LCH')) {
        return {
          ok: true,
          json: async () => ({
            Content: {
              List: [
                {
                  Pid: 'CHA12_SVCTYPE',
                  Title: 'NetflixHardBundle',
                },
                {
                  Pid: 'LCH1225',
                  Title: 'TVN',
                  Images: {
                    Icon: [
                      {
                        Url: 'http://media.gvp.telefonica.com/tvn.png',
                      },
                    ],
                  },
                },
                {
                  Pid: 'LCH497',
                  Title: 'MEGA / MEGA HD',
                  Images: {
                    Logo: [
                      {
                        Url: 'http://media.gvp.telefonica.com/mega.png',
                      },
                    ],
                  },
                },
                {
                  Pid: 'LCH6343',
                  Title: 'TELECANAL_',
                },
                {
                  Pid: 'LCH589',
                  Title: 'DISNEY CHANNEL REGIONAL',
                },
                {
                  Pid: 'LCH590',
                  Title: 'DISNEY CHANNEL HD',
                },
                {
                  Pid: 'LCH547',
                  Title: 'AXN REGIONAL',
                },
                {
                  Pid: 'LCH625',
                  Title: 'AXN HD',
                },
                {
                  Pid: 'LCH6350',
                  Title: 'BABY_TV',
                },
                {
                  Pid: 'LCH864',
                  Title: 'BABY TV',
                },
                {
                  Pid: 'LCH2422',
                  Title: 'Comedy Central SD',
                },
                {
                  Pid: 'LCH6319',
                  Title: '13_Rec',
                },
                {
                  Pid: 'LCH767',
                  Title: '13 Rec',
                },
              ],
            },
          }),
        } as never;
      }
      return { ok: false, json: async () => ({}) } as never;
    });

    const addon = new MovistarTvAddon({ timeout: 1000, country: 'cl' });
    const catalog = await addon.getCatalog();
    expect(catalog.map((item) => item.name)).toEqual([
      '13 Rec',
      'AXN',
      'BABY TV',
      'Comedy Central',
      'DISNEY CHANNEL',
      'MEGA',
      'TELECANAL',
      'TVN',
    ]);
    expect(decodedId(catalog.find((item) => item.name === 'TVN')!.id)).toBe(
      'cl#lch1225'
    );
    expect(
      decodedId(catalog.find((item) => item.name === 'DISNEY CHANNEL')!.id)
    ).toBe('cl#lch590');
    expect(decodedId(catalog.find((item) => item.name === 'AXN')!.id)).toBe(
      'cl#lch625'
    );
    expect(decodedId(catalog.find((item) => item.name === 'BABY TV')!.id)).toBe(
      'cl#lch864'
    );
    expect(decodedId(catalog.find((item) => item.name === '13 Rec')!.id)).toBe(
      'cl#lch767'
    );
    expect(catalog.find((item) => item.name === 'TVN')).toMatchObject({
      type: 'tv',
      country: 'CL',
      language: 'es',
      tvgId: 'TVN',
    });
    expect(catalog.find((item) => item.name === 'TVN')?.poster).toContain(
      'spotlight-cl.cdn.telefonica.com/customer/v1/source'
    );
    expect(
      vi
        .mocked(makeRequest)
        .mock.calls.some(([url]) => String(url).includes('contentTypes=CHA'))
    ).toBe(false);
    expect(
      vi
        .mocked(makeRequest)
        .mock.calls.some(([url]) => String(url).includes('contentTypes=LCH'))
    ).toBe(true);
  });

  it('returns programs from unix-second schedules without device-type filters', async () => {
    vi.mocked(makeRequest).mockImplementation(async (url: string) => {
      const href = String(url);
      if (href.includes('contentTypes=LCH')) {
        return {
          ok: true,
          json: async () => ({
            Content: {
              List: [
                {
                  Pid: 'LCH1225',
                  Title: 'TVN',
                  Images: {
                    Icon: [{ Url: 'http://media.gvp.telefonica.com/tvn.png' }],
                  },
                },
              ],
            },
          }),
        } as never;
      }
      if (href.includes('contentTypes=GEN')) {
        return {
          ok: true,
          json: async () => ({
            Content: { List: [{ Pid: 'GEN1', Title: 'Noticias' }] },
          }),
        } as never;
      }
      if (href.includes('contentTypes=AGE')) {
        return {
          ok: true,
          json: async () => ({
            Content: {
              List: [
                {
                  Pid: 'AGE102',
                  Title: 'TE',
                  Images: {
                    Cover: [
                      { Url: 'http://media.gvp.telefonica.com/te.jpg' },
                    ],
                  },
                },
                { Pid: 'AGE_NONE', Title: 'AGE_NONE', Images: {} },
              ],
            },
          }),
        } as never;
      }
      if (href.includes('contentTypes=PER')) {
        return {
          ok: true,
          json: async () => ({
            Content: { List: [{ Pid: 'PER1', Title: 'Presentador' }] },
          }),
        } as never;
      }
      if (href.includes('/schedules?')) {
        expect(href).not.toContain('ca_deviceTypes');
        return {
          ok: true,
          json: async () => ({
            Content: [
              {
                Title: '24 Horas: Edición - Central',
                Description: 'Noticias del día',
                Start: 1_718_000_000,
                End: 1_718_003_600,
                ReleaseDate: 1_717_900_000,
                GenrePids: ['GEN1'],
                ActorPids: ['PER1'],
                AgeRatingPid: 'AGE102',
                Images: {
                  VideoFrame: [
                    { Url: 'http://media.gvp.telefonica.com/frame.jpg' },
                  ],
                },
              },
            ],
          }),
        } as never;
      }
      return { ok: false, json: async () => ({}) } as never;
    });

    const addon = new MovistarTvAddon({ timeout: 1000, country: 'cl' });
    const catalog = await addon.getCatalog();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_718_000_000 * 1000));
    const meta = await addon.getMeta(catalog[0]!.id);
    vi.useRealTimers();

    expect(decodedId(meta.id)).toBe('cl#lch1225');
    expect(meta.videos?.[0]).toMatchObject({
      title: '24 Horas',
      subtitle: 'Central',
      overview: 'Noticias del día',
      genres: ['Noticias'],
      cast: ['Presentador'],
      ratings: [
        {
          value: 'TE',
          system: 'Movistar',
        },
      ],
    });
    expect(meta.videos?.[0]?.ratings?.[0]?.icon).toContain(
      'spotlight-cl.cdn.telefonica.com'
    );
  });
});
