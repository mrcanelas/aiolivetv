import React from 'react';
import {
  BiCheck,
  BiChevronDown,
  BiChevronUp,
  BiGitMerge,
  BiRefresh,
  BiSearch,
  BiUnlink,
  BiX,
} from 'react-icons/bi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageControls } from '../shared/page-controls';
import { PageWrapper } from '../shared/page-wrapper';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { LoadingSpinner } from '../ui/loading-spinner';
import { Select } from '../ui/select';
import { Switch } from '../ui/switch';
import { TextInput } from '../ui/text-input';
import { useUserData } from '@/context/userData';
import { fetchChannels, type ChannelInfo } from '@/lib/api';

function isChannelSuggestion(confidence: number) {
  return confidence > 0 && confidence < 1;
}

function countSuggestions(channels: ChannelInfo[]) {
  return channels.reduce(
    (total, channel) =>
      total +
      channel.mappings.filter((mapping) =>
        isChannelSuggestion(mapping.confidence)
      ).length,
    0
  );
}

export function ChannelsMenu() {
  const { userData, setUserData } = useUserData();
  const [search, setSearch] = React.useState('');
  const [mergeTargets, setMergeTargets] = React.useState<
    Record<string, string>
  >({});
  const queryClient = useQueryClient();
  const queryKey = [
    'channels',
    JSON.stringify({
      presets: userData.presets,
      services: userData.services,
      parentConfig: userData.parentConfig,
      channelMappings: userData.channelMappings,
    }),
  ] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => fetchChannels(userData),
    staleTime: Infinity,
  });
  const channels = query.data ?? [];
  const suggestionCount = countSuggestions(channels);

  const persistChannels = React.useCallback(
    (channels: ChannelInfo[]) => {
      const channelMappings = channels
        .map((channel) => ({
          id: channel.id,
          canonicalAddonId: channel.canonicalAddonId,
          enabled: channel.enabled,
          rejectedStreams: channel.rejectedStreams?.length
            ? channel.rejectedStreams
            : undefined,
          streams: channel.mappings
            .filter((mapping) => !isChannelSuggestion(mapping.confidence))
            .map((mapping) => ({
              addonId: mapping.addonId,
              channelId: mapping.channelId,
              confidence: mapping.confidence,
              enabled: mapping.enabled,
            })),
        }))
        .filter(
          (channel) =>
            channel.streams.length > 0 ||
            (channel.rejectedStreams?.length ?? 0) > 0
        );
      setUserData((current) => {
        if (
          JSON.stringify(current.channelMappings ?? []) ===
          JSON.stringify(channelMappings)
        )
          return current;
        return { ...current, channelMappings };
      });
    },
    [setUserData]
  );

  const setChannels = (update: (channels: ChannelInfo[]) => ChannelInfo[]) => {
    const channels = update(
      queryClient.getQueryData<ChannelInfo[]>(queryKey) ?? []
    );
    queryClient.setQueryData(queryKey, channels);
    persistChannels(channels);
  };

  const acceptSuggestion = (channelId: string, addonId: string) => {
    setChannels((current) =>
      current.map((channel) =>
        channel.id === channelId
          ? {
              ...channel,
              mappings: channel.mappings.map((mapping) =>
                mapping.addonId === addonId
                  ? { ...mapping, confidence: 1 }
                  : mapping
              ),
            }
          : channel
      )
    );
  };

  const rejectSuggestion = (channelId: string, addonId: string) => {
    setChannels((current) =>
      current.map((channel) => {
        if (channel.id !== channelId) return channel;
        const mapping = channel.mappings.find(
          (item) => item.addonId === addonId
        );
        if (!mapping) return channel;
        return {
          ...channel,
          mappings: channel.mappings.filter(
            (item) => item.addonId !== addonId
          ),
          rejectedStreams: [
            ...(channel.rejectedStreams ?? []),
            { addonId, channelId: mapping.channelId },
          ],
        };
      })
    );
  };

  const acceptAllSuggestions = () => {
    setChannels((current) =>
      current.map((channel) => ({
        ...channel,
        mappings: channel.mappings.map((mapping) =>
          isChannelSuggestion(mapping.confidence)
            ? { ...mapping, confidence: 1 }
            : mapping
        ),
      }))
    );
  };

  const moveMapping = (channelId: string, index: number, direction: -1 | 1) => {
    setChannels((current) =>
      current.map((channel) => {
        if (channel.id !== channelId) return channel;
        const target = index + direction;
        if (target < 0 || target >= channel.mappings.length) return channel;
        const mappings = [...channel.mappings];
        [mappings[index], mappings[target]] = [
          mappings[target],
          mappings[index],
        ];
        return { ...channel, mappings };
      })
    );
  };

  const splitMapping = (channelId: string, addonId: string) => {
    setChannels((current) => {
      const channel = current.find((item) => item.id === channelId);
      const mapping = channel?.mappings.find(
        (item) => item.addonId === addonId
      );
      if (!channel || !mapping || channel.mappings.length === 1) return current;
      return [
        ...current.map((item) =>
          item.id === channelId
            ? {
                ...item,
                mappings: item.mappings.filter(
                  (candidate) => candidate.addonId !== addonId
                ),
              }
            : item
        ),
        {
          id: mapping.channelId,
          name: mapping.name,
          poster: mapping.poster,
          canonicalAddonId: mapping.addonId,
          enabled: true,
          rejectedStreams: [],
          mappings: [{ ...mapping, confidence: 1 }],
        },
      ].sort((a, b) => a.name.localeCompare(b.name));
    });
  };

  const mergeChannel = (channelId: string) => {
    const targetId = mergeTargets[channelId];
    if (!targetId) return;
    setChannels((current) => {
      const target = current.find((item) => item.id === targetId);
      if (!target) return current;
      return current
        .filter((item) => item.id !== targetId)
        .map((item) =>
          item.id === channelId
            ? {
                ...item,
                mappings: [
                  ...item.mappings,
                  ...target.mappings.map((mapping) => ({
                    ...mapping,
                    confidence: 0,
                  })),
                ],
                rejectedStreams: [
                  ...(item.rejectedStreams ?? []),
                  ...(target.rejectedStreams ?? []),
                ],
              }
            : item
        );
    });
    setMergeTargets((current) => ({ ...current, [channelId]: '' }));
  };

  const setCanonical = (channelId: string, addonId: string) => {
    setChannels((current) =>
      current.map((channel) => {
        if (channel.id !== channelId) return channel;
        const mapping = channel.mappings.find(
          (candidate) => candidate.addonId === addonId
        );
        return mapping
          ? {
              ...channel,
              id: mapping.channelId,
              name: mapping.name,
              poster: mapping.poster,
              canonicalAddonId: mapping.addonId,
            }
          : channel;
      })
    );
  };

  const updateChannel = (
    channelId: string,
    update: (channel: ChannelInfo) => ChannelInfo
  ) => {
    setChannels((current) =>
      current.map((channel) =>
        channel.id === channelId ? update(channel) : channel
      )
    );
  };

  const visibleChannels = channels.filter((channel) =>
    channel.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <PageWrapper className="space-y-4 p-4 sm:p-8">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2>Channels</h2>
          <p className="text-[--muted]">
            Review channels and their live stream mappings. Suggestions stay in
            draft until you accept them.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {suggestionCount > 0 ? (
            <Button
              size="sm"
              onClick={acceptAllSuggestions}
              leftIcon={<BiCheck />}
            >
              Accept all ({suggestionCount})
            </Button>
          ) : null}
          <Button
            onClick={() => query.refetch()}
            disabled={query.isFetching}
            leftIcon={<BiRefresh />}
          >
            Refresh
          </Button>
          <div className="hidden lg:block">
            <PageControls />
          </div>
        </div>
      </div>

      <TextInput
        aria-label="Search channels"
        placeholder="Search channels"
        value={search}
        onValueChange={setSearch}
        leftIcon={<BiSearch />}
      />

      {query.isLoading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner />
        </div>
      ) : query.error ? (
        <Card>
          <CardContent className="p-6 text-center text-red-400">
            {query.error.message}
          </CardContent>
        </Card>
      ) : visibleChannels.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-[--muted]">
            Add a Live TV addon, XMLTV guide, or M3U playlist on the Addons
            page.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {visibleChannels.map((channel) => (
            <Card key={channel.id}>
              <CardContent className="flex gap-4 p-4">
                {channel.poster ? (
                  <img
                    src={channel.poster}
                    alt=""
                    className="h-16 w-16 rounded object-contain bg-black/20"
                  />
                ) : null}
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-semibold">{channel.name}</h3>
                      <p className="text-xs text-[--muted]">
                        {channel.mappings.length} source
                        {channel.mappings.length === 1 ? '' : 's'}
                        {channel.mappings.some((mapping) =>
                          isChannelSuggestion(mapping.confidence)
                        )
                          ? ' · pending suggestions'
                          : ''}
                      </p>
                    </div>
                    <Switch
                      aria-label={`Enable ${channel.name}`}
                      value={channel.enabled}
                      onValueChange={(enabled) => {
                        updateChannel(channel.id, (item) => ({
                          ...item,
                          enabled,
                        }));
                      }}
                    />
                  </div>

                  {channels.length > 1 ? (
                    <div className="flex items-end gap-2">
                      <div className="min-w-0 flex-1">
                        <Select
                          label="Manual mapping"
                          placeholder="Select a channel"
                          value={mergeTargets[channel.id]}
                          onValueChange={(value) =>
                            setMergeTargets((current) => ({
                              ...current,
                              [channel.id]: String(value ?? ''),
                            }))
                          }
                          options={channels
                            .filter(
                              (candidate) =>
                                candidate.id !== channel.id &&
                                !candidate.mappings.some((mapping) =>
                                  channel.mappings.some(
                                    (source) =>
                                      source.addonId === mapping.addonId
                                  )
                                )
                            )
                            .map((candidate) => ({
                              value: candidate.id,
                              label: candidate.name,
                            }))}
                        />
                      </div>
                      <Button
                        size="sm"
                        leftIcon={<BiGitMerge />}
                        disabled={!mergeTargets[channel.id]}
                        onClick={() => mergeChannel(channel.id)}
                      >
                        Merge
                      </Button>
                    </div>
                  ) : null}

                  {channel.mappings.map((mapping, index) => {
                    const suggestion = isChannelSuggestion(mapping.confidence);
                    return (
                      <div
                        key={`${mapping.addonId}:${mapping.channelId}`}
                        className={`flex items-center gap-3 rounded border p-3 ${
                          suggestion
                            ? 'border-amber-500/40 bg-amber-500/5'
                            : 'border-[--border]'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">
                            {mapping.addonName}
                            {mapping.addonId === channel.canonicalAddonId ? (
                              <span className="ml-2 text-xs text-blue-400">
                                Canonical
                              </span>
                            ) : null}
                            {mapping.epgProvider ? (
                              <span className="ml-2 text-xs text-emerald-400">
                                EPG
                              </span>
                            ) : null}
                            {suggestion ? (
                              <span className="ml-2 text-xs text-amber-400">
                                Suggested
                              </span>
                            ) : null}
                          </p>
                          <p className="text-xs text-[--muted]">
                            {mapping.name} ·{' '}
                            {mapping.confidence === 0
                              ? 'manual'
                              : suggestion
                                ? `${Math.round(mapping.confidence * 100)}% match`
                                : 'accepted'}
                            {mapping.canStream ? ' · streams' : ''}
                          </p>
                        </div>
                        <div className="flex flex-wrap justify-end gap-1">
                          {suggestion ? (
                            <>
                              <Button
                                size="sm"
                                leftIcon={<BiCheck />}
                                onClick={() =>
                                  acceptSuggestion(
                                    channel.id,
                                    mapping.addonId
                                  )
                                }
                              >
                                Accept
                              </Button>
                              <Button
                                size="sm"
                                leftIcon={<BiX />}
                                onClick={() =>
                                  rejectSuggestion(
                                    channel.id,
                                    mapping.addonId
                                  )
                                }
                              >
                                Reject
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                aria-label={`Move ${mapping.addonName} up`}
                                disabled={index === 0}
                                onClick={() =>
                                  moveMapping(channel.id, index, -1)
                                }
                              >
                                <BiChevronUp />
                              </Button>
                              <Button
                                size="sm"
                                aria-label={`Move ${mapping.addonName} down`}
                                disabled={
                                  index === channel.mappings.length - 1
                                }
                                onClick={() =>
                                  moveMapping(channel.id, index, 1)
                                }
                              >
                                <BiChevronDown />
                              </Button>
                              {mapping.addonId !== channel.canonicalAddonId ? (
                                <Button
                                  size="sm"
                                  onClick={() =>
                                    setCanonical(channel.id, mapping.addonId)
                                  }
                                >
                                  Canonical
                                </Button>
                              ) : null}
                              {channel.mappings.length > 1 &&
                              mapping.addonId !== channel.canonicalAddonId ? (
                                <Button
                                  size="sm"
                                  aria-label={`Split mapping from ${mapping.addonName}`}
                                  leftIcon={<BiUnlink />}
                                  onClick={() =>
                                    splitMapping(channel.id, mapping.addonId)
                                  }
                                >
                                  Split
                                </Button>
                              ) : null}
                            </>
                          )}
                        </div>
                        {mapping.canStream && !suggestion ? (
                          <Switch
                            aria-label={`Enable ${mapping.addonName} for ${channel.name}`}
                            value={mapping.enabled}
                            disabled={!channel.enabled}
                            onValueChange={(enabled) => {
                              updateChannel(channel.id, (item) => ({
                                ...item,
                                mappings: item.mappings.map((candidate) =>
                                  candidate.addonId === mapping.addonId
                                    ? { ...candidate, enabled }
                                    : candidate
                                ),
                              }));
                            }}
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageWrapper>
  );
}
