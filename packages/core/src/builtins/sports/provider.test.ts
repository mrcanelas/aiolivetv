import { expect, it, vi } from 'vitest';

vi.mock('../../config/index.js', () => ({
  config: { metadata: { theSportsDb: { apiKey: 'test' } } },
}));
vi.mock('../../utils/cache.js', () => ({
  Cache: { getInstance: () => ({ wrap: (load: () => unknown) => load() }) },
}));
vi.mock('../../utils/http.js', () => ({ makeRequest: vi.fn() }));

const { makeRequest } = await import('../../utils/http.js');
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
  const events = await loadSportsDay('football', '2026-11-07');
  expect(events.map((event) => event.idEvent)).toEqual(['1']);
  expect(sportsKickoff(events[0])).toBe(Date.UTC(2026, 10, 7, 0, 30));
  expect(vi.mocked(makeRequest).mock.lastCall?.[0]).toContain(
    'eventsday.php?d=2026-11-07&s=Soccer'
  );
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
  await expect(loadSportsBroadcasters('1', 'US')).resolves.toEqual([
    'ESPN 2',
    'ESPN 3',
  ]);
  await expect(loadSportsBroadcasters('1', 'GB')).resolves.toEqual(['BBC One']);
  await expect(loadSportsBroadcasters('1', 'ES')).resolves.toEqual([]);
});
