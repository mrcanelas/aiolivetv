import { describe, expect, it, vi } from 'vitest';
import type { ParsedStream, UserData } from '../db/schemas.js';
import type { StreamContext } from './context.js';
import StreamSorter from './sorter.js';

vi.mock('../utils/index.js', async () => ({
  constants: await import('../utils/constants.js'),
  createLogger: () => ({ debug: vi.fn() }),
}));

function stream(id: string, addon: string, resolution = '720p') {
  return {
    id,
    type: 'live',
    addon: { preset: { id: addon }, instanceId: `${addon}-runtime` },
    parsedFile: { resolution },
  } as ParsedStream;
}

function config(global: UserData['sortCriteria']['global']): UserData {
  return {
    presets: ['first', 'second'].map((instanceId) => ({
      instanceId,
      type: 'm3u',
      enabled: true,
      options: {},
    })),
    sortCriteria: { global },
    preferredResolutions: ['1080p', '720p', 'Unknown'],
  } as UserData;
}

describe('Live TV stream sorting', () => {
  it.each(['tv', 'channel'])(
    'applies global criteria before the previous binding order (%s)',
    async (type) => {
      const data = config([
        { key: 'addon', direction: 'desc' },
        { key: 'resolution', direction: 'desc' },
      ]);
      const streams = [
        stream('second-hd', 'second', '1080p'),
        stream('first-sd', 'first'),
        stream('first-hd', 'first', '1080p'),
      ];
      const snapshot = structuredClone(streams);
      const sorter = new StreamSorter(data);
      expect(
        (await sorter.sort(streams, { type } as StreamContext)).map(
          (item) => item.id
        )
      ).toEqual(['first-hd', 'first-sd', 'second-hd']);
      data.sortCriteria.global.reverse();
      expect(
        (await sorter.sort(streams, { type } as StreamContext)).map(
          (item) => item.id
        )
      ).toEqual(['first-hd', 'second-hd', 'first-sd']);
      expect(streams).toEqual(snapshot);
    }
  );

  it('ignores inherited VOD criteria and split-cache overrides for channels', async () => {
    const data = config([
      { key: 'cached', direction: 'desc' },
      { key: 'size', direction: 'desc' },
    ]);
    data.sortCriteria.cached = [{ key: 'resolution', direction: 'desc' }];
    data.sortCriteria.uncached = [{ key: 'resolution', direction: 'desc' }];
    const streams = [
      stream('sd', 'first'),
      { ...stream('hd', 'second', '1080p'), size: 999 },
    ];
    expect(
      await new StreamSorter(data).sort(streams, {
        type: 'tv',
      } as StreamContext)
    ).toEqual(streams);
  });

  it('reverses addon priority and follows reordered presets', async () => {
    const data = config([{ key: 'addon', direction: 'asc' }]);
    const streams = [stream('first', 'first'), stream('second', 'second')];
    const sorter = new StreamSorter(data);
    expect(
      (await sorter.sort(streams, { type: 'tv' } as StreamContext))[0].id
    ).toBe('second');
    data.presets.reverse();
    expect(
      (await sorter.sort(streams, { type: 'tv' } as StreamContext))[0].id
    ).toBe('first');
  });

  it('keeps pinned addons outside the shared criteria', async () => {
    const data = config([{ key: 'resolution', direction: 'desc' }]);
    const top = stream('top', 'second');
    top.addon.pinPosition = 'top';
    const bottom = stream('bottom', 'first', '1080p');
    bottom.addon.pinPosition = 'bottom';
    expect(
      (
        await new StreamSorter(data).sort(
          [bottom, stream('hd', 'first', '1080p'), top],
          { type: 'tv' } as StreamContext
        )
      ).map((item) => item.id)
    ).toEqual(['top', 'hd', 'bottom']);
  });
});
