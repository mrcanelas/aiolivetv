import { queryOptions } from '@tanstack/react-query';
import { getSession, api, fetchChannels } from './api';
import type { StatusResponse, UserData } from '@aiolivetv/core';

export const sessionQuery = queryOptions({
  queryKey: ['session'] as const,
  queryFn: getSession,
  staleTime: 60_000,
  retry: false,
});

export const statusQuery = queryOptions({
  queryKey: ['status'] as const,
  queryFn: () => api<StatusResponse>('/status'),
  staleTime: 60_000,
  retry: false,
});

export function channelsQuery(configKey: string, getDraft: () => UserData) {
  return queryOptions({
    queryKey: ['channels', configKey] as const,
    queryFn: ({ signal }) =>
      fetchChannels(getDraft(), { autoMatch: false, signal }),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function channelAlternativesQuery(
  configKey: string,
  channelId: string | null,
  canonicalAddonId: string | undefined,
  getDraft: () => UserData
) {
  return queryOptions({
    queryKey: ['channel-alternatives', configKey, channelId, canonicalAddonId],
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      if (!channelId) throw new Error('No channel selected');
      const response = await fetchChannels(getDraft(), {
        signal,
        alternativesFor: channelId,
      });
      if (response.scan?.truncated) {
        const source = response.sources.find((item) => item.truncated);
        throw new Error(
          source?.error ??
            'Source scan stopped before completing. Please retry.'
        );
      }
      return (
        response.channels.find((channel) => channel.id === channelId)
          ?.availableStreamSources ?? []
      );
    },
  });
}
