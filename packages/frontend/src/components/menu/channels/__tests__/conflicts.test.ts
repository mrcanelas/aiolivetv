import { describe, expect, it } from 'vitest';
import type { ChannelInfo } from '@/lib/api';
import {
  asChannelsResponse,
  buildVisibleChannelMappings,
  type ChannelMappingProjectionCache,
  channelHasPlayableStream,
  channelHasSchedule,
  compactChannelLabel,
  filterChannelsByReview,
  findDuplicateGroups,
  getChannelSourceLabel,
  getRemovedChannels,
  parseStreamSourceKey,
  streamSourceKey,
  isVisibleChannelSuggestion,
  normalizeChannelGroup,
} from '../utils';

describe('shared channel group normalization', () => {
  it('decodes HTML entities consistently with delivery', () => {
    expect(normalizeChannelGroup('News &amp; Sports HD')).toBe('News & Sports');
    expect(normalizeChannelGroup('CANAIS | FILMES FHD')).toBe('Filmes');
    expect(normalizeChannelGroup('News &#1114112;')).toBe('News &#1114112;');
  });
});

describe('visible stream suggestions', () => {
  it.each([0, 0.5, 0.75, 0.9, 1])(
    'does not show score %s as a suggestion',
    (confidence) => {
      expect(isVisibleChannelSuggestion(confidence)).toBe(false);
    }
  );
  it.each([0.7501, 0.8, 0.89])(
    'shows score %s as a suggestion',
    (confidence) => {
      expect(isVisibleChannelSuggestion(confidence)).toBe(true);
    }
  );
});

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

describe('buildVisibleChannelMappings', () => {
  it.each([false, true])(
    'preserves saved edits and bindings when a source channel is absent (empty=%s)',
    (empty) => {
      const saved = {
        id: 'aiolivetv:MzI4',
        canonicalAddonId: 'claro',
        name: 'Canal do Boi',
        poster: 'https://example.com/custom-boi.png',
        streams: [{ addonId: 'streams', channelId: 'boi', enabled: true }],
      };
      const hidden = { id: 'removed', hidden: true };
      const channels = empty
        ? []
        : [channel({ id: 'vivo:other', name: 'Other', enabled: false })];

      const mappings = buildVisibleChannelMappings(
        channels,
        [saved, hidden],
        new Set(),
        new WeakMap()
      );

      expect(mappings.find((mapping) => mapping.id === saved.id)).toBe(saved);
      expect(mappings.some((mapping) => mapping.id === hidden.id)).toBe(false);
    }
  );

  it('reuses unchanged projections and existing mappings on a single-channel edit', () => {
    const cache: ChannelMappingProjectionCache = new WeakMap();
    const channels = Array.from({ length: 1287 }, (_, index) =>
      channel({ id: String(index), name: String(index), enabled: false })
    );
    const initial = buildVisibleChannelMappings(channels, [], new Set(), cache);
    const next = channels.map((item, index) =>
      index === 0 ? { ...item, enabled: true } : item
    );
    const updated = buildVisibleChannelMappings(
      next,
      initial,
      new Set(),
      cache
    );
    expect(updated).toHaveLength(1286);
    updated.forEach((mapping, index) =>
      expect(mapping).toBe(initial[index + 1])
    );
    expect(
      buildVisibleChannelMappings(next, updated, new Set(), cache)
    ).toEqual(updated);
  });

  it('retains manual fields and rejections without persisting pending suggestions', () => {
    const item = channel({
      id: 'bbc',
      name: 'BBC',
      rejectedStreams: [{ addonId: 'rejected', channelId: 'bbc' }],
      mappings: [
        {
          id: 'manual:bbc',
          addonId: 'manual',
          addonName: 'Manual',
          channelId: 'manual:bbc',
          name: 'BBC HD',
          confidence: 1,
          enabled: true,
          canStream: true,
          epgProvider: false,
          url: 'https://example.com/live.m3u8',
          headers: { Referer: 'https://example.com' },
          languages: ['en'],
          resolution: '1080p',
        },
        {
          id: 'suggestion',
          addonId: 'streams',
          addonName: 'Streams',
          channelId: 'suggestion',
          name: 'BBC',
          confidence: 0.85,
          enabled: true,
          canStream: true,
          epgProvider: false,
        },
      ],
    });
    const [mapping] = buildVisibleChannelMappings(
      [item],
      [],
      new Set(),
      new WeakMap()
    );
    expect(mapping.rejectedStreams).toEqual(item.rejectedStreams);
    expect(mapping.streams).toHaveLength(1);
    expect(mapping.streams?.[0]).toMatchObject({
      url: 'https://example.com/live.m3u8',
      headers: { Referer: 'https://example.com' },
      languages: ['en'],
      resolution: '1080p',
    });
  });

  it('reprojects an unchanged channel when it becomes customized', () => {
    const item = channel({
      id: 'bbc',
      name: 'BBC',
      poster: 'https://example.com/logo.png',
    });
    const cache: ChannelMappingProjectionCache = new WeakMap();
    expect(buildVisibleChannelMappings([item], [], new Set(), cache)).toEqual(
      []
    );
    const [mapping] = buildVisibleChannelMappings(
      [item],
      [],
      new Set(['bbc']),
      cache
    );
    expect(mapping).toMatchObject({ name: 'BBC', poster: item.poster });
  });

  it('preserves bindings discovered on untouched channels during refresh', () => {
    const item = channel({
      id: 'bbc',
      name: 'BBC',
      mappings: [
        {
          id: 'm3u:bbc',
          addonId: 'm3u',
          addonName: 'M3U',
          channelId: 'm3u:bbc',
          name: 'BBC',
          confidence: 1,
          enabled: true,
          canStream: true,
          epgProvider: false,
        },
      ],
    });
    const [mapping] = buildVisibleChannelMappings(
      [item],
      [],
      new Set(),
      new WeakMap()
    );
    expect(mapping.streams?.[0].channelId).toBe('m3u:bbc');
  });
});

