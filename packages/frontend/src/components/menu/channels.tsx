import React from 'react';
import { BiRefresh, BiSearch } from 'react-icons/bi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageControls } from '../shared/page-controls';
import { PageWrapper } from '../shared/page-wrapper';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { LoadingSpinner } from '../ui/loading-spinner';
import { Switch } from '../ui/switch';
import { TextInput } from '../ui/text-input';
import { useUserData } from '@/context/userData';
import { fetchChannels, type ChannelInfo } from '@/lib/api';

export function ChannelsMenu() {
  const { userData, setUserData } = useUserData();
  const [search, setSearch] = React.useState('');
  const queryClient = useQueryClient();
  const queryKey = [
    'channels',
    JSON.stringify({
      presets: userData.presets,
      services: userData.services,
      parentConfig: userData.parentConfig,
    }),
  ] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => fetchChannels(userData),
    staleTime: Infinity,
  });
  const channels = query.data ?? [];
  const setChannels = (update: (channels: ChannelInfo[]) => ChannelInfo[]) =>
    queryClient.setQueryData<ChannelInfo[]>(queryKey, (current) =>
      update(current ?? [])
    );

  const updateMapping = (
    channelId: string,
    update: (
      channel: NonNullable<typeof userData.channelMappings>[number]
    ) => void
  ) => {
    setUserData((current) => {
      const mappings = structuredClone(current.channelMappings ?? []);
      let channel = mappings.find((item) => item.id === channelId);
      if (!channel) {
        channel = { id: channelId, streams: [] };
        mappings.push(channel);
      }
      update(channel);
      return { ...current, channelMappings: mappings };
    });
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
            Review channels and their live stream mappings.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
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
            Add an XMLTV metadata source and an M3U stream source on the Addons
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
                        {channel.mappings.length} mapping
                        {channel.mappings.length === 1 ? '' : 's'}
                      </p>
                    </div>
                    <Switch
                      aria-label={`Enable ${channel.name}`}
                      value={channel.enabled}
                      onValueChange={(enabled) => {
                        setChannels((current) =>
                          current.map((item) =>
                            item.id === channel.id ? { ...item, enabled } : item
                          )
                        );
                        updateMapping(channel.id, (item) => {
                          item.enabled = enabled;
                        });
                      }}
                    />
                  </div>

                  {channel.mappings.map((mapping) => (
                    <div
                      key={mapping.addonId}
                      className="flex items-center gap-3 rounded border border-[--border] p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{mapping.addonName}</p>
                        <p className="text-xs text-[--muted]">
                          {mapping.count} stream{mapping.count === 1 ? '' : 's'}
                        </p>
                      </div>
                      <Switch
                        aria-label={`Enable ${mapping.addonName} for ${channel.name}`}
                        value={mapping.enabled}
                        disabled={!channel.enabled}
                        onValueChange={(enabled) => {
                          setChannels((current) =>
                            current.map((item) =>
                              item.id !== channel.id
                                ? item
                                : {
                                    ...item,
                                    mappings: item.mappings.map((candidate) =>
                                      candidate.addonId === mapping.addonId
                                        ? { ...candidate, enabled }
                                        : candidate
                                    ),
                                  }
                            )
                          );
                          updateMapping(channel.id, (item) => {
                            item.streams ??= [];
                            const stream = item.streams.find(
                              (candidate) =>
                                candidate.addonId === mapping.addonId
                            );
                            if (stream) stream.enabled = enabled;
                            else
                              item.streams.push({
                                addonId: mapping.addonId,
                                enabled,
                              });
                          });
                        }}
                      />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageWrapper>
  );
}
