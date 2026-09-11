import { describe, expect, it } from 'vitest';
import {
  deduplicateLiveTvItems,
  findChannelMappingForId,
  isLiveChannelVisible,
} from './channelMappings.js';
import type { UserData } from '../db/index.js';
import { ChannelMapping } from '../db/channelMapping.js';

const baseUserData = { uuid: 'test' } as UserData;

describe('isLiveChannelVisible', () => {
  it('returns true when no mapping exists', () => {
    expect(isLiveChannelVisible(baseUserData, 'aiolivetv:abc')).toBe(true);
  });

  it('hides disabled channels', () => {
    expect(
      isLiveChannelVisible(
        {
          ...baseUserData,
          channelMappings: [{ id: 'aiolivetv:abc', enabled: false }],
        },
        'aiolivetv:abc'
      )
    ).toBe(false);
  });

  it('hides excluded channels', () => {
    expect(
      isLiveChannelVisible(
        {
          ...baseUserData,
          channelMappings: [{ id: 'aiolivetv:abc', hidden: true }],
        },
        'aiolivetv:abc'
      )
    ).toBe(false);
  });

  it('shows enabled channels with mappings', () => {
    expect(
      isLiveChannelVisible(
        {
          ...baseUserData,
          channelMappings: [
            {
              id: 'aiolivetv:abc',
              enabled: true,
              canonicalAddonId: 'vivo',
            },
          ],
        },
        'aiolivetv:abc'
      )
    ).toBe(true);
  });
});

describe('findChannelMappingForId', () => {
  const userData = {
    ...baseUserData,
    channelMappings: [
      {
        id: 'vivo:globo',
        streams: [{ addonId: 'claro', channelId: 'claro:globo' }],
      },
    ],
  } as UserData;

  it('finds the canonical mapping id', () => {
    expect(findChannelMappingForId(userData, 'vivo:globo')?.id).toBe(
      'vivo:globo'
    );
  });

  it('finds a mapping by linked stream channel id', () => {
    expect(findChannelMappingForId(userData, 'claro:globo')?.id).toBe(
      'vivo:globo'
    );
  });

  it('returns undefined when the id is not mapped', () => {
    expect(findChannelMappingForId(userData, 'vivo:sbt')).toBeUndefined();
  });
});

describe('deduplicateLiveTvItems', () => {
  it('keeps the canonical mapped channel and drops aliases', () => {
    const userData = {
      ...baseUserData,
      channelMappings: [
        {
          id: 'vivo:globo',
          streams: [{ addonId: 'claro', channelId: 'claro:globo' }],
        },
      ],
    } as UserData;

    expect(
      deduplicateLiveTvItems(userData, [
        { id: 'vivo:globo', name: 'Globo' },
        { id: 'claro:globo', name: 'Globo' },
      ]).map((item) => item.id)
    ).toEqual(['vivo:globo']);
  });

  it('drops high-confidence name duplicates without a mapping', () => {
    expect(
      deduplicateLiveTvItems(baseUserData, [
        { id: 'vivo:sbt', name: 'SBT' },
        { id: 'claro:sbt', name: 'SBT' },
      ]).map((item) => item.id)
    ).toEqual(['vivo:sbt']);
  });

  it('hides disabled mapped channels', () => {
    const userData = {
      ...baseUserData,
      channelMappings: [{ id: 'vivo:sbt', enabled: false }],
    } as UserData;

    expect(
      deduplicateLiveTvItems(userData, [{ id: 'vivo:sbt', name: 'SBT' }])
    ).toEqual([]);
  });
});

const persistedMappings = [
  {
    id: 'aiolivetv:bbc.one',
    canonicalAddonId: 'xmltv-1',
    enabled: true,
    name: 'BBC One',
    streams: [
      {
        addonId: 'm3u-1',
        channelId: 'aiolivetv:bbc.one',
        confidence: 1,
        enabled: true,
      },
    ],
    rejectedStreams: [{ addonId: 'm3u-2', channelId: 'aiolivetv:other' }],
  },
  {
    id: 'aiolivetv:rtp1',
    canonicalAddonId: 'm3u-1',
    enabled: false,
    streams: [
      {
        addonId: 'm3u-1',
        channelId: 'aiolivetv:rtp1',
        enabled: true,
      },
    ],
  },
] satisfies UserData['channelMappings'];

describe('channelMappings persistence', () => {
  it('round-trips mappings through JSON like the stored UserData blob', () => {
    const parsed = ChannelMapping.array().parse(
      JSON.parse(JSON.stringify(persistedMappings))
    );
    const userData = { ...baseUserData, channelMappings: parsed };
    expect(parsed).toEqual(persistedMappings);
    expect(isLiveChannelVisible(userData, 'aiolivetv:rtp1')).toBe(false);
    expect(isLiveChannelVisible(userData, 'aiolivetv:bbc.one')).toBe(true);
  });

  it('rejects mappings with invalid stream confidence', () => {
    expect(() =>
      ChannelMapping.parse({
        id: 'aiolivetv:bbc.one',
        streams: [
          {
            addonId: 'm3u-1',
            channelId: 'aiolivetv:bbc.one',
            confidence: 1.5,
          },
        ],
      })
    ).toThrow();
  });
});
