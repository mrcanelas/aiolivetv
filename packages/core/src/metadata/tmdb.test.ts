import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Meta, UserData } from '../db/index.js';

const fixture = vi.hoisted(() => {
  process.env.BASE_URL = 'http://127.0.0.1:3000';
  return {
    request: vi.fn(),
    cache: new Map<string, unknown>(),
    tmdb: {} as { apiKey?: string; accessToken?: string },
  };
});

vi.mock('../utils/index.js', async () => ({
  appConfig: { metadata: { tmdb: fixture.tmdb } },
  Cache: {
    getInstance: (name: string) => ({
      get: async (key: string) => fixture.cache.get(`${name}:${key}`),
      set: async (key: string, value: unknown) => {
        fixture.cache.set(`${name}:${key}`, value);
      },
    }),
  },
  makeRequest: fixture.request,
  createLogger: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  withTimeout: (await import('../utils/general.js')).withTimeout,
}));

import { TMDBMetadata, enrichEpgVideos } from './tmdb.js';
import { parseXmltvData } from '../builtins/xmltv-reader/parser.js';

const config = {
  enrichEpgWithTmdb: true,
  tmdbApiKey: 'test-key',
  epgMetadataLanguage: 'pt-BR',
} as UserData;
function movie(overrides: Partial<NonNullable<Meta['videos']>[number]> = {}) {
  return {
    id: 'channel:epg:2026-10-21T12:00:00Z',
    title: 'The Matrix',
    productionYear: 1999,
    mediaType: 'movie',
    startTime: '2026-10-21T12:00:00Z',
    endTime: '2026-10-21T14:30:00Z',
    runtime: '150 min',
    ...overrides,
  };
}
const details = {
  id: 603,
  title: 'Matrix',
  original_title: 'The Matrix',
  release_date: '1999-03-30',
  overview: 'TMDB plot',
  poster_path: '/poster.jpg',
  backdrop_path: '/background.jpg',
  genres: [{ name: 'Science Fiction' }],
  credits: {
    cast: [{ name: 'Keanu Reeves' }],
    crew: [{ name: 'Lana Wachowski', job: 'Director' }],
  },
};
function respond(body: unknown) {
  return { ok: true, json: async () => body };
}

beforeEach(() => {
  fixture.request.mockReset();
  fixture.cache.clear();
  delete fixture.tmdb.apiKey;
  delete fixture.tmdb.accessToken;
});

