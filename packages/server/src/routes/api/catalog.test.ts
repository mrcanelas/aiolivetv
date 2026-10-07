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
    initialiseDelayMs: 0,
    slowCatalogMs: 0,
    stalledValidation: false,
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
    constants,
    normalizeChannelGroup,
    decodeHtmlEntities,
    parseDeclaredStreamInfo,
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
    catalogSupportsSkip: () => fixture.pagedChannels > 0,
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
          catalogs: [{ id: 'channels', type: constants.TV_TYPE }],
          behaviorHints: { epgProvider: id === 'guide' && fixture.epg },
        };
      }
      async getCatalog(_type: string, id: string, extras?: string) {
        if (id.startsWith('streams.') && fixture.slowCatalogMs)
          await new Promise((resolve) =>
            setTimeout(resolve, fixture.slowCatalogMs)
          );
        if (fixture.pagedChannels) {
          const skip = Number(new URLSearchParams(extras).get('skip') || 0);
          return {
            success: true,
            data: id.startsWith('guide.')
              ? Array.from({ length: fixture.pagedChannels }, (_, index) => ({
                  id: `channel:${index}`,
                  name: `Channel ${index}`,
                })).slice(skip, skip + 25)
              : [],
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
  fixture.initialiseDelayMs = 0;
  fixture.slowCatalogMs = 0;
  fixture.stalledValidation = false;
});

async function scan(
  autoMatch: boolean,
  rejectAlternative = false,
  alternativesFor?: string,
  expectedStatus = 200
) {
  const app = express();
  app.use(express.json());
  app.use('/catalogs', catalogApi);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server!.once('listening', resolve));
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
          channelMappings: [
            {
              id: 'bbc',
              canonicalAddonId: 'guide',
              streams: [],
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
  if (expectedStatus !== 200) {
    expect(await response.json()).toMatchObject({
      success: false,
      error: { message: expect.stringContaining('initialising providers') },
    });
    return [];
  }
  const body = (await response.json()) as {
    data: {
      scan: { truncated: boolean };
      channels: Array<{
        id: string;
        epgProvider: boolean;
        mappings: Array<{ channelId: string; confidence: number }>;
        availableStreamSources: Array<{
          channelId: string;
          confidence: number;
        }>;
      }>;
    };
  };
  fixture.truncated = body.data.scan.truncated;
  return body.data.channels;
}

describe('Channels prepared matching', () => {
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
    expect(fixture.truncated).toBe(true);
  });
});
