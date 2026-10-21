import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import {
  prepareChannelMatchCandidate,
  getPreparedChannelMatchConfidence,
} from '@aiolivetv/core';
import catalogApi from './catalog.js';

const fixture = vi.hoisted(() => {
  process.env.BASE_URL = 'http://127.0.0.1';
  return {
    epg: true,
    budgetMs: 0,
    extraStreams: 0,
    truncated: false,
    pagedChannels: 0,
    pagedStreams: 0,
    repeatPages: false,
    roundedPages: false,
    shiftedPages: false,
    streamCatalog: 'channels',
    guideCatalog: 'channels',
    matchingTruncated: false,
    initialiseDelayMs: 0,
    initialiseFailure: false,
    slowCatalogMs: 0,
    stalledValidation: false,
    sources: [] as Array<{ error?: string; truncated?: boolean }>,
    inventory: new Map<string, { value: unknown; expires: number }>(),
    catalogCalls: 0,
    m3uConfig: undefined as unknown,
    onGuideCatalog: undefined as (() => void) | undefined,
  };
});

vi.mock('../../middlewares/ratelimit.js', () => ({
  catalogApiRateLimiter: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));
vi.mock('../../middlewares/auth.js', () => ({
  attachSession: (_req: unknown, _res: unknown, next: () => void) => next(),
  injectAccessKey: vi.fn(),
}));
vi.mock('@aiolivetv/core', async () => {
  const matching = await import('../../../../core/src/main/channelMappings.js');
  const constants = await import('../../../../core/src/utils/constants.js');
  const { normalizeChannelGroup } =
    await import('../../../../core/src/utils/channelName.js');
  const { decodeHtmlEntities } =
    await import('../../../../core/src/utils/text.js');
  const { parseDeclaredStreamInfo } =
    await import('../../../../core/src/streams/declared.js');
  const addons = [
    {
      instanceId: 'guide',
      name: 'Guide',
      preset: { type: 'xmltv' },
    },
    {
      instanceId: 'streams',
      name: 'Streams',
      preset: { type: 'm3u' },
    },
  ];
  return {
    ...matching,
    M3uAddon: class {
      constructor(config: unknown) {
        fixture.m3uConfig = config;
      }
      async getEpgUrls() {
        return ['https://example.com/guide.xml'];
      }
    },
    constants,
    APIError: constants.APIError,
    normalizeChannelGroup,
    decodeHtmlEntities,
    parseDeclaredStreamInfo,
    getSimpleTextHash: (value: string) => value,
    Cache: {
      getInstance: () => ({
        get: async (key: string) => {
          const entry = fixture.inventory.get(key);
          return entry && entry.expires > Date.now()
            ? structuredClone(entry.value)
            : undefined;
        },
        set: async (key: string, value: unknown, ttl: number) => {
          fixture.inventory.set(key, {
            value: structuredClone(value),
            expires: Date.now() + ttl * 1000,
          });
        },
        delete: async (key: string) => fixture.inventory.delete(key),
      }),
    },
    config: {
      resources: {
        timeouts: {
          get channelScan() {
            return fixture.budgetMs;
          },
        },
      },
    },
    createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
    catalogSupportsSkip: () =>
      fixture.pagedChannels > 0 || fixture.pagedStreams > 0,
    validateConfig: async (data: unknown) => {
      if (fixture.stalledValidation) return new Promise(() => {});
      return structuredClone(data);
    },
    prepareChannelMatchCandidate: vi.fn(matching.prepareChannelMatchCandidate),
    getPreparedChannelMatchConfidence: vi.fn(
      matching.getPreparedChannelMatchConfidence
    ),
    addonProvidesResource: (addon: { instanceId: string }, resource: string) =>
      addon.instanceId === 'guide'
        ? resource === 'catalog'
        : resource === 'stream',
    AIOStreams: class {
      async initialise() {
        if (fixture.initialiseDelayMs)
          await new Promise((resolve) =>
            setTimeout(resolve, fixture.initialiseDelayMs)
          );
        if (fixture.initialiseFailure) throw new Error('Initialisation failed');
        return this;
      }
      getAddons() {
        return addons;
      }
      getAddon(id: string) {
        return addons.find((addon) => addon.instanceId === id);
      }
      getInitialisationErrors() {
        return [];
      }
      getManifest(id: string) {
        return {
          resources: id === 'guide' ? ['catalog', 'meta'] : ['stream'],
          catalogs: [
            {
              id: id === 'guide' ? fixture.guideCatalog : fixture.streamCatalog,
              type: constants.TV_TYPE,
            },
          ],
          behaviorHints: { epgProvider: id === 'guide' && fixture.epg },
        };
      }
      async getCatalog(_type: string, id: string, extras?: string) {
        fixture.catalogCalls++;
        if (id.startsWith('guide.')) fixture.onGuideCatalog?.();
        if (id.startsWith('streams.') && fixture.slowCatalogMs)
          await new Promise((resolve) =>
            setTimeout(resolve, fixture.slowCatalogMs)
          );
        if (fixture.pagedChannels || fixture.pagedStreams) {
          let skip = fixture.repeatPages
            ? 0
            : Number(new URLSearchParams(extras).get('skip') || 0);
          if (fixture.roundedPages) skip = Math.floor(skip / 25) * 25;
          if (fixture.shiftedPages && skip > 0) skip += 2;
          const guide = id.startsWith('guide.');
          const total = guide ? fixture.pagedChannels : fixture.pagedStreams;
          return {
            success: true,
            data: Array.from(
              { length: Math.max(0, Math.min(25, total - skip)) },
              (_, offset) => ({
                id: `${guide ? 'channel' : 'stream'}:${skip + offset}`,
                name: `${guide ? 'Channel' : 'Stream'} ${skip + offset}`,
              })
            ),
          };
        }
        return {
          success: true,
          data: id.startsWith('guide.')
            ? [
                { id: 'bbc', name: 'BBC News', tvgId: 'bbc.news' },
                { id: 'hbo', name: 'HBO West' },
              ]
            : [
                { id: 'bbc-stream', name: 'BBC News HD', tvgId: 'BBC.NEWS' },
                { id: 'hbo-stream', name: 'HBO West FHD' },
                { id: 'bbc-alt', name: 'BBC News International' },
                ...Array.from({ length: fixture.extraStreams }, (_, index) => ({
                  id: 'extra-' + index,
                  name: 'BBC News HD',
                })),
              ],
        };
      }
    },
  };
});

let server: Server | undefined;
afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve()))
    );
    server = undefined;
  }
  vi.mocked(prepareChannelMatchCandidate).mockClear();
  vi.mocked(getPreparedChannelMatchConfidence).mockRestore();
  vi.restoreAllMocks();
  fixture.budgetMs = 0;
  fixture.extraStreams = 0;
  fixture.pagedChannels = 0;
  fixture.pagedStreams = 0;
  fixture.repeatPages = false;
  fixture.roundedPages = false;
  fixture.shiftedPages = false;
  fixture.streamCatalog = 'channels';
  fixture.guideCatalog = 'channels';
  fixture.matchingTruncated = false;
  fixture.initialiseDelayMs = 0;
  fixture.initialiseFailure = false;
  fixture.slowCatalogMs = 0;
  fixture.stalledValidation = false;
  fixture.inventory.clear();
  fixture.catalogCalls = 0;
  fixture.onGuideCatalog = undefined;
});

