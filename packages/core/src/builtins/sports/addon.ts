import { z } from 'zod';
import type { Manifest, Meta } from '../../db/index.js';
import { config } from '../../config/index.js';
import { APIError, ErrorCode, TV_TYPE } from '../../utils/constants.js';
import {
  SPORTS_CATALOG_PREFIX,
  SPORTS_EVENT_PREFIX,
} from '../../utils/identity.js';
import {
  cacheSportsCatalog,
  findCachedSportsEvent,
  getCachedSportsArtwork,
  loadSportsBroadcasters,
  loadSportsDay,
  loadSportsEvent,
  loadSportsLivescores,
  loadSportsTvArtwork,
  lookupSportsArtwork,
  SPORTS,
  SPORTS_MARKETS,
  sportsImage,
  sportsKickoff,
  type Sport,
  type SportsEvent,
} from './provider.js';

export const SPORTS_LOCALES = ['en', 'es', 'pt'] as const;
const dayMs = 86_400_000;

export const SportsConfigSchema = z.object({
  theSportsDbApiKey: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,128}$/, 'Enter a valid TheSportsDB API key'),
  locale: z.enum(SPORTS_LOCALES).default('en'),
  market: z
    .string()
    .toUpperCase()
    .refine((value) => SPORTS_MARKETS.some((market) => market.value === value)),
  timeZone: z
    .string()
    .trim()
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return !/^[+-]/.test(value);
      } catch {
        return false;
      }
    }, 'Use an IANA time zone such as Europe/Madrid')
    .default('UTC'),
});

const translations = {
  en: {
    title: 'Sports',
    football: 'Football',
    basketball: 'Basketball',
    watch: 'Where to watch',
    unknown: 'No broadcast information for this country',
    unavailable: 'Broadcast information is temporarily unavailable',
    live: 'Live',
    scheduled: 'Scheduled',
    finished: 'Finished',
    postponed: 'Postponed',
    cancelled: 'Cancelled',
    unknownTime: 'Time to be confirmed',
  },
  es: {
    title: 'Deportes',
    football: 'Fútbol',
    basketball: 'Baloncesto',
    watch: 'Dónde ver',
    unknown: 'Sin información de transmisión para este país',
    unavailable:
      'La información de transmisión no está disponible temporalmente',
    live: 'En directo',
    scheduled: 'Programado',
    finished: 'Finalizado',
    postponed: 'Aplazado',
    cancelled: 'Cancelado',
    unknownTime: 'Horario por confirmar',
  },
  pt: {
    title: 'Esportes',
    football: 'Futebol',
    basketball: 'Basquete',
    watch: 'Onde assistir',
    unknown: 'Sem informação de transmissão para este país',
    unavailable: 'Informação de transmissão temporariamente indisponível',
    live: 'Ao vivo',
    scheduled: 'Agendado',
    finished: 'Encerrado',
    postponed: 'Adiado',
    cancelled: 'Cancelado',
    unknownTime: 'Horário a confirmar',
  },
} as const;

export function sportsEventState(event: SportsEvent, now = Date.now()) {
  const state = event.strStatus?.trim().toUpperCase();
  if (/^(PST|POST|POSTPONED)$/.test(state ?? '')) return 'postponed';
  if (/^(CANC|ABD|AWD|WO|CANCELLED|CANCELED|ABANDONED)$/.test(state ?? ''))
    return 'cancelled';
  if (
    /^(FT|AET|AP|PEN|AOT|FINAL|FINISHED|MATCH FINISHED|AFTER PENALTIES|AFTER EXTRA TIME)$/.test(
      state ?? ''
    )
  )
    return 'finished';
  if (
    /^(1H|2H|HT|ET|BT|P|LIVE|IN PLAY|IN PROGRESS|Q[1-4]|OT|HALF TIME)$/.test(
      state ?? ''
    )
  ) {
    const elapsed = now - sportsKickoff(event);
    // shortcut: reject stale live flags after five hours until the feed supplies end times.
    if (elapsed >= 0 && elapsed < 5 * 60 * 60 * 1_000) return 'live';
  }
  return 'scheduled';
}

function sportForCatalog(id: string): Sport | undefined {
  return (Object.keys(SPORTS) as Sport[]).find(
    (sport) => id === `${SPORTS_CATALOG_PREFIX}${sport}`
  );
}

export class SportsAddon {
  private readonly settings;
  private readonly copy;
  private readonly localDay;
  private readonly localTime;

