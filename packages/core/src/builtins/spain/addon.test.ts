import { gzipSync } from 'node:zlib';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const stores = new Map<string, Map<string, unknown>>();
vi.mock('../../utils/index.js', () => ({
  Cache: {
    getInstance: (name: string) => ({
      wrap: async (fn: () => Promise<unknown>, key: string) => {
        let store = stores.get(name);
        if (!store) {
          store = new Map();
          stores.set(name, store);
        }
        if (store.has(key)) return store.get(key);
        const result = await fn();
        store.set(key, JSON.parse(JSON.stringify(result)));
        return result;
      },
    }),
  },
  makeRequest: vi.fn(),
  fromUrlSafeBase64: (value: string) =>
    Buffer.from(value, 'base64url').toString(),
  toUrlSafeBase64: (value: string) => Buffer.from(value).toString('base64url'),
}));
vi.mock('../../streams/web-readiness.js', () => ({
  resolveNotWebReady: async () => false,
}));

const { OrangeTvAddon, MovistarPlusAddon } =
  await import('./addon.js');
const { makeRequest } = await import('../../utils/index.js');
const { encodeChannelId } = await import('../live-tv/shared.js');
const { clearM3uSourceCache } = await import('../m3u-reader/addon.js');
const { clearXmltvSourceCache } = await import('../xmltv-reader/addon.js');

function response(value: unknown) {
  return new Response(JSON.stringify(value)) as unknown as Awaited<
    ReturnType<typeof makeRequest>
  >;
}
const start = Date.parse('2026-10-13T12:00:00Z');
const end = start + 3_600_000;
const orangeProgram = {
  id: 99,
  name: 'Film',
  startDate: start,
  endDate: end,
  description: 'Basic synopsis',
  genres: [{ name: 'Drama' }],
  prLevel: 5,
  seriesSeason: '2',
  episodeId: '3',
  attachments: [{ name: 'COVER', value: '/epg/film.jpg' }],
};
const movistarProgram = {
  Id: 99,
  Titulo: 'Film',
  FechaHoraInicio: String(start),
  FechaHoraFin: String(end),
  Ficha: 'https://ottcache.dof6.com/film',
  Resena: 'Basic synopsis',
  NivelMoral: { Id: '+12' },
  GeneroComAntena: 'Drama',
};

beforeEach(() => {
  stores.clear();
  clearM3uSourceCache();
  clearXmltvSourceCache();
  vi.mocked(makeRequest).mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-13T12:30:00Z'));
});
afterEach(() => vi.useRealTimers());

function orangeMock(
  programs: (typeof orangeProgram)[] = [orangeProgram],
  failDetails = false
) {
  vi.mocked(makeRequest).mockImplementation(async (url) => {
    const source = String(url);
    if (source.includes('GetChannelList'))
      return response({
        response: [
          {
            externalChannelId: '101',
            name: 'La 1',
            attachments: [{ name: 'LOGO', value: '/logo.png' }],
          },
        ],
      });
    if (source.includes('GetParentalRatingList'))
      return response({ response: [{ level: 5, name: 'ML_12' }] });
    if (source.includes('GetExtendedProgram')) {
      if (failDetails) throw new Error('Details unavailable');
      return response({
        response: {
          ...orangeProgram,
          description: 'Full synopsis',
          prName: 'ML_12',
          contributors: [
            { firstName: 'Actor', lastName: 'One', role: 'ACT' },
            { firstName: 'Director', lastName: 'One', role: 'DIR' },
          ],
          attachments: [
            ...orangeProgram.attachments,
            { name: 'BACKGROUND', value: '/epg/background.jpg' },
          ],
        },
      });
    }
    return response([{ channelExternalId: '101', programs }]);
  });
}

function movistarMock(
  programs: (typeof movistarProgram)[] = [movistarProgram],
  failDetails = false
) {
  vi.mocked(makeRequest).mockImplementation(async (url) => {
    const source = String(url);
    if (source.includes('contents/channels'))
      return response([
        {
          CodCadenaTv: 'TVE',
          Nombre: 'La 1',
          Logo: 'https://example.com/logo.png',
        },
      ]);
    if (source.includes('/OTT/epg')) return response(programs);
    if (failDetails) throw new Error('Details unavailable');
    return response({
      Descripcion: 'Full synopsis',
      Actores: 'Actor One, Actor Two',
      Directores: 'Director One',
      Anno: '2020',
      Genero: { ComAntena: 'Drama' },
      NivelMoral: { Id: '+12' },
      NumeroEpisodio: '3',
      Temporada: '2',
      Imagenes: [
        { id: 'horizontal', uri: 'https://example.com/background.jpg' },
      ],
    });
  });
}

