import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/index.js', () => ({
  Cache: {
    getInstance: () => ({
      get: vi.fn(),
      set: vi.fn(),
    }),
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
  it('exposes catalog and EPG metadata', () => {
    const addon = new ClaroTvAddon({ timeout: 1000, days: 1 });
    expect(addon.getManifest().behaviorHints?.epgProvider).toBe(true);
    expect(addon.getManifest().catalogs[0].extra).toEqual([{ name: 'skip' }]);
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
            },
          ],
        },
      }),
    } as unknown as Awaited<ReturnType<typeof makeRequest>>);

    const addon = new ClaroTvAddon({ timeout: 1000, days: 1 });
    const catalog = await addon.getCatalog();

    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
      name: 'Globo',
      type: 'channel',
      tvgId: 'Globo',
      country: 'BR',
      language: 'pt',
      poster: 'https://cdn.example/globo.png',
    });
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

    const addon = new ClaroTvAddon({ timeout: 1000, days: 1 });
    const catalog = await addon.getCatalog();
    const meta = await addon.getMeta(catalog[0]!.id);

    expect(meta.name).toBe('Globo');
    expect(meta.videos?.[0]).toMatchObject({
      title: 'Jornal Nacional',
      overview: 'Notícias do dia',
      season: 1,
      episode: 2,
      thumbnail: 'https://cdn.example/frame-420_236.jpg',
    });
  });
});