async function scan(
  autoMatch: boolean,
  rejectAlternative = false,
  alternativesFor?: string,
  expectedStatus = 200,
  sourceConfig = 'default',
  enabled = true,
  expectHeartbeat = false
) {
  const app = express();
  app.use(express.json());
  app.use('/catalogs', catalogApi);
  if (!server) {
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server!.once('listening', resolve));
  }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  const response = await fetch(
    `http://127.0.0.1:${address.port}/catalogs/channels`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        autoMatch,
        alternativesFor,
        userData: {
          presets: [],
          sourceConfig,
          channelMappings: [
            {
              id: 'bbc',
              canonicalAddonId: 'guide',
              streams:
                sourceConfig === 'saved-bindings'
                  ? [
                      {
                        addonId: 'streams',
                        channelId: 'gone',
                        confidence: 0,
                        enabled: false,
                      },
                      {
                        addonId: 'manual',
                        channelId: 'manual:one',
                        url: 'https://example.com/live.m3u8',
                        confidence: 0,
                      },
                      {
                        addonId: 'streams',
                        channelId: 'bbc-stream',
                        confidence: 0,
                      },
                    ]
                  : [],
              enabled,
              rejectedStreams: rejectAlternative
                ? [{ addonId: 'streams', channelId: 'bbc-alt' }]
                : [],
            },
          ],
        },
      }),
    }
  );
  expect(response.status).toBe(expectedStatus);
  expect(response.headers.get('content-type')).toContain('application/json');
  const text = await response.text();
  if (expectHeartbeat) {
    expect(text).toMatch(/^\n/);
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    expect(response.headers.get('cache-control')).toBe(
      'no-store, no-transform'
    );
  }
  if (fixture.stalledValidation || fixture.initialiseFailure) {
    expect(JSON.parse(text)).toMatchObject({
      success: false,
      error: {
        message: fixture.stalledValidation
          ? expect.stringContaining('initialising providers')
          : expect.any(String),
      },
    });
    return [];
  }
  const body = JSON.parse(text) as {
    data: {
      scan: { truncated: boolean; matchingTruncated: boolean };
      sources: Array<{ error?: string; truncated?: boolean }>;
      channels: Array<{
        id: string;
        epgProvider: boolean;
        enabled: boolean;
        mappings: Array<{ channelId: string; confidence: number }>;
        availableStreamSources: Array<{
          channelId: string;
          confidence: number;
        }>;
      }>;
    };
  };
  fixture.truncated = body.data.scan.truncated;
  fixture.matchingTruncated = body.data.scan.matchingTruncated;
  fixture.sources = body.data.sources;
  return body.data.channels;
}

