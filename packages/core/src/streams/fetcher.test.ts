import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Addon, ParsedStream, UserData } from '../db/schemas.js';
import type StreamFilter from './filterer.js';
import type StreamPrecompute from './precomputer.js';
import type { StreamContext } from './context.js';
import { orderLiveStreamsByMapping } from '../main/channelMappings.js';

const fixture = vi.hoisted(() => {
  process.env.BASE_URL = 'http://127.0.0.1';
  return { getStreams: vi.fn() };
});
vi.mock('../main/wrapper.js', () => ({
  Wrapper: class {
    constructor(private addon: Addon) {}
    getStreams(type: string, id: string) {
      return fixture.getStreams(this.addon, type, id);
    }
  },
}));
vi.mock('../utils/index.js', async () => ({
  constants: await import('../utils/constants.js'),
  createLogger: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  getAddonName: (addon: Addon) => addon.name,
  getTimeTakenSincePoint: () => '1ms',
  DSU: (await import('../utils/dsu.js')).DSU,
}));
vi.mock('../analytics/index.js', () => ({
  classifyAddonError: () => ({ error_kind: 'unknown' }),
}));
vi.mock('../parser/streamExpression.js', () => ({
  ExitConditionEvaluator: class {},
  GroupConditionEvaluator: class {},
}));
import StreamFetcher from './fetcher.js';

const addons: Addon[] = ['A', 'B'].map((id) => ({
  instanceId: id,
  name: id,
  manifestUrl: `https://example.com/${id}/manifest.json`,
  enabled: true,
  timeout: 1000,
  preset: { id, type: 'custom', options: {} },
}));

async function fetch(ids?: Map<string, string[]>, deduplicate = false) {
  const filter = { filter: async (streams: ParsedStream[]) => streams };
  const precompute = {
    precomputeSeaDexOnly: vi.fn(),
    precomputePreferred: vi.fn(),
  };
  return new StreamFetcher(
    {
      uuid: 'test',
      presets: addons.map((addon) => ({
        type: 'custom',
        instanceId: addon.preset.id,
        enabled: true,
        options: {},
      })),
      deduplicator: {
        enabled: deduplicate,
        keys: ['filename'],
        live: 'single_result',
      },
    } as UserData,
    filter as unknown as StreamFilter,
    precompute as unknown as StreamPrecompute
  ).fetch(
    addons.slice(0, ids?.size ?? 1),
    {
      type: 'tv',
      id: 'canonical',
      queryType: 'tv',
      startAllFetches: vi.fn(),
    } as unknown as StreamContext,
    ids
  );
}

afterEach(() => fixture.getStreams.mockReset());

describe('linked channel playback', () => {
  it('still deduplicates the same stream returned by two linked IDs', async () => {
    fixture.getStreams.mockImplementation(async (addon) => [
      {
        id: 'same-url',
        filename: 'Same channel',
        addon,
        type: 'live',
        url: 'https://example.com/live.m3u8',
      },
    ]);
    const { streams } = await fetch(new Map([['A', ['hd', 'base']]]), true);
    expect(fixture.getStreams).toHaveBeenCalledTimes(2);
    expect(streams).toHaveLength(1);
  });
  it('fetches all three IDs from one addon and records their origin', async () => {
    fixture.getStreams.mockImplementation(async (addon, _type, id) => [
      {
        id: 'parser-counter-0',
        addon,
        type: 'live',
        url: `https://example.com/${id}.m3u8`,
      },
    ]);
    const { streams, dispositions } = await fetch(
      new Map([['A', ['hd', 'base', 'eng']]])
    );
    expect(fixture.getStreams.mock.calls.map((call) => call[2])).toEqual([
      'hd',
      'base',
      'eng',
    ]);
    expect(streams.map((stream) => stream.live?.sourceChannelId)).toEqual([
      'hd',
      'base',
      'eng',
    ]);
    expect(new Set(streams.map((stream) => stream.id)).size).toBe(3);
    expect(dispositions.get(addons[0].manifestUrl)).toMatchObject({
      rawCount: 3,
      status: 'ok',
    });
  });

  it('preserves configured priority across two addons', async () => {
    fixture.getStreams.mockImplementation(async (addon, _type, id) => {
      if (id === 'hd') await new Promise((resolve) => setTimeout(resolve, 10));
      return [
        { id, addon, type: 'live', url: `https://example.com/${id}.m3u8` },
      ];
    });
    const sources = [
      { addonId: 'A', channelId: 'hd' },
      { addonId: 'B', channelId: 'other' },
      { addonId: 'A', channelId: 'base' },
    ];
    const { streams } = await fetch(
      new Map([
        ['A', ['hd', 'base']],
        ['B', ['other']],
      ])
    );
    expect(
      orderLiveStreamsByMapping(streams, [], sources).map(
        (stream) => stream.live?.sourceChannelId
      )
    ).toEqual(['hd', 'other', 'base']);
  });

  it('keeps successful IDs and reports a failed linked ID', async () => {
    fixture.getStreams.mockImplementation(async (addon, _type, id) => {
      if (id === 'bad') throw new Error('Unavailable');
      return [{ id, addon, type: 'live' }];
    });
    const result = await fetch(new Map([['A', ['good', 'bad']]]));
    expect(
      result.streams.map((stream) => stream.live?.sourceChannelId)
    ).toEqual(['good']);
    expect(result.errors).toEqual([
      expect.objectContaining({ description: 'bad: Unavailable' }),
    ]);
    expect(result.dispositions.get(addons[0].manifestUrl)?.rawCount).toBe(1);
  });

  it('reports an addon failure if all linked IDs fail', async () => {
    fixture.getStreams.mockRejectedValue(new Error('Unavailable'));
    const result = await fetch(new Map([['A', ['bad', 'worse']]]));
    expect(result.streams).toEqual([]);
    expect(result.dispositions.get(addons[0].manifestUrl)).toMatchObject({
      disposition: 'error',
      status: 'error',
    });
  });

  it('preserves the ordinary single-ID request', async () => {
    fixture.getStreams.mockResolvedValue([]);
    await fetch();
    expect(fixture.getStreams).toHaveBeenCalledTimes(1);
    expect(fixture.getStreams).toHaveBeenCalledWith(
      addons[0],
      'tv',
      'canonical'
    );
  });
});
