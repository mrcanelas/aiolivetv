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
    staleTime: 0,
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
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      if (!channelId) throw new Error('No channel selected');
      const response = await fetchChannels(getDraft(), {
        signal,
        alternativesFor: channelId,
      });
      const problems = response.sources.filter(
        (source) => !source.ok || source.truncated
      );
      return {
        sources:
          response.channels.find((channel) => channel.id === channelId)
            ?.availableStreamSources ?? [],
        warning:
          problems.length > 0 || response.scan?.truncated
            ? `Some stream channels could not be loaded. ${
                problems
                  .map(
                    (source) => source.error ?? `${source.name}: stopped early`
                  )
                  .join(' · ') || 'Source scan stopped before completing.'
              }`
            : undefined,
      };
    },
    staleTime: (query) => (query.state.data?.warning ? 0 : Infinity),
  });
}
