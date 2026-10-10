import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { UserData } from '@aiolivetv/core';
import type { ChannelsResponse } from '../api';
import { fetchChannels } from '../api';
import { channelAlternativesQuery } from '../queries';

vi.mock('../api', () => ({
  fetchChannels: vi.fn(),
  getSession: vi.fn(),
  api: vi.fn(),
}));

afterEach(() => vi.clearAllMocks());

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