describe('Channels prepared matching', () => {
  it('discovers M3U guide addresses through the existing catalog API', async () => {
    const app = express();
    app.use(express.json());
    app.use('/catalogs', catalogApi);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('No test port');
    const response = await fetch(
      `http://127.0.0.1:${address.port}/catalogs/m3u/epg`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceUrl: 'https://example.com/list.m3u',
          timeout: 5000,
        }),
      }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { urls: ['https://example.com/guide.xml'] },
    });
    expect(fixture.m3uConfig).toMatchObject({
      sourceUrl: 'https://example.com/list.m3u',
      timeout: 5000,
    });
  });

  it('keeps unavailable bindings and interleaved manual streams in saved priority order', async () => {
    const channels = await scan(false, false, undefined, 200, 'saved-bindings');
    const bbc = channels.find((channel) => channel.id === 'bbc')!;
    expect(bbc.mappings.map((mapping) => mapping.channelId)).toEqual([
      'gone',
      'manual:one',
      'bbc-stream',
    ]);
    expect(bbc.mappings[0]).toMatchObject({
      enabled: false,
      canStream: false,
      confidence: 0,
    });
    expect(bbc.mappings[1]).toMatchObject({
      canStream: true,
      url: 'https://example.com/live.m3u8',
    });
  });

  it('keeps slow scans alive and returns valid JSON after heartbeats', async () => {
    const interval = globalThis.setInterval;
    vi.spyOn(globalThis, 'setInterval').mockImplementation((callback) =>
      interval(callback, 5)
    );
    fixture.slowCatalogMs = 40;
    const channels = await scan(
      false,
      false,
      undefined,
      200,
      'default',
      true,
      true
    );
    expect(channels.map((channel) => channel.id)).toEqual(['bbc', 'hbo']);
    expect(fixture.truncated).toBe(false);
  });

  it('returns a JSON error when the configured budget expires after heartbeats', async () => {
    const interval = globalThis.setInterval;
    vi.spyOn(globalThis, 'setInterval').mockImplementation((callback) =>
      interval(callback, 5)
    );
    fixture.budgetMs = 40;
    fixture.stalledValidation = true;
    await scan(false, false, undefined, 200, 'default', true, true);
  });

  it('returns a JSON error when initialisation fails after heartbeats', async () => {
    const interval = globalThis.setInterval;
    vi.spyOn(globalThis, 'setInterval').mockImplementation((callback) =>
      interval(callback, 5)
    );
    fixture.initialiseDelayMs = 40;
    fixture.initialiseFailure = true;
    await scan(false, false, undefined, 200, 'default', true, true);
  });

  it('reuses a complete inventory for different channels and applies the current draft', async () => {
    await scan(false);
    const calls = fixture.catalogCalls;
    const first = await scan(false, false, 'bbc', 200, 'default', false);
    const second = await scan(false, false, 'hbo');
    expect(fixture.catalogCalls).toBe(calls);
    expect(first[0].enabled).toBe(false);
    expect(second[0].id).toBe('hbo');
  });

  it('invalidates inventory on refresh and source changes', async () => {
    await scan(false);
    const calls = fixture.catalogCalls;
    await scan(false, false, 'bbc', 200, 'changed');
    expect(fixture.catalogCalls).toBe(calls * 2);
    await scan(true);
    expect(fixture.catalogCalls).toBe(calls * 3);
  });

  it('does not cache partial inventories', async () => {
    fixture.extraStreams = 2001;
    await scan(false);
    const calls = fixture.catalogCalls;
    await scan(false, false, 'bbc');
    expect(fixture.catalogCalls).toBeGreaterThan(calls);
  });

  it('expires inventory after five minutes', async () => {
    await scan(false);
    const calls = fixture.catalogCalls;
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 300001);
    await scan(false, false, 'bbc');
    expect(fixture.catalogCalls).toBeGreaterThan(calls);
  });
  it('discovers a 33k catalog without the old page or channel cap', async () => {
    fixture.pagedChannels = 32920;
    const channels = await scan(false);
    expect(channels).toHaveLength(32920);
    expect(fixture.truncated).toBe(false);
  }, 30000);

  it('reports the channel cap instead of silently dropping channels', async () => {
    fixture.pagedChannels = 60000;
    const channels = await scan(false);
    expect(channels).toHaveLength(50000);
    expect(fixture.truncated).toBe(true);
    expect(fixture.sources).toContainEqual(
      expect.objectContaining({
        truncated: true,
        error: expect.stringContaining('50000 candidate scan limit'),
      })
    );
  }, 30000);

  it('reports the stream candidate cap', async () => {
    fixture.extraStreams = 2001;
    await scan(false);
    expect(fixture.truncated).toBe(true);
    expect(fixture.sources).toContainEqual(
      expect.objectContaining({
        truncated: true,
        error: expect.stringContaining('2000 candidate scan limit'),
      })
    );
  });
  it('lists all manual alternatives beyond candidate and page scan caps', async () => {
    fixture.pagedChannels = 1;
    fixture.pagedStreams = 10026;
    const channels = await scan(false, false, 'channel:0');
    const alternatives = channels.find(
      (channel) => channel.id === 'channel:0'
    )!.availableStreamSources;
    expect(alternatives).toHaveLength(10026);
    expect(alternatives).toContainEqual(
      expect.objectContaining({ channelId: 'stream:10025' })
    );
    expect(fixture.truncated).toBe(false);
    const calls = fixture.catalogCalls;
    await scan(false, false, 'channel:0');
    expect(fixture.catalogCalls).toBe(calls);
  });

  it('stops manual pagination when a provider repeats the same page', async () => {
    fixture.pagedChannels = 1;
    fixture.pagedStreams = 25;
    fixture.repeatPages = true;
    const channels = await scan(false, false, 'channel:0');
    expect(
      channels.find((channel) => channel.id === 'channel:0')
        ?.availableStreamSources
    ).toHaveLength(25);
    expect(fixture.catalogCalls).toBeLessThanOrEqual(6);
  });
  it('returns JSON when provider validation stalls before scanning', async () => {
    fixture.budgetMs = 20;
    fixture.stalledValidation = true;
    await scan(false, false, undefined, 503);
  });

  it('counts provider initialisation in the budget and preserves partial channels', async () => {
    fixture.epg = true;
    fixture.budgetMs = 100;
    fixture.initialiseDelayMs = 70;
    fixture.slowCatalogMs = 70;
    const channels = await scan(false);
    expect(channels.map((channel) => channel.id)).toEqual(['bbc', 'hbo']);
    expect(fixture.truncated).toBe(true);
  });

  it('scans all 1287 channels when providers return pages of 25', async () => {
    fixture.epg = true;
    fixture.pagedChannels = 1287;
    const channels = await scan(false);
    expect(channels).toHaveLength(1287);
    expect(new Set(channels.map((channel) => channel.id)).size).toBe(1287);
    expect(fixture.truncated).toBe(false);
  });
  it.each(['events', 'replays', 'highlights', 'live-event', 'replay-uk'])(
    'skips one-off stream catalog %s',
    async (catalog) => {
      fixture.streamCatalog = catalog;
      await scan(false);
      expect(fixture.catalogCalls).toBe(1);
      expect(fixture.sources).toContainEqual(
        expect.objectContaining({
          skippedCatalogs: [`${catalog} (one-off events)`],
        })
      );
    }
  );
  it('keeps one-off catalogs when they define canonical channels', async () => {
    fixture.guideCatalog = 'events';
    const channels = await scan(false);
    expect(channels).toHaveLength(2);
    expect(fixture.catalogCalls).toBe(2);
  });

  it.each(['roundedPages', 'shiftedPages'] as const)(
    'completes dynamic pagination with %s',
    async (mode) => {
      fixture[mode] = true;
      fixture.pagedChannels = 100;
      const channels = await scan(false);
      expect(channels).toHaveLength(100);
      expect(new Set(channels.map((channel) => channel.id)).size).toBe(100);
      expect(fixture.catalogCalls).toBeLessThan(14);
      expect(fixture.truncated).toBe(false);
    }
  );

  it('keeps overlap overhead below 15% for pages of 25', async () => {
    fixture.pagedChannels = 1287;
    const channels = await scan(false);
    expect(channels).toHaveLength(1287);
    expect(fixture.catalogCalls).toBeLessThanOrEqual(Math.ceil(54 * 1.15));
  });
  it('disables overlap after detecting a provider that rounds offsets', async () => {
    fixture.roundedPages = true;
    fixture.pagedChannels = 1287;
    const channels = await scan(false);
    expect(channels).toHaveLength(1287);
    // 53 guide requests, one stream request, and a single rounded-offset retry.
    expect(fixture.catalogCalls).toBe(55);
  });

  it('reserves matching time only when automatic matching is requested', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    fixture.budgetMs = 100;
    fixture.onGuideCatalog = () => clock.mockReturnValue(1085);
    await scan(true);
    expect(fixture.catalogCalls).toBe(1);
    expect(fixture.truncated).toBe(true);
    expect(fixture.matchingTruncated).toBe(false);
    clock.mockReturnValue(1000);
    const channels = await scan(false);
    expect(fixture.catalogCalls).toBe(3);
    expect(channels).toHaveLength(2);
    expect(fixture.truncated).toBe(false);
  });
  it.each([true, false])('preserves bindings with epg=%s', async (epg) => {
    fixture.epg = epg;
    const channels = await scan(true);
    expect(channels.map((channel: { id: string }) => channel.id)).toEqual([
      'bbc',
      'hbo',
    ]);
    expect(channels[0].epgProvider).toBe(epg);
    expect(channels[0].mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channelId: 'bbc-stream',
          confidence: 1,
        }),
      ])
    );
    expect(channels[1].mappings).toEqual([
      expect.objectContaining({ channelId: 'hbo-stream', confidence: 1 }),
    ]);
    expect(prepareChannelMatchCandidate).toHaveBeenCalledTimes(5);
  });

  it('lists all unlinked stream channels for manual selection without scoring, including rejected suggestions', async () => {
    fixture.epg = true;
    const channels = await scan(false, true, 'bbc');
    expect(channels[0].mappings).toEqual([]);
    expect(
      channels[0].availableStreamSources.map((source) => source.channelId)
    ).toEqual(['bbc-stream', 'bbc-alt', 'hbo-stream']);
    expect(
      channels[0].availableStreamSources.every(
        (source) => source.confidence === undefined
      )
    ).toBe(true);
    expect(channels).toHaveLength(1);
    expect(prepareChannelMatchCandidate).not.toHaveBeenCalled();
    expect(getPreparedChannelMatchConfidence).not.toHaveBeenCalled();
  });

  it.each([0, 0.5, 0.75, 0.7501, 0.89, 0.9])(
    'only generates suggestions above 75%% (score=%s)',
    async (confidence) => {
      vi.mocked(getPreparedChannelMatchConfidence).mockReturnValue(confidence);
      const channels = await scan(true);
      const mappings = channels.flatMap((channel) => channel.mappings);
      expect(mappings).toHaveLength(confidence > 0.75 ? 3 : 0);
      if (confidence >= 0.9)
        expect(mappings.every((mapping) => mapping.confidence === 1)).toBe(
          true
        );
    }
  );

  it('skips matching alternatives on the initial scan', async () => {
    const channels = await scan(false);
    expect(
      channels.every((channel) => channel.availableStreamSources.length === 0)
    ).toBe(true);
    expect(prepareChannelMatchCandidate).not.toHaveBeenCalled();
  });

  it('yields to other requests between scoring batches', async () => {
    const matching =
      await import('../../../../core/src/main/channelMappings.js');
    let heartbeat = false;
    let calls = 0;
    fixture.extraStreams = 256;
    vi.mocked(getPreparedChannelMatchConfidence).mockImplementation(
      (left, right) => {
        if (calls++ === 0)
          setImmediate(() => {
            heartbeat = true;
          });
        if (calls === 129) expect(heartbeat).toBe(true);
        return matching.getPreparedChannelMatchConfidence(left, right);
      }
    );
    await scan(true);
    expect(calls).toBeGreaterThanOrEqual(259);
    expect(fixture.truncated).toBe(false);
  });

  it('does not accept a partially evaluated match after the scan deadline', async () => {
    const matching =
      await import('../../../../core/src/main/channelMappings.js');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    fixture.budgetMs = 100;
    vi.mocked(getPreparedChannelMatchConfidence).mockImplementationOnce(
      (left, right) => {
        clock.mockReturnValue(2000);
        return matching.getPreparedChannelMatchConfidence(left, right);
      }
    );
    const channels = await scan(true);
    expect(channels.every((channel) => channel.mappings.length === 0)).toBe(
      true
    );
    expect(fixture.truncated).toBe(false);
    expect(fixture.matchingTruncated).toBe(true);
  });
});
