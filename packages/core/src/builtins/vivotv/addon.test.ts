import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/index.js', () => ({
  Cache: {
    getInstance: () => ({
      get: vi.fn(),
      set: vi.fn(),
    }),
  },
  fromUrlSafeBase64: (value: string) =>
    Buffer.from(value, 'base64url').toString(),
  makeRequest: vi.fn(),
  toUrlSafeBase64: (value: string) => Buffer.from(value).toString('base64url'),
}));

const { VivoTvAddon } = await import('./addon.js');
const { makeRequest } = await import('../../utils/index.js');

describe('Vivo TV builtin', () => {
  it('exposes catalog and EPG metadata', () => {
    const addon = new VivoTvAddon({ timeout: 1000, days: 1 });
    expect(addon.getManifest().behaviorHints?.epgProvider).toBe(true);
    expect(addon.getManifest().catalogs[0].extra).toEqual([{ name: 'skip' }]);
  });

  it('maps channels from the Telefónica API', async () => {
    vi.mocked(makeRequest).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        Content: {
          List: [
            {
              Pid: 'LCH001',
              Title: 'Globo HD',
              Images: { Icon: [{ Url: 'https://cdn.example/icon.png' }] },
            },
          ],
        },
      }),
    } as unknown as Awaited<ReturnType<typeof makeRequest>>);

    const addon = new VivoTvAddon({ timeout: 1000, days: 1 });
    const catalog = await addon.getCatalog();

    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
      name: 'Globo',
      type: 'channel',
      tvgId: 'Globo',
      country: 'BR',
      language: 'pt',
    });
    expect(catalog[0]?.poster).toContain(
      'spotlight-br.cdn.telefonica.com/customer/v1/source'
    );
  });

  it('returns channel programs from schedules', async () => {
    const channelResponse = {
      ok: true,
      json: async () => ({
        Content: {
          List: [
            {
              Pid: 'LCH001',
              Title: 'Globo HD',
              Images: { Icon: [{ Url: 'https://cdn.example/icon.png' }] },
            },
          ],
        },
      }),
    };
    const genresResponse = {
      ok: true,
      json: async () => ({
        Content: { List: [{ Pid: 'GEN1', Title: 'Notícias' }] },
      }),
    };
    const ratingsResponse = {
      ok: true,
      json: async () => ({
        Content: {
          List: [{ Pid: 'AGE1', Description: 'L', Images: {} }],
        },
      }),
    };
    const personsResponse = {
      ok: true,
      json: async () => ({
        Content: { List: [{ Pid: 'PER1', Title: 'Apresentador' }] },
      }),
    };
    const scheduleResponse = {
      ok: true,
      json: async () => ({
        Content: [
          {
            Title: 'Jornal Nacional: Edição - Principal',
            Description: 'Notícias do dia',
            Start: 1_718_000_000,
            End: 1_718_003_600,
            ReleaseDate: 1_717_900_000,
            GenrePids: ['GEN1'],
            ActorPids: ['PER1'],
            Images: {
              VideoFrame: [{ Url: 'https://cdn.example/frame.jpg' }],
            },
          },
        ],
      }),
    };

    vi.mocked(makeRequest).mockImplementation(async (url: string) => {
      if (url.includes('contentTypes=LCH')) {
        return channelResponse as never;
      }
      if (url.includes('contentTypes=GEN')) {
        return genresResponse as never;
      }
      if (url.includes('contentTypes=AGE')) {
        return ratingsResponse as never;
      }
      if (url.includes('contentTypes=PER')) {
        return personsResponse as never;
      }
      if (url.includes('/schedules?')) {
        return scheduleResponse as never;
      }
      return { ok: false, json: async () => ({}) } as never;
    });

    const addon = new VivoTvAddon({ timeout: 1000, days: 1 });
    const catalog = await addon.getCatalog();
    const meta = await addon.getMeta(catalog[0]!.id);

    expect(meta.name).toBe('Globo');
    expect(meta.videos?.[0]).toMatchObject({
      title: 'Jornal Nacional',
      subtitle: 'Principal',
      overview: 'Notícias do dia',
      genres: ['Notícias'],
      cast: ['Apresentador'],
    });
    expect(meta.videos?.[0]?.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'Genres', name: 'Notícias' }),
        expect.objectContaining({ category: 'Cast', name: 'Apresentador' }),
      ])
    );
  });
});