  constructor(settings: z.input<typeof SportsConfigSchema>) {
    this.settings = SportsConfigSchema.parse(settings);
    this.copy = translations[this.settings.locale];
    const { locale, timeZone } = this.settings;
    this.localDay = new Intl.DateTimeFormat('en-CA', {
      dateStyle: 'short',
      timeZone,
    });
    this.localTime = new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    });
  }

  private async getEvents(sport: Sport) {
    const now = Date.now();
    const firstDay = this.localDay.format(now);
    const afterLastDay = new Date(Date.parse(firstDay) + 4 * dayMs)
      .toISOString()
      .slice(0, 10);
    const midnight = Date.parse(firstDay);
    const days = Array.from({ length: 6 }, (_, index) =>
      new Date(midnight + (index - 1) * dayMs).toISOString().slice(0, 10)
    );
    const { theSportsDbApiKey, timeZone } = this.settings;
    const [results, scores] = await Promise.all([
      Promise.allSettled(
        days.map((date) => loadSportsDay(theSportsDbApiKey, sport, date))
      ),
      loadSportsLivescores(theSportsDbApiKey, sport).catch(() => []),
    ]);
    const unauthorized = results.find(
      (result) =>
        result.status === 'rejected' &&
        result.reason instanceof APIError &&
        result.reason.code === ErrorCode.UNAUTHORIZED
    );
    if (unauthorized?.status === 'rejected') throw unauthorized.reason;
    const events = new Map<string, SportsEvent>();
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      for (const event of result.value) {
        const kickoff = sportsKickoff(event);
        const day = Number.isFinite(kickoff)
          ? this.localDay.format(kickoff)
          : event.dateEvent;
        if (
          (day && day >= firstDay && day < afterLastDay) ||
          sportsEventState(event, now) === 'live'
        )
          events.set(event.idEvent, event);
      }
    }
    for (const score of scores) {
      const event = events.get(score.idEvent);
      if (event)
        events.set(event.idEvent, {
          ...event,
          strStatus: score.strStatus?.trim() || event.strStatus,
          strHomeTeamBadge: event.strHomeTeamBadge || score.strHomeTeamBadge,
          strAwayTeamBadge: event.strAwayTeamBadge || score.strAwayTeamBadge,
        });
      else if (sportsEventState(score, now) === 'live')
        events.set(score.idEvent, score);
    }
    if (!events.size && results.every((result) => result.status === 'rejected'))
      throw new Error('TheSportsDB schedule is unavailable');
    const schedule = [...events.values()].sort((a, b) => {
      const aLive = sportsEventState(a, now) === 'live';
      const bLive = sportsEventState(b, now) === 'live';
      if (aLive !== bLive) return aLive ? -1 : 1;
      return (sportsKickoff(a) || Infinity) - (sportsKickoff(b) || Infinity);
    });
    await cacheSportsCatalog(theSportsDbApiKey, sport, timeZone, schedule);
    return schedule;
  }

  async getManifest(): Promise<Manifest> {
    const catalogs = await Promise.all(
      (Object.keys(SPORTS) as Sport[]).map(async (sport) => {
        const events = await this.getEvents(sport).catch((error) => {
          if (
            error instanceof APIError &&
            error.code === ErrorCode.UNAUTHORIZED
          )
            throw error;
          return [];
        });
        const leagues = [
          ...new Set(events.map((event) => event.strLeague)),
        ].sort(new Intl.Collator(this.settings.locale).compare);
        return {
          id: `${SPORTS_CATALOG_PREFIX}${sport}`,
          type: TV_TYPE,
          name: this.copy[sport],
          extra: [{ name: 'skip' }, { name: 'genre', options: leagues }],
        };
      })
    );
    return {
      id: 'org.aiolivetv.sports',
      name: this.copy.title,
      version: '1.0.0',
      description: `${this.copy.title} · TheSportsDB`,
      types: [TV_TYPE],
      resources: [
        'catalog',
        { name: 'meta', types: [TV_TYPE], idPrefixes: [SPORTS_EVENT_PREFIX] },
      ],
      catalogs,
    };
  }

  async getCatalog(id: string, skip: number, league?: string) {
    const sport = sportForCatalog(id);
    if (!sport) return [];
    const { theSportsDbApiKey, market } = this.settings;
    const page = (await this.getEvents(sport))
      .filter((event) => !league || event.strLeague === league)
      .slice(skip, skip + 100);
    const now = Date.now();
    const entries = await Promise.all(
      page.map(async (event) => ({
        event,
        artwork:
          sportsImage(event.strThumb, event.strFanart) ??
          (await getCachedSportsArtwork(theSportsDbApiKey, event.idEvent)),
      }))
    );
    const dates = new Set(
      entries
        .filter(
          ({ event, artwork }) =>
            !artwork && sportsEventState(event, now) === 'live'
        )
        .map(({ event }) =>
          new Date(sportsKickoff(event)).toISOString().slice(0, 10)
        )
    );
    const listings = await Promise.all(
      [...dates].map((date) =>
        loadSportsTvArtwork(theSportsDbApiKey, sport, date, market).catch(
          () => []
        )
      )
    );
    const artworkByEvent = new Map<
      string,
      { thumbnail?: string; logo?: string }
    >();
    for (const row of listings.flat()) {
      const previous = artworkByEvent.get(row.idEvent);
      artworkByEvent.set(row.idEvent, {
        thumbnail: previous?.thumbnail ?? sportsImage(row.strEventThumb),
        logo: previous?.logo ?? sportsImage(row.strLogo),
      });
    }
    return Promise.all(
      entries.map(async ({ event, artwork }) => {
        const broadcast = artworkByEvent.get(event.idEvent);
        const thumbnail =
          artwork ??
          broadcast?.thumbnail ??
          (artwork === undefined
            ? await lookupSportsArtwork(theSportsDbApiKey, event.idEvent)
            : undefined);
        return this.toMeta(event, thumbnail ?? undefined, broadcast?.logo);
      })
    );
  }

  private toMeta(
    event: SportsEvent,
    artwork?: string,
    channelLogo?: string
  ): Meta {
    const kickoff = sportsKickoff(event);
    const now = Date.now();
    const state = sportsEventState(event, now);
    const marker =
      state === 'live'
        ? '🔴 '
        : state === 'scheduled' && kickoff > now
          ? '🕒 '
          : '';
    const id = `${SPORTS_EVENT_PREFIX}${event.idEvent}`;
    const poster =
      sportsImage(
        event.strThumb,
        event.strFanart,
        artwork,
        event.strHomeTeamBadge,
        event.strAwayTeamBadge,
        channelLogo
      ) ??
      new URL(
        '/logo.png',
        config.bootstrap.baseUrl || config.bootstrap.internalUrl
      ).toString();
    return {
      id,
      type: TV_TYPE,
      name: `${marker}${event.strEvent}`,
      genres: [event.strLeague],
      posterShape: 'landscape',
      poster,
      background: poster,
      description: [
        event.strLeague,
        Number.isFinite(kickoff)
          ? `${this.localTime.format(kickoff)} (${this.settings.timeZone})`
          : this.copy.unknownTime,
        this.copy[state],
      ].join('\n'),
      behaviorHints: { defaultVideoId: id },
    };
  }

  async getMeta(id: string) {
    if (!id.startsWith(SPORTS_EVENT_PREFIX)) return undefined;
    const eventId = id.slice(SPORTS_EVENT_PREFIX.length);
    if (!/^\d+$/.test(eventId)) return undefined;
    const { theSportsDbApiKey, timeZone, market } = this.settings;
    let lookupError: unknown;
    let event =
      (await loadSportsEvent(theSportsDbApiKey, eventId).catch((error) => {
        if (error instanceof APIError && error.code === ErrorCode.UNAUTHORIZED)
          throw error;
        lookupError = error;
      })) ??
      (await findCachedSportsEvent(theSportsDbApiKey, timeZone, eventId));
    if (!event && lookupError) {
      const schedules = await Promise.allSettled(
        (Object.keys(SPORTS) as Sport[]).map((sport) => this.getEvents(sport))
      );
      event = schedules
        .flatMap((result) =>
          result.status === 'fulfilled' ? result.value : []
        )
        .find((candidate) => candidate.idEvent === eventId);
      if (!event) throw lookupError;
    }
    if (!event) return undefined;
    const broadcasters = await loadSportsBroadcasters(
      theSportsDbApiKey,
      eventId,
      market
    ).catch(() => null);
    const meta = this.toMeta(event);
    const country = new Intl.DisplayNames(this.settings.locale, {
      type: 'region',
    }).of(market);
    const options =
      broadcasters === null
        ? this.copy.unavailable
        : broadcasters.join(', ') || this.copy.unknown;
    meta.description += `\n\n${this.copy.watch} (${country}): ${options}\nTheSportsDB`;
    meta.videos = [
      {
        id: meta.id,
        title: meta.name,
        thumbnail: meta.poster,
        background: meta.poster,
      },
    ];
    return meta;
  }
}