describe('compactChannelLabel', () => {
  it('strips quality markers so Globo HD matches Globo FHD', () => {
    expect(compactChannelLabel('Globo HD')).toBe(
      compactChannelLabel('Globo FHD')
    );
  });

  it('strips Rede so Rede Globo matches Globo', () => {
    expect(compactChannelLabel('Rede Globo')).toBe(
      compactChannelLabel('Globo')
    );
  });
});

describe('getChannelSourceLabel', () => {
  it('uses the catalog source name when there are no stream mappings', () => {
    expect(
      getChannelSourceLabel(
        channel({ id: 'sbt', name: 'SBT', sourceName: 'Vivo TV' })
      )
    ).toBe('Vivo TV');
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
      channelHasSchedule(
        channel({ id: 'bbc', name: 'BBC One', epgProvider: true })
      )
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
    ).toEqual([{ name: 'Globo HD', channelIds: ['xmltv:globo', 'm3u:globo'] }]);
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

describe('asChannelsResponse', () => {
  it('wraps a legacy channel array', () => {
    expect(
      asChannelsResponse([channel({ id: 'a', name: 'A' })]).channels
    ).toHaveLength(1);
  });
});

describe('stream source search', () => {
  it('keeps encoded channel ids when parsing the selected key', () => {
    const key = streamSourceKey('frost-view', 'aiolivetv:abc123');
    expect('frost-view:aiolivetv:abc123'.split(':', 2)).toEqual([
      'frost-view',
      'aiolivetv',
    ]);
    expect(parseStreamSourceKey(key)).toEqual({
      addonId: 'frost-view',
      streamChannelId: 'aiolivetv:abc123',
    });
  });
});

describe('getRemovedChannels', () => {
  it('lists hidden mappings by saved name', () => {
    expect(
      getRemovedChannels([
        { id: 'keep', name: 'Globo' },
        {
          id: 'gone',
          name: 'SBT',
          hidden: true,
          poster: 'https://cdn/sbt.png',
        },
        { id: 'noid', hidden: true },
      ])
    ).toEqual([
      { id: 'noid', name: 'noid', poster: undefined, sourceName: undefined },
      {
        id: 'gone',
        name: 'SBT',
        poster: 'https://cdn/sbt.png',
        sourceName: undefined,
      },
    ]);
  });

  it('fills name and poster from the catalog when the mapping only has an id', () => {
    expect(
      getRemovedChannels(
        [{ id: 'aiolivetv:bGNoMjA1MA', hidden: true }],
        [
          {
            id: 'aiolivetv:bGNoMjA1MA',
            name: 'Band',
            poster: 'https://cdn/band.png',
            sourceName: 'Claro TV',
          },
        ]
      )
    ).toEqual([
      {
        id: 'aiolivetv:bGNoMjA1MA',
        name: 'Band',
        poster: 'https://cdn/band.png',
        sourceName: 'Claro TV',
      },
    ]);
  });
});