describe('Spanish metadata providers', () => {
  it('verifies Orange EPG from another block when the first block fails', async () => {
    orangeMock();
    const original = vi.mocked(makeRequest).getMockImplementation()!;
    vi.mocked(makeRequest).mockImplementation(async (url, options) => {
      if (String(url).endsWith('_8h_1.json'))
        throw new Error('Block unavailable');
      return original(url, options);
    });
    expect(
      (await new OrangeTvAddon({ timeout: 7000 }).getManifest()).behaviorHints
        ?.epgProvider
    ).toBe(true);
  });
  it('does not advertise Orange EPG for invalid programme times', async () => {
    orangeMock([{ ...orangeProgram, startDate: 1e20, endDate: 2e20 }]);
    const addon = new OrangeTvAddon({ timeout: 1000 });
    expect(
      (await addon.getManifest()).behaviorHints?.epgProvider
    ).toBeUndefined();
    expect((await addon.getCatalogGuide(0, '2026-10-13'))[0].videos).toEqual(
      []
    );
  });

  it('honors the configured timeout and keeps the catalog when Orange EPG is unavailable', async () => {
    orangeMock();
    const original = vi.mocked(makeRequest).getMockImplementation()!;
    vi.mocked(makeRequest).mockImplementation(async (url, options) => {
      expect(options.timeout).toBe(7000);
      if (String(url).includes('/epg/')) throw new Error('Guide unavailable');
      return original(url, options);
    });
    const addon = new OrangeTvAddon({ timeout: 7000 });
    expect(
      (await addon.getManifest()).behaviorHints?.epgProvider
    ).toBeUndefined();
    expect(await addon.getCatalog()).toHaveLength(1);
  });
  it.each(['orange', 'movistar'])(
    'exposes only catalog/meta and validates real EPG: %s',
    async (provider) => {
      const addon =
        provider === 'orange'
          ? new OrangeTvAddon({ timeout: 1000 })
          : new MovistarPlusAddon({ timeout: 1000 });
      if (provider === 'orange') orangeMock();
      else movistarMock();
      const manifest = await addon.getManifest();
      expect(
        manifest.resources.map((resource) =>
          typeof resource === 'string' ? resource : resource.name
        )
      ).toEqual(['catalog', 'meta']);
      expect(manifest.behaviorHints?.epgProvider).toBe(true);
      expect(manifest.catalogs[0].extra).toEqual([
        { name: 'skip' },
        { name: 'date' },
      ]);
      expect(await addon.getCatalog(25)).toEqual([]);
    }
  );

  it.each(['orange', 'movistar'])(
    'does not advertise EPG for empty schedules: %s',
    async (provider) => {
      if (provider === 'orange') orangeMock([]);
      else movistarMock([]);
      const addon =
        provider === 'orange'
          ? new OrangeTvAddon({ timeout: 1000 })
          : new MovistarPlusAddon({ timeout: 1000 });
      expect(
        (await addon.getManifest()).behaviorHints?.epgProvider
      ).toBeUndefined();
      expect(await addon.getCatalog()).toHaveLength(1);
      expect(
        (await addon.getCatalogResponse(0, '2026-10-13')).metasDetailed?.[0]
          .behaviorHints?.hasScheduledVideos
      ).toBe(false);
    }
  );

  it.each(['orange', 'movistar'])(
    'preserves rich metadata and CNMC icons: %s',
    async (provider) => {
      if (provider === 'orange') orangeMock();
      else movistarMock();
      const addon =
        provider === 'orange'
          ? new OrangeTvAddon({ timeout: 1000 })
          : new MovistarPlusAddon({ timeout: 1000 });
      const channel = (await addon.getCatalog())[0];
      const meta = await addon.getMeta(channel.id);
      expect(meta.background).toContain('background');
      expect(meta.videos).toHaveLength(1);
      expect(meta.videos?.[0]).toMatchObject({
        title: 'Film',
        overview: 'Full synopsis',
        genres: ['Drama'],
        directors: ['Director One'],
        season: 2,
        episode: 3,
        ratings: [
          {
            value: '12',
            system: 'CNMC',
            icon: 'https://cdn.jsdelivr.net/gh/mrcanelas/age-rating-kit@latest/icons/cnmc/12.svg',
          },
        ],
        startTime: '2026-10-13T12:00:00.000Z',
        endTime: '2026-10-13T13:00:00.000Z',
      });
      expect(meta.videos?.[0].cast).toContain('Actor One');
      const calls = vi.mocked(makeRequest).mock.calls.length;
      await addon.getMeta(channel.id);
      expect(vi.mocked(makeRequest).mock.calls).toHaveLength(calls);
      await expect(addon.getMeta(encodeChannelId('unknown'))).rejects.toThrow(
        'Channel not found'
      );
    }
  );

  it.each(['orange', 'movistar'])(
    'keeps basic programme data when details fail: %s',
    async (provider) => {
      if (provider === 'orange') orangeMock([orangeProgram], true);
      else movistarMock([movistarProgram], true);
      const addon =
        provider === 'orange'
          ? new OrangeTvAddon({ timeout: 1000 })
          : new MovistarPlusAddon({ timeout: 1000 });
      const channel = (await addon.getCatalog())[0];
      expect((await addon.getMeta(channel.id)).videos?.[0]).toMatchObject({
        title: 'Film',
        overview: 'Basic synopsis',
        genres: ['Drama'],
        ratings: [{ value: '12' }],
      });
    }
  );

  it('loads Madrid dates on both sides of a UTC day and deduplicates Orange segments', async () => {
    orangeMock();
    const addon = new OrangeTvAddon({ timeout: 1000 });
    const guide = await addon.getCatalogGuide(0, '2026-10-13');
    expect(guide[0].videos).toHaveLength(1);
    const urls = vi.mocked(makeRequest).mock.calls.map(([url]) => String(url));
    expect(urls).toContain(
      'https://epg.orangetv.orange.es/epg/SmartTV_Android/1_PRO/20261013_8h_1.json'
    );
    expect(urls).toContain(
      'https://epg.orangetv.orange.es/epg/SmartTV_Android/1_PRO/20261014_8h_1.json'
    );
  });

  it('shifts programme IDs and times without changing channel identity', async () => {
    movistarMock();
    const addon = new MovistarPlusAddon({
      timeout: 1000,
      timeShiftMinutes: 30,
    });
    const channel = (await addon.getCatalog())[0];
    const video = (await addon.getMeta(channel.id)).videos?.[0];
    expect(video?.startTime).toBe('2026-10-13T12:30:00.000Z');
    expect(video?.id).toBe(`${channel.id}:epg:2026-10-13T12:30:00.000Z`);
  });
});

