import { z } from 'zod';
import { config } from '../../config/index.js';
import { Cache } from '../../utils/cache.js';
import { makeRequest } from '../../utils/http.js';
import { normalizeChannelName } from '../../utils/channelName.js';
import { IPTV_ORG_COUNTRIES } from '../iptv/config.js';

export const SPORTS = { football: 'Soccer', basketball: 'Basketball' } as const;
export type Sport = keyof typeof SPORTS;

export const SPORTS_MARKETS = IPTV_ORG_COUNTRIES.map(({ code, name }) => ({
  value: code === 'uk' ? 'GB' : code.toUpperCase(),
  label: name,
}));

const englishRegions = new Intl.DisplayNames('en', { type: 'region' });

export function isSportsMarket(
  value: string | null | undefined,
  market: string
) {
  if (!value) return false;
  const normalized = normalizeChannelName(value);
  return [
    market,
    englishRegions.of(market),
    SPORTS_MARKETS.find(({ value }) => value === market)?.label,
    ...(market === 'GB'
      ? ['UK', 'England', 'Scotland', 'Wales', 'Northern Ireland']
      : []),
    ...(market === 'US' ? ['USA'] : []),
  ].some((name) => name && normalizeChannelName(name) === normalized);
}

const EventSchema = z.object({
  idEvent: z.string().regex(/^\d+$/),
  strEvent: z.string().trim().min(1),
  strSport: z.string(),
  strLeague: z.string().trim().min(1),
  strTimestamp: z.string().nullish(),
  dateEvent: z.string().nullish(),
  strTime: z.string().nullish(),
  strStatus: z.string().nullish(),
});

const BroadcastSchema = z.object({
  idEvent: z.string(),
  strChannel: z.string().trim().min(1),
  strCountry: z.string().nullish(),
});

export type SportsEvent = z.infer<typeof EventSchema>;

const cache = Cache.getInstance<string, { rows: unknown[] }>(
  'sports-data',
  512
);

async function request(
  endpoint: 'eventsday' | 'lookupevent' | 'lookuptv',
  query: Record<string, string>
) {
  const apiKey = config.metadata.theSportsDb.apiKey?.trim();
  if (!apiKey) throw new Error('TheSportsDB API key is missing');
  const params = new URLSearchParams(query);
  const key = `${endpoint}?${params}`;
  const { rows } = await cache.wrap(
    async () => {
      try {
        const response = await makeRequest(
          `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(apiKey)}/${endpoint}.php?${params}`,
          {
            timeout: 4_000,
            ignoreRecursion: true,
            rawOptions: { redirect: 'error' },
          }
        );
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        const field = endpoint === 'lookuptv' ? 'tvevent' : 'events';
        const result = z
          .object({ [field]: z.array(z.unknown()).nullable() })
          .parse(payload);
        return { rows: result[field] ?? [] };
      } catch {
        // The v1 URL contains the key. Keep upstream errors out of addon responses.
        throw new Error(`TheSportsDB ${endpoint} request failed`);
      }
    },
    key,
    endpoint === 'eventsday' ? 300 : 60
  );
  return rows;
}

function parseRows<T>(rows: unknown[], schema: z.ZodType<T>): T[] {
  return rows.flatMap((row) => {
    const parsed = schema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

export async function loadSportsDay(sport: Sport, date: string) {
  return parseRows(
    await request('eventsday', { d: date, s: SPORTS[sport] }),
    EventSchema
  ).filter((event) => event.strSport === SPORTS[sport]);
}

export async function loadSportsEvent(id: string) {
  return parseRows(await request('lookupevent', { id }), EventSchema).find(
    (event) =>
      event.idEvent === id &&
      Object.values(SPORTS).some((sport) => sport === event.strSport)
  );
}

export async function loadSportsBroadcasters(id: string, market: string) {
  return [
    ...new Set(
      parseRows(await request('lookuptv', { id }), BroadcastSchema)
        .filter(
          (row) => row.idEvent === id && isSportsMarket(row.strCountry, market)
        )
        .map((row) => row.strChannel)
    ),
  ];
}

export function sportsKickoff(event: SportsEvent): number {
  const timestamp =
    event.strTimestamp ||
    (event.dateEvent && event.strTime && `${event.dateEvent}T${event.strTime}`);
  if (!timestamp || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(timestamp))
    return NaN;
  return Date.parse(
    /(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp) ? timestamp : `${timestamp}Z`
  );
}
