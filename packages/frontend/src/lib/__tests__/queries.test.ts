import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { UserData } from '@aiolivetv/core';
import type { ChannelsResponse } from '../api';
import { fetchChannels } from '../api';
import { channelAlternativesQuery, channelsQuery } from '../queries';

vi.mock('../api', () => ({
  fetchChannels: vi.fn(),
  getSession: vi.fn(),
  api: vi.fn(),
}));

afterEach(() => vi.clearAllMocks());

describe('channel configuration reload', () => {
  it('reloads saved names and logos even when the source configuration is unchanged', async () => {
    let draft: UserData = {
      presets: [],
      sortCriteria: { global: [] },
      formatter: { id: 'gdrive' },
      checkOwned: true,
      channelMappings: [],
    };
    vi.mocked(fetchChannels).mockImplementation(async (userData) => ({
      channels: [
        {
          id: 'bbc',
          name: userData.channelMappings?.[0]?.name ?? 'BBC News',
          poster:
            userData.channelMappings?.[0]?.poster ??
            'https://example.com/original.png',
          canonicalAddonId: 'guide',
          enabled: true,
          mappings: [],
        },
      ],
      sources: [],
      unmatchedStreams: [],
      unavailableStreams: [],
      duplicates: [],
      removedChannels: [],
    }));
    const client = new QueryClient();
    try {
      await client.fetchQuery(channelsQuery('same-sources', () => draft));
      expect(fetchChannels).toHaveBeenLastCalledWith(
        draft,
        expect.objectContaining({
          autoMatch: true,
          signal: expect.any(AbortSignal),
        })
      );
      draft = JSON.parse(
        JSON.stringify({
          ...draft,
          channelMappings: [
            {
              id: 'bbc',
              name: 'My BBC',
              poster: 'https://example.com/custom.png',
            },
          ],
        })
      ) as UserData;

      const result = await client.fetchQuery(
        channelsQuery('same-sources', () => draft)
      );

      expect(fetchChannels).toHaveBeenCalledTimes(2);
      expect(result.channels[0]).toMatchObject({
        name: 'My BBC',
        poster: 'https://example.com/custom.png',
      });
    } finally {
      client.clear();
    }
  });
});

describe('manual channel alternatives', () => {
  it.each([false, true])(
    'preserves results with truncated=%s',
    async (truncated) => {
      const sources = [
        { addonId: 'streams', channelId: 'agro', name: 'AgroBrasil' },
      ];
      vi.mocked(fetchChannels).mockResolvedValue({
        channels: [{ id: 'agro', availableStreamSources: sources }],
        sources: [
          {
            name: 'Streams',
            ok: !truncated,
            truncated,
            error: truncated ? 'Timed out' : undefined,
          },
        ],
        scan: { truncated },
      } as ChannelsResponse);
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      try {
        const result = await client.fetchQuery(
          channelAlternativesQuery(
            'config',
            'agro',
            'guide',
            () => ({}) as UserData
          )
        );
        expect(result.sources).toEqual(sources);
        if (truncated) expect(result.warning).toContain('Timed out');
        else expect(result.warning).toBeUndefined();
      } finally {
        client.clear();
      }
    }
  );
});
