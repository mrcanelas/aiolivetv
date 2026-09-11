import { describe, expect, it } from 'vitest';
import type { ChannelInfo } from '@/lib/api';
import {
  asChannelsResponse,
  channelHasPlayableStream,
  channelHasSchedule,
  compactChannelLabel,
  filterChannelsByReview,
  findDuplicateGroups,
  visibleUnmatchedStreams,
} from '../utils';

function channel(
  overrides: Partial<ChannelInfo> & Pick<ChannelInfo, 'id' | 'name'>
): ChannelInfo {
  return {
    canonicalAddonId: 'xmltv',
    enabled: true,
    mappings: [],
    ...overrides,
  };
}

describe('compactChannelLabel', () => {
  it('strips quality markers so Globo HD matches Globo FHD', () => {
    expect(compactChannelLabel('Globo HD')).toBe(
      compactChannelLabel('Globo FHD')
    );
  });
});

describe('channelHasPlayableStream', () => {
  it('ignores pending suggestions', () => {
    expect(
      channelHasPlayableStream(
        channel({
          id: 'bbc',
          name: 'BBC One',
          mappings: [
            {
              id: 'm3u:bbc',
              addonId: 'm3u',
              addonName: 'M3U',
              channelId: 'm3u:bbc',
              name: 'BBC One HD',
              confidence: 0.85,
              enabled: true,
              epgProvider: false,
              canStream: true,
            },
          ],
        })
      )
    ).toBe(false);
  });

  it('requires an enabled stream mapping', () => {
    expect(
      channelHasPlayableStream(
        channel({
          id: 'bbc',
          name: 'BBC One',
          mappings: [
            {
              id: 'm3u:bbc',
              addonId: 'm3u',
              addonName: 'M3U',
              channelId: 'm3u:bbc',
              name: 'BBC One',
              confidence: 1,
              enabled: true,
              epgProvider: false,
              canStream: true,
            },
          ],
        })
      )
    ).toBe(true);
  });
});

describe('channelHasSchedule', () => {
  it('treats EPG-backed channels as having a schedule', () => {
    expect(
      channelHasSchedule(channel({ id: 'bbc', name: 'BBC One', epgProvider: true }))
    ).toBe(true);
  });
});

describe('findDuplicateGroups', () => {
  it('groups enabled channels with the same compact name', () => {
    expect(
      findDuplicateGroups([
        channel({ id: 'xmltv:globo', name: 'Globo HD' }),
        channel({ id: 'm3u:globo', name: 'Globo FHD' }),
        channel({ id: 'xmltv:sbt', name: 'SBT' }),
      ])
    ).toEqual([
      { name: 'Globo HD', channelIds: ['xmltv:globo', 'm3u:globo'] },
    ]);
  });
});

describe('filterChannelsByReview', () => {
  const channels = [
    channel({ id: 'no-stream', name: 'Guide only', epgProvider: true }),
    channel({
      id: 'streamed',
      name: 'With stream',
      mappings: [
        {
          id: 'm3u:with',
          addonId: 'm3u',
          addonName: 'M3U',
          channelId: 'm3u:with',
          name: 'With stream',
          confidence: 1,
          enabled: true,
          epgProvider: false,
          canStream: true,
        },
      ],
    }),
  ];

  it('keeps enabled channels without an accepted stream', () => {
    expect(
      filterChannelsByReview(channels, 'no-stream', new Set()).map(
        (item) => item.id
      )
    ).toEqual(['no-stream']);
  });

  it('keeps channels without EPG as no-schedule', () => {
    expect(
      filterChannelsByReview(channels, 'no-schedule', new Set()).map(
        (item) => item.id
      )
    ).toEqual(['streamed']);
  });
});

describe('visibleUnmatchedStreams', () => {
  it('hides streams that were mapped locally after the scan', () => {
    expect(
      visibleUnmatchedStreams(
        [{ addonId: 'm3u', addonName: 'M3U', channelId: 'm3u:cnn', name: 'CNN' }],
        [
          channel({
            id: 'cnn',
            name: 'CNN',
            mappings: [
              {
                id: 'm3u:cnn',
                addonId: 'm3u',
                addonName: 'M3U',
                channelId: 'm3u:cnn',
                name: 'CNN',
                confidence: 1,
                enabled: true,
                epgProvider: false,
                canStream: true,
              },
            ],
          }),
        ]
      )
    ).toEqual([]);
  });
});

describe('asChannelsResponse', () => {
  it('wraps a legacy channel array', () => {
    expect(asChannelsResponse([channel({ id: 'a', name: 'A' })]).channels).toHaveLength(
      1
    );
  });
});
