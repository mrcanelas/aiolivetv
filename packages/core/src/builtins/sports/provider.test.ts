import { expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.BASE_URL = 'http://127.0.0.1';
});

vi.mock('../../config/index.js', () => ({
  config: {
    bootstrap: { baseUrl: 'https://addon.example' },
  },
}));
vi.mock('../../utils/cache.js', () => ({
  Cache: {
    getInstance: () => ({
      wrap: (load: () => unknown) => load(),
      get: vi.fn(),
      set: vi.fn(),
    }),
  },
}));
vi.mock('../../utils/http.js', () => ({ makeRequest: vi.fn() }));

const { makeRequest } = await import('../../utils/http.js');
const { SportsAddon } = await import('./addon.js');
const { selectSportsChannels, sportsTitlesMatch } =
  await import('./playback.js');
const { loadSportsBroadcasters, loadSportsDay, sportsKickoff } =
  await import('./provider.js');

function respond(payload: unknown) {
  vi.mocked(makeRequest).mockImplementation(
    async () =>
      new Response(JSON.stringify(payload)) as Awaited<
        ReturnType<typeof makeRequest>
      >
  );
}

it('uses the global sport schedule and reads unqualified kickoff timestamps as UTC', async () => {
  respond({
    events: [
      {
        idEvent: '1',
        strSport: 'Soccer',
        strEvent: 'Club A vs Club B',
        strLeague: 'Test League',
        strTimestamp: '2026-11-07T00:30:00',
      },
      {
        idEvent: '2',
        strSport: 'Basketball',
        strEvent: 'Club C vs Club D',
        strLeague: 'Test League',
      },
    ],
  });
  const events = await loadSportsDay('test', 'football', '2026-11-07');
  expect(events.map((event) => event.idEvent)).toEqual(['1']);
  expect(sportsKickoff(events[0])).toBe(Date.UTC(2026, 10, 7, 0, 30));
  expect(vi.mocked(makeRequest).mock.lastCall?.[0]).toContain(
    '/test/eventsday.php?d=2026-11-07&s=Soccer'
  );
});

it('shares concurrent schedule requests for the same key and date', async () => {
  respond({ events: [] });
  vi.mocked(makeRequest).mockClear();
  await Promise.all([
    loadSportsDay('same-key', 'football', '2026-11-08'),
    loadSportsDay('same-key', 'football', '2026-11-08'),
    loadSportsDay('other-key', 'football', '2026-11-08'),
  ]);
  expect(makeRequest).toHaveBeenCalledTimes(2);
});

it('uses the broadcast territory rather than the event country and preserves channel numbers', async () => {
  respond({
    tvevent: [
      {
        idEvent: '1',
        strChannel: 'ESPN 2',
        strCountry: 'United States',
        strEventCountry: 'Spain',
      },
      { idEvent: '1', strChannel: 'ESPN 3', strCountry: 'United States' },
      { idEvent: '1', strChannel: 'BBC One', strCountry: 'United Kingdom' },
      { idEvent: '2', strChannel: 'BBC Two', strCountry: 'United Kingdom' },
    ],
  });
  await expect(loadSportsBroadcasters('test', '1', 'US')).resolves.toEqual([
    'ESPN 2',
    'ESPN 3',
  ]);
  await expect(loadSportsBroadcasters('test', '1', 'GB')).resolves.toEqual([
    'BBC One',
  ]);
  await expect(loadSportsBroadcasters('test', '1', 'ES')).resolves.toEqual([]);
});

it('keeps match IDs stable across languages, markets and local calendar days', async () => {
  const clock = vi
    .spyOn(Date, 'now')
    .mockReturnValue(Date.parse('2026-11-07T12:00:00Z'));
  const event = {
    idEvent: '1',
    strSport: 'Soccer',
    strEvent: 'Club A vs Club B',
    strLeague: 'International Cup',
    strTimestamp: '2026-11-08T00:30:00Z',
    strStatus: '1H',
  };
  vi.mocked(makeRequest).mockImplementation(async (rawUrl) => {
    const url = new URL(rawUrl);
    const payload = url.pathname.endsWith('/lookuptv.php')
      ? {
          tvevent: [
            { idEvent: '1', strChannel: 'ESPN 2', strCountry: 'United States' },
            {
              idEvent: '1',
              strChannel: 'BBC One',
              strCountry: 'United Kingdom',
            },
          ],
        }
      : {
          events:
            url.pathname.endsWith('/lookupevent.php') ||
            url.searchParams.get('d') === '2026-11-08'
              ? [event]
              : null,
        };
    return new Response(JSON.stringify(payload)) as Awaited<
      ReturnType<typeof makeRequest>
    >;
  });
  try {
    const us = new SportsAddon({
      theSportsDbApiKey: 'test',
      locale: 'es',
      market: 'US',
      timeZone: 'America/New_York',
    });
    const gb = new SportsAddon({
      theSportsDbApiKey: 'test',
      locale: 'pt',
      market: 'GB',
      timeZone: 'Europe/London',
    });
    const manifest = await us.getManifest();
    expect(manifest.behaviorHints?.epgProvider).toBeUndefined();
    const [football, basketball] = manifest.catalogs;
    expect(football).toMatchObject({
      name: 'Fútbol',
      extra: [
        { name: 'skip' },
        { name: 'genre', options: ['International Cup'] },
      ],
    });
    expect(basketball.name).toBe('Baloncesto');
    const [preview] = await us.getCatalog(football.id, 0, 'International Cup');
    await expect(
      us.getCatalog(football.id, 0, 'Another league')
    ).resolves.toEqual([]);
    expect(preview.description).toContain('7 nov');
    expect(preview.name).toBe(`🕒 ${event.strEvent}`);
    const usMeta = await us.getMeta(preview.id);
    const gbMeta = await gb.getMeta(preview.id);
    expect(usMeta?.description).toContain('Dónde ver (Estados Unidos): ESPN 2');
    expect(gbMeta?.description).toContain(
      'Onde assistir (Reino Unido): BBC One'
    );
    expect(gbMeta?.description).toContain('8 de nov');
    expect(gbMeta?.id).toBe(usMeta?.id);
  } finally {
    clock.mockRestore();
  }
});

it('uses EPG to disambiguate a network while respecting country and channel numbers', async () => {
  const channels = [
    { id: 'us-1', type: 'tv', name: 'ESPN 1', country: 'US' },
    { id: 'us-2', type: 'tv', name: 'ESPN 2 HD', country: 'United States' },
    { id: 'ar-2', type: 'tv', name: 'ESPN 2', country: 'Argentina' },
  ];
  const noProgramme = async () => false;
  await expect(
    selectSportsChannels(channels, ['ESPN 2'], 'US', noProgramme)
  ).resolves.toEqual(['us-2']);
  await expect(
    selectSportsChannels(channels, ['ESPN'], 'US', noProgramme)
  ).resolves.toEqual([]);
  await expect(
    selectSportsChannels(channels, ['ESPN'], 'US', async ({ id }) =>
      sportsTitlesMatch(
        'Atlético vs Club B',
        id === 'us-2' ? 'Atletico x Club B' : 'Atletico x Club C'
      )
    )
  ).resolves.toEqual(['us-2']);
});
