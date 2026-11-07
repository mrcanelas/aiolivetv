import { z } from 'zod';
import { Cache } from '../../utils/cache.js';
import { getSimpleTextHash } from '../../utils/crypto.js';
import { APIError, ErrorCode } from '../../utils/constants.js';
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
  strThumb: z.string().nullish(),
  strFanart: z.string().nullish(),
  strHomeTeamBadge: z.string().nullish(),
  strAwayTeamBadge: z.string().nullish(),
});

const LivescoreSchema = EventSchema.omit({ strEvent: true })
  .extend({
    strHomeTeam: z.string().trim().min(1),
    strAwayTeam: z.string().trim().min(1),
    strEventTime: z.string().nullish(),
  })
  .transform(({ strHomeTeam, strAwayTeam, strEventTime, ...event }) => ({
    ...event,
    strEvent: `${strHomeTeam} vs ${strAwayTeam}`,
    strTime: event.strTime ?? strEventTime,
  }));

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
  apiKey: string,
  endpoint: 'eventsday' | 'livescore' | 'lookupevent' | 'lookuptv',
  query: Record<string, string>
) {
  const params = new URLSearchParams(query);
  const key = `${getSimpleTextHash(apiKey)}:${endpoint}?${params}`;
  const { rows } = await cache.wrap(
    async () => {
      // The v1 URL contains the key. Keep upstream errors out of addon responses.
      const failed = () => {
        throw new Error(`TheSportsDB ${endpoint} request failed`);
      };
      const response = await makeRequest(
        `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(apiKey)}/${endpoint}.php?${params}`,
        {
          timeout: 4_000,
          ignoreRecursion: true,
          rawOptions: { redirect: 'error' },
        }
      ).catch(failed);
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        if (response.status === 400 || response.status === 401) {
          throw new APIError(
            ErrorCode.UNAUTHORIZED,
            401,
            'TheSportsDB rejected the API key'
          );
        }
        return failed();
      }
      const payload = await response.json().catch(failed);
      const field =
        endpoint === 'lookuptv'
          ? 'tvevent'
          : endpoint === 'livescore'
            ? 'livescore'
            : 'events';
      const result = z
        .object({ [field]: z.array(z.unknown()).nullable() })
        .safeParse(payload);
      return result.success ? { rows: result.data[field] ?? [] } : failed();
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

export async function loadSportsDay(
  apiKey: string,
  sport: Sport,
  date: string
) {
  return parseRows(
    await request(apiKey, 'eventsday', { d: date, s: SPORTS[sport] }),
    EventSchema
  ).filter((event) => event.strSport === SPORTS[sport]);
}

export async function loadSportsLivescores(apiKey: string, sport: Sport) {
  return parseRows(
    await request(apiKey, 'livescore', { s: SPORTS[sport] }),
    LivescoreSchema
  ).filter((event) => event.strSport === SPORTS[sport]);
}

export async function loadSportsEvent(apiKey: string, id: string) {
  return parseRows(
    await request(apiKey, 'lookupevent', { id }),
    EventSchema
  ).find(
    (event) =>
      event.idEvent === id &&
      Object.values(SPORTS).some((sport) => sport === event.strSport)
  );
}

function catalogKey(apiKey: string, sport: Sport, timeZone: string) {
  return `${getSimpleTextHash(apiKey)}:catalog:${sport}:${timeZone}`;
}

export async function cacheSportsCatalog(
  apiKey: string,
  sport: Sport,
  timeZone: string,
  events: SportsEvent[]
) {
  if (events.length)
    await cache.set(
      catalogKey(apiKey, sport, timeZone),
      { rows: events },
      3600
    );
}

export async function findCachedSportsEvent(
  apiKey: string,
  timeZone: string,
  id: string
) {
  const catalogs = await Promise.all(
    (Object.keys(SPORTS) as Sport[]).map((sport) =>
      cache.get(catalogKey(apiKey, sport, timeZone))
    )
  );
  return catalogs
    .flatMap((catalog) => parseRows(catalog?.rows ?? [], EventSchema))
    .find((event) => event.idEvent === id);
}

export async function loadSportsBroadcasters(
  apiKey: string,
  id: string,
  market: string
) {
  return [
    ...new Set(
      parseRows(await request(apiKey, 'lookuptv', { id }), BroadcastSchema)
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
