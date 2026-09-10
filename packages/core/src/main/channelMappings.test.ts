import { describe, expect, it } from 'vitest';
import {
  deduplicateLiveTvItems,
  findChannelMappingForId,
  isLiveChannelVisible,
} from './channelMappings.js';
import type { UserData } from '../db/index.js';

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
