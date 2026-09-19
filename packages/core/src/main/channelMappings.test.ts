import { describe, expect, it } from 'vitest';
import {
  applyLiveChannelGroupOverlay,
  bindsOwnCatalogStreams,
  buildManualParsedStreams,
  deduplicateLiveTvItems,
  findChannelMappingForId,
  findPossibleDuplicateChannels,
  getEffectiveChannelGroup,
  isLiveChannelVisible,
  MANUAL_STREAM_ADDON_ID,
  sortLiveCatalogItems,
} from './channelMappings.js';
import type { UserData } from '../db/index.js';
import { ChannelMapping } from '../db/channelMapping.js';

const baseUserData = { uuid: 'test' } as UserData;

describe('channel group overlay', () => {
  it('treats catalog+stream sources as already bound', () => {
    expect(
      bindsOwnCatalogStreams({ contributesChannels: true, canStream: true })
    ).toBe(true);
    expect(
      bindsOwnCatalogStreams({ contributesChannels: true, canStream: false })
    ).toBe(false);
    expect(
      bindsOwnCatalogStreams({ contributesChannels: false, canStream: true })
    ).toBe(false);
  });

  it('prefers the mapping override over the source group', () => {
    const userData = {
      ...baseUserData,
      channelMappings: [{ id: 'aiolivetv:globo', group: 'ESPORTES' }],
    } as UserData;
    expect(
      getEffectiveChannelGroup(userData, 'aiolivetv:globo', 'VARIEDADES')
    ).toBe('Esportes');
    expect(
      applyLiveChannelGroupOverlay(userData, [
        { id: 'aiolivetv:globo', genres: ['VARIEDADES'] },
      ])
    ).toEqual([{ id: 'aiolivetv:globo', genres: ['Esportes'] }]);
  });

  it('applies mapping name and poster to catalog items', () => {
    const userData = {
      ...baseUserData,
      channelMappings: [
        {
          id: 'aiolivetv:globo',
          name: '01 Globo',
          poster: 'https://example.com/globo.png',
        },
      ],
    } as UserData;
    expect(
      applyLiveChannelGroupOverlay(userData, [
        {
          id: 'aiolivetv:globo',
          name: 'Globo',
          poster: 'https://cdn.example/old.png',
          genres: ['Variedades'],
        },
      ])
    ).toEqual([
      {
        id: 'aiolivetv:globo',
        name: '01 Globo',
        poster: 'https://example.com/globo.png',
        logo: 'https://example.com/globo.png',
        genres: ['Variedades'],
      },
    ]);
  });

  it('sorts catalog items by the overlaid name', () => {
    expect(
      sortLiveCatalogItems([
        { id: 'b', name: 'SBT' },
        { id: 'a', name: '01 Globo' },
      ]).map((item) => item.id)
    ).toEqual(['a', 'b']);
  });

  it('keeps the source group when there is no override', () => {
    expect(
      getEffectiveChannelGroup(baseUserData, 'aiolivetv:globo', 'VARIEDADES')
    ).toBe('Variedades');
  });
});

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

describe('findPossibleDuplicateChannels', () => {
  it('groups enabled channels with the same compact name', () => {
    expect(
      findPossibleDuplicateChannels([
        { id: 'xmltv:globo', name: 'Globo HD', enabled: true },
        { id: 'm3u:globo', name: 'Globo FHD', enabled: true },
        { id: 'xmltv:sbt', name: 'SBT', enabled: true },
        { id: 'm3u:sbt-off', name: 'SBT HD', enabled: false },
      ])
    ).toEqual([
      {
        name: 'Globo HD',
        channelIds: ['xmltv:globo', 'm3u:globo'],
      },
    ]);
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

  it('keeps the same name from every provider until the user hides one', () => {
    expect(
      deduplicateLiveTvItems(baseUserData, [
        { id: 'vivo:sbt', name: 'SBT' },
        { id: 'claro:sbt', name: 'SBT' },
        { id: 'mitv:sbt', name: 'SBT' },
      ]).map((item) => item.id)
    ).toEqual(['vivo:sbt', 'claro:sbt', 'mitv:sbt']);
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

describe('buildManualParsedStreams', () => {
  it('attaches headers and declared metadata to the Stremio stream', () => {
    const streams = buildManualParsedStreams(
      {
        ...baseUserData,
        channelMappings: [
          {
            id: 'aiolivetv:caras',
            streams: [
              {
                addonId: MANUAL_STREAM_ADDON_ID,
                channelId: 'manual:https://example.com/live.m3u8',
                url: 'https://example.com/live.m3u8',
                name: 'Caras TV FHD',
                headers: {
                  Referer: 'https://example.com/',
                  'User-Agent': 'VLC',
                },
                resolution: '1080p',
                encode: 'HEVC',
                languages: ['Portuguese (Brazil)'],
              },
            ],
          },
        ],
      },
      'aiolivetv:caras'
    );

    expect(streams).toHaveLength(1);
    expect(streams[0].url).toBe('https://example.com/live.m3u8');
    expect(streams[0].requestHeaders).toEqual({
      Referer: 'https://example.com/',
      'User-Agent': 'VLC',
    });
    expect(streams[0].notWebReady).toBe(true);
    expect(streams[0].parsedFile?.resolution).toBe('1080p');
    expect(streams[0].parsedFile?.encode).toBe('HEVC');
    expect(streams[0].parsedFile?.languages).toEqual(['Portuguese (Brazil)']);
  });

  it('detects resolution from the stream label when none is set', () => {
    const streams = buildManualParsedStreams(
      {
        ...baseUserData,
        channelMappings: [
          {
            id: 'aiolivetv:caras',
            streams: [
              {
                addonId: MANUAL_STREAM_ADDON_ID,
                channelId: 'manual:https://example.com/live.m3u8',
                url: 'https://example.com/live.m3u8',
                name: 'Caras TV FHD',
              },
            ],
          },
        ],
      },
      'aiolivetv:caras'
    );

    expect(streams[0].parsedFile?.resolution).toBe('1080p');
    expect(streams[0].notWebReady).toBeUndefined();
  });
});
