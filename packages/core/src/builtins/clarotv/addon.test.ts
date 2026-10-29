import { beforeEach, describe, expect, it, vi } from 'vitest';

const sourceCache = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));

vi.mock('../../utils/index.js', () => ({
  Cache: {
    getInstance: () => sourceCache,
  },
  decodeHtmlEntities: (value: string) => value,
  fromUrlSafeBase64: (value: string) =>
    Buffer.from(value, 'base64url').toString(),
  makeRequest: vi.fn(),
  toUrlSafeBase64: (value: string) => Buffer.from(value).toString('base64url'),
}));

const { ClaroTvAddon } = await import('./addon.js');
const { makeRequest } = await import('../../utils/index.js');

describe('Claro TV+ builtin', () => {
  beforeEach(() => vi.resetAllMocks());

  it('exposes catalog and EPG metadata', async () => {
    vi.mocked(makeRequest).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'OK',
        response: {
          liveChannels: [
            { id: 316, name: 'Globo', logo: 'https://cdn.example/globo.png' },
          ],
        },
      }),
    } as never);
    const addon = new ClaroTvAddon({ timeout: 1000 });
    const manifest = await addon.getManifest();
    expect(manifest.behaviorHints?.epgProvider).toBe(true);
    expect(manifest.catalogs[0].extra).toEqual([
      { name: 'skip' },
      { name: 'date' },
      { name: 'genre', isRequired: false },
    ]);
  });

  it.each([
    ['HTTP failure', { ok: false, status: 403 }, 'HTTP 403'],
    [
      'API failure',
      { ok: true, json: async () => ({ status: 'ERROR' }) },
      'invalid liveChannels',
    ],
    [
      'missing channels',
      { ok: true, json: async () => ({ response: {} }) },
      'invalid liveChannels',
    ],
    [
      'empty channels',
      { ok: true, json: async () => ({ response: { liveChannels: [] } }) },
      'no channels for TERESINA,PIAUI',
    ],
  ])(
    'reports %s without caching an empty catalog',
    async (_name, response, message) => {
      vi.mocked(makeRequest).mockResolvedValue(response as never);
      const addon = new ClaroTvAddon({
        timeout: 1000,
        location: 'TERESINA,PIAUI',
      });
      await expect(addon.getCatalog()).rejects.toThrow(message);
      expect(sourceCache.set).not.toHaveBeenCalled();
      expect((await addon.getManifest()).behaviorHints?.epgProvider).toBe(
        false
      );
    }
  );

  it('propagates network and JSON failures without caching them', async () => {
    const addon = new ClaroTvAddon({ timeout: 1000 });
    vi.mocked(makeRequest).mockRejectedValueOnce(new Error('fetch failed'));
    await expect(addon.getCatalog()).rejects.toThrow('fetch failed');
    vi.mocked(makeRequest).mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new SyntaxError('Invalid JSON');
      },
    } as never);
    await expect(addon.getCatalog()).rejects.toThrow('Invalid JSON');
    expect(sourceCache.set).not.toHaveBeenCalled();
  });

  it('retries an empty catalog cached by an earlier failed request', async () => {
    sourceCache.get.mockResolvedValueOnce([]);
    vi.mocked(makeRequest).mockResolvedValueOnce({
      ok: false,
      status: 503,
    } as never);
    await expect(
      new ClaroTvAddon({ timeout: 1000 }).getCatalog()
    ).rejects.toThrow('HTTP 503');
    expect(makeRequest).toHaveBeenCalledOnce();
  });

  it('maps channels from the Claro TV+ API', async () => {
    vi.mocked(makeRequest).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        response: {
          liveChannels: [
            {
              id: 316,
              name: 'Globo HD',
              logo: 'https://cdn.example/globo.png',
              type: 'VARIEDADES',
            },
          ],
        },
      }),
    } as unknown as Awaited<ReturnType<typeof makeRequest>>);

    const addon = new ClaroTvAddon({ timeout: 1000 });
    const catalog = await addon.getCatalog();

    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
      name: 'Globo',
      type: 'tv',
      tvgId: 'Globo',
      country: 'BR',
      language: 'pt',
      poster: 'https://cdn.example/globo.png',
      genres: ['Variedades'],
    });
  });

  it('uses tvChannels type when the channel type is missing', async () => {
    vi.mocked(makeRequest).mockResolvedValue({
      ok: true,
      json: async () => ({
        response: {
          liveChannels: [
            {
              id: 400,
              name: 'Sportv HD',
              logo: 'https://cdn.example/sportv.png',
              tvChannels: [{ type: 'ESPORTES' }],
            },
          ],
        },
      }),
    } as unknown as Awaited<ReturnType<typeof makeRequest>>);

    const addon = new ClaroTvAddon({ timeout: 1000 });
    const catalog = await addon.getCatalog();

    expect(catalog[0]).toMatchObject({
      name: 'Sportv',
      genres: ['Esportes'],
    });
    expect(await addon.getCatalog(0, 'VARIEDADES')).toEqual([]);
    expect(await addon.getCatalog(0, 'ESPORTES')).toHaveLength(1);
  });

  it('returns channel programs from schedules', async () => {
    const channelResponse = {
      ok: true,
      json: async () => ({
        response: {
          liveChannels: [
            {
              id: '316',
              name: 'Globo HD',
              logo: 'https://cdn.example/globo.png',
            },
          ],
        },
      }),
    };
    const scheduleResponse = {
      ok: true,
      json: async () => ({
        response: {
          liveChannels: [
            {
              id: '316',
              schedules: [
                {
                  title: 'Jornal Nacional',
                  description: 'Notícias do dia',
                  seasonNumber: 1,
                  episodeNumber: 2,
                  image:
                    'https://cdn.example/frame-{{image-size-placeholder}}.jpg',
                  startTime: 1_718_000_000,
                  endTime: 1_718_003_600,
                  rating: { code: 12 },
                },
                {
                  title: 'Desenho animado',
                  startTime: 1_718_003_600,
                  endTime: 1_718_007_200,
                  rating: { code: 1 },
                },
              ],
            },
          ],
        },
      }),
    };

    vi.mocked(makeRequest).mockImplementation(async (url: string) => {
      if (url.includes('channelIds=316')) {
        return scheduleResponse as never;
      }
      return channelResponse as never;
    });

    const addon = new ClaroTvAddon({ timeout: 1000 });
    const catalog = await addon.getCatalog();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_718_000_000 * 1000));
    const meta = await addon.getMeta(catalog[0]!.id);
    vi.useRealTimers();

    expect(meta.name).toBe('Globo');
    expect(meta.videos?.[0]).toMatchObject({
      title: 'Jornal Nacional',
      overview: 'Notícias do dia',
      season: 1,
      episode: 2,
      thumbnail: 'https://cdn.example/frame-420_236.jpg',
      background: 'https://cdn.example/frame-1920_1080.jpg',
      ratings: [
        {
          value: '12',
          system: 'ClassInd',
          icon: 'https://cdn.jsdelivr.net/gh/mrcanelas/age-rating-kit@latest/icons/classind/12.svg',
        },
      ],
    });
    expect(meta.videos?.[1]).toMatchObject({
      title: 'Desenho animado',
      ratings: [
        {
          value: 'L',
          system: 'ClassInd',
          icon: 'https://cdn.jsdelivr.net/gh/mrcanelas/age-rating-kit@latest/icons/classind/l.svg',
        },
      ],
    });
  });
});