describe('optional EPG metadata enrichment', () => {
  it.each([
    [
      { tmdbAccessToken: 'personal-token', tmdbApiKey: undefined },
      undefined,
      'Bearer personal-token',
    ],
    [{ tmdbApiKey: 'personal-key' }, 'personal-key', null],
    [{ tmdbApiKey: undefined }, 'instance-key', null],
  ])(
    'prefers personal credentials over instance defaults: %j',
    async (auth, apiKey, authorization) => {
      fixture.tmdb.apiKey = 'instance-key';
      fixture.tmdb.accessToken = 'instance-token';
      fixture.request
        .mockResolvedValueOnce(respond({ results: [details] }))
        .mockResolvedValueOnce(respond(details));
      await enrichEpgVideos([movie()], { ...config, ...auth });
      const [url, options] = fixture.request.mock.calls[0];
      expect(new URL(url).searchParams.get('api_key')).toBe(apiKey ?? null);
      expect(options.headers.get('Authorization')).toBe(authorization);
    }
  );

  it('fills missing fields without changing broadcast data, stream identity or provider metadata', async () => {
    fixture.request
      .mockResolvedValueOnce(respond({ results: [details] }))
      .mockResolvedValueOnce(respond(details));
    const source = movie({
      thumbnail: 'https://provider/art.jpg',
      cast: ['Provider cast'],
    });
    const [result] = await enrichEpgVideos([source], config);
    expect(result).toMatchObject({
      ...source,
      overview: 'TMDB plot',
      thumbnail: 'https://provider/art.jpg',
      cast: ['Provider cast'],
      directors: ['Lana Wachowski'],
      background: 'https://image.tmdb.org/t/p/original/background.jpg',
    });
    expect(source).not.toHaveProperty('overview');
    expect(fixture.request.mock.calls[0][0]).toContain('language=pt-BR');
    expect(await enrichEpgVideos([source], config)).toEqual([result]);
    expect(fixture.request).toHaveBeenCalledTimes(2);
  });

  it('rejects ambiguous and wrong-year results and caches a real miss', async () => {
    fixture.request.mockResolvedValueOnce(
      respond({ results: [details, { ...details, id: 999 }] })
    );
    const source = movie();
    expect(await enrichEpgVideos([source], config)).toEqual([source]);
    expect(await enrichEpgVideos([source], config)).toEqual([source]);
    expect(fixture.request).toHaveBeenCalledTimes(1);
    fixture.request.mockResolvedValueOnce(
      respond({ results: [{ ...details, release_date: '2020-01-01' }] })
    );
    expect(
      await enrichEpgVideos([movie({ productionYear: 2000 })], config)
    ).toEqual([movie({ productionYear: 2000 })]);
  });

  it('never uses the broadcast year as the movie production year or searches ordinary news', async () => {
    const unknownYear = movie({
      productionYear: undefined,
      releaseInfo: '2026',
    });
    const news = movie({
      title: 'News',
      mediaType: undefined,
      productionYear: undefined,
    });
    expect(await enrichEpgVideos([unknownYear, news], config)).toEqual([
      unknownYear,
      news,
    ]);
    expect(fixture.request).not.toHaveBeenCalled();
  });

  it('performs no requests when disabled, without credentials or without a schedule', async () => {
    await enrichEpgVideos([movie()], { ...config, enrichEpgWithTmdb: false });
    await enrichEpgVideos([movie()], { ...config, tmdbApiKey: undefined });
    await enrichEpgVideos([movie({ startTime: undefined })], config);
    expect(fixture.request).not.toHaveBeenCalled();
  });

  it('does not cache authentication or upstream failures as missing metadata', async () => {
    fixture.request.mockResolvedValueOnce({ ok: false, status: 429 });
    const source = movie();
    expect(await enrichEpgVideos([source], config)).toEqual([source]);
    fixture.request
      .mockResolvedValueOnce(respond({ results: [details] }))
      .mockResolvedValueOnce(respond(details));
    expect((await enrichEpgVideos([source], config))[0]).toHaveProperty(
      'overview',
      'TMDB plot'
    );
    expect(fixture.request).toHaveBeenCalledTimes(3);
  });

  it('prefers explicit ids and refuses a conflicting title', async () => {
    fixture.request.mockResolvedValueOnce(respond(details));
    const client = new TMDBMetadata({ apiKey: 'test-key' });
    expect(
      await client.getEpgMetadata({
        title: 'Wrong movie',
        tmdbId: 603,
        mediaType: 'movie',
        language: 'en-US',
      })
    ).toBeNull();
    expect(fixture.request.mock.calls[0][0]).toContain('/movie/603?');
    expect(fixture.request).toHaveBeenCalledTimes(1);
  });

  it('enriches an identified episode with episode-specific text and artwork', async () => {
    fixture.request
      .mockResolvedValueOnce(
        respond({
          id: 1,
          name: 'A Series',
          original_name: 'A Series',
          overview: 'Series plot',
        })
      )
      .mockResolvedValueOnce(
        respond({
          id: 2,
          season_number: 1,
          episode_number: 2,
          name: 'The episode',
          overview: 'Episode plot',
          still_path: '/episode.jpg',
        })
      );
    const [result] = await enrichEpgVideos(
      [
        movie({
          title: 'A Series',
          mediaType: 'tv',
          tmdbId: 1,
          productionYear: undefined,
          season: 1,
          episode: 2,
        }),
      ],
      config
    );
    expect(result).toMatchObject({
      subtitle: 'The episode',
      overview: 'Episode plot',
      thumbnail: 'https://image.tmdb.org/t/p/w300/episode.jpg',
      runtime: '150 min',
    });
  });

  it('enriches IPTV-EPG onscreen episodes with missing genres and cast', async () => {
    const data = await parseXmltvData(
      '<tv><programme channel="AXN.br" start="20261021120000 +0000" stop="20261021130000 +0000"><title>Criminal Minds</title><episode-num>S10 E16</episode-num></programme></tv>'
    );
    fixture.request
      .mockResolvedValueOnce(
        respond({ results: [{ id: 4057, name: 'Criminal Minds' }] })
      )
      .mockResolvedValueOnce(
        respond({
          id: 4057,
          name: 'Criminal Minds',
          genres: [{ name: 'Crime' }],
          credits: { cast: [{ name: 'Joe Mantegna' }] },
        })
      )
      .mockResolvedValueOnce(
        respond({ season_number: 10, episode_number: 16 })
      );
    const [result] = await enrichEpgVideos(
      [
        {
          ...data.programs[0],
          id: 'axn:epg:test',
          genres: [],
        },
      ],
      config
    );
    expect(result).toMatchObject({
      season: 10,
      episode: 16,
      genres: ['Crime'],
      cast: ['Joe Mantegna'],
    });
    expect(fixture.request.mock.calls[0][0]).toContain('/search/tv?');
  });

  it('coalesces concurrent requests for the same programme', async () => {
    fixture.request
      .mockResolvedValueOnce(respond({ results: [details] }))
      .mockResolvedValueOnce(respond(details));
    await Promise.all([
      enrichEpgVideos([movie()], config),
      enrichEpgVideos([movie()], config),
    ]);
    expect(fixture.request).toHaveBeenCalledTimes(2);
  });

  it('returns the guide within the enrichment budget even if TMDB stalls', async () => {
    vi.useFakeTimers();
    let finish: ((value: unknown) => void) | undefined;
    fixture.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    try {
      const source = movie();
      const pending = enrichEpgVideos([source], config);
      await vi.advanceTimersByTimeAsync(1501);
      expect(await pending).toEqual([source]);
    } finally {
      finish?.(respond({ results: [] }));
      await vi.advanceTimersByTimeAsync(0);
      vi.useRealTimers();
    }
  });

  it('bounds upstream concurrency across different programmes', async () => {
    vi.useFakeTimers();
    let active = 0;
    let maximum = 0;
    fixture.request.mockImplementation(async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return respond({ results: [] });
    });
    try {
      const client = new TMDBMetadata({ apiKey: 'test-key' });
      const pending = Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          client.getEpgMetadata({
            title: `Film ${index}`,
            year: 2000,
            mediaType: 'movie',
            language: 'en-US',
          })
        )
      );
      await vi.runAllTimersAsync();
      await pending;
      expect(maximum).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });
});
