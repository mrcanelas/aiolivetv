import { describe, expect, it } from 'vitest';
import { isLiveChannelVisible } from './channelMappings.js';
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
