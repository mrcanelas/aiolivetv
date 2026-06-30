import React from 'react';
import { BiRefresh } from 'react-icons/bi';
import {
  LuArrowDownAZ,
  LuLayers,
  LuPower,
  LuPowerOff,
  LuSquareCheck,
  LuTrash2,
} from 'react-icons/lu';
import { SearchIcon } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageControls } from '@/components/shared/page-controls';
import { PageWrapper } from '@/components/shared/page-wrapper';
import { SettingsCard } from '@/components/shared/settings-card';
import { IconButton } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { TextInput } from '@/components/ui/text-input';
import { useUserData } from '@/context/userData';
import { useDisclosure } from '@/hooks/disclosure';
import { fetchChannels, type ChannelInfo } from '@/lib/api';
import { ChannelEditModal } from './_components/channel-edit-modal';
import { ChannelListItem } from './_components/channel-list-item';
import { ChannelMappingModal } from './_components/channel-mapping-modal';
import {
  type ChannelSortMode,
  countSuggestions,
  isChannelSuggestion,
  isManualStreamMapping,
  buildManualStreamChannelId,
  sortChannels,
  groupChannelsBySource,
  MANUAL_STREAM_ADDON_ID,
} from './utils';

export function ChannelsMenu() {
  const { userData, setUserData } = useUserData();
  const [search, setSearch] = React.useState('');
  const [sortMode, setSortMode] =
    React.useState<ChannelSortMode>('alphabetical');
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [linkStreamTargets, setLinkStreamTargets] = React.useState<
    Record<string, string>
  >({});
  const [customizedIds, setCustomizedIds] = React.useState<Set<string>>(
    new Set()
  );
  const [mappingChannelId, setMappingChannelId] = React.useState<string | null>(
    null
  );
  const [editChannelId, setEditChannelId] = React.useState<string | null>(null);
  const mappingModal = useDisclosure(false);
  const editModal = useDisclosure(false);
  const queryClient = useQueryClient();
  const userDataRef = React.useRef(userData);
  userDataRef.current = userData;
  const channelsConfigKey = JSON.stringify({
    presets: userData.presets,
    services: userData.services,
    parentConfig: userData.parentConfig,
  });
  const queryKey = ['channels', channelsConfigKey] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => fetchChannels(userDataRef.current),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const channels = query.data ?? [];
  const isInitialLoading = query.isPending && channels.length === 0;
  const suggestionCount = countSuggestions(channels);

  const buildVisibleMappings = React.useCallback(
    (
      nextChannels: ChannelInfo[],
      currentMappings: typeof userData.channelMappings
    ) =>
      nextChannels
        .map((channel) => {
          const existing = currentMappings?.find(
            (mapping) => mapping.id === channel.id
          );
          const customized =
            customizedIds.has(channel.id) || existing?.name || existing?.poster;
          return {
            id: channel.id,
            canonicalAddonId: channel.canonicalAddonId,
            enabled: channel.enabled,
            ...(customized
              ? {
                  name: channel.name,
                  poster: channel.poster ?? undefined,
                }
              : {}),
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
                ...(mapping.url
                  ? { url: mapping.url, name: mapping.name }
                  : {}),
              })),
          };
        })
        .filter(
          (channel) =>
            channel.streams.length > 0 ||
            (channel.rejectedStreams?.length ?? 0) > 0 ||
            customizedIds.has(channel.id)
        ),
    [customizedIds]
  );

  const persistChannels = React.useCallback(
    (nextChannels: ChannelInfo[]) => {
      setUserData((current) => {
        const visibleMappings = buildVisibleMappings(
          nextChannels,
          current.channelMappings
        );
        const hidden = (current.channelMappings ?? []).filter(
          (mapping) =>
            mapping.hidden &&
            !visibleMappings.some((item) => item.id === mapping.id)
        );
        const channelMappings = [...visibleMappings, ...hidden];
        if (
          JSON.stringify(current.channelMappings ?? []) ===
          JSON.stringify(channelMappings)
        ) {
          return current;
        }
        return { ...current, channelMappings };
      });
    },
    [buildVisibleMappings, setUserData]
  );

  const setChannels = (update: (channels: ChannelInfo[]) => ChannelInfo[]) => {
    const next = update(
      queryClient.getQueryData<ChannelInfo[]>(queryKey) ?? []
    );
    queryClient.setQueryData(queryKey, next);
    persistChannels(next);
  };

  const acceptSuggestion = (
    channelId: string,
    addonId: string,
    streamChannelId: string
  ) => {
    setChannels((current) =>
      current.map((channel) =>
        channel.id === channelId
          ? {
              ...channel,
              mappings: channel.mappings.map((mapping) =>
                mapping.addonId === addonId &&
                mapping.channelId === streamChannelId
                  ? { ...mapping, confidence: 1 }
                  : mapping
              ),
            }
          : channel
      )
    );
  };

  const rejectSuggestion = (
    channelId: string,
    addonId: string,
    streamChannelId: string
  ) => {
    setChannels((current) =>
      current.map((channel) => {
        if (channel.id !== channelId) return channel;
        const mapping = channel.mappings.find(
          (item) =>
            item.addonId === addonId && item.channelId === streamChannelId
        );
        if (!mapping) return channel;
        return {
          ...channel,
          mappings: channel.mappings.filter(
            (item) =>
              !(item.addonId === addonId && item.channelId === streamChannelId)
          ),
          rejectedStreams: [
            ...(channel.rejectedStreams ?? []),
            { addonId, channelId: mapping.channelId },
          ],
        };
      })
    );
  };

  const acceptAllSuggestions = (channelId: string) => {
    setChannels((current) =>
      current.map((channel) =>
        channel.id === channelId
          ? {
              ...channel,
              mappings: channel.mappings.map((mapping) =>
                isChannelSuggestion(mapping.confidence)
                  ? { ...mapping, confidence: 1 }
                  : mapping
              ),
            }
          : channel
      )
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

  const splitMapping = (
    channelId: string,
    addonId: string,
    streamChannelId: string
  ) => {
    setChannels((current) => {
      const channel = current.find((item) => item.id === channelId);
      const mapping = channel?.mappings.find(
        (item) => item.addonId === addonId && item.channelId === streamChannelId
      );
      if (!channel || !mapping || channel.mappings.length === 1) return current;
      if (isManualStreamMapping(mapping)) {
        return current.map((item) =>
          item.id === channelId
            ? {
                ...item,
                mappings: item.mappings.filter(
                  (candidate) =>
                    !(
                      candidate.addonId === addonId &&
                      candidate.channelId === streamChannelId
                    )
                ),
              }
            : item
        );
      }
      return [
        ...current.map((item) =>
          item.id === channelId
            ? {
                ...item,
                mappings: item.mappings.filter(
                  (candidate) =>
                    !(
                      candidate.addonId === addonId &&
                      candidate.channelId === streamChannelId
                    )
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

  const linkStreamSource = (channelId: string) => {
    const sourceKey = linkStreamTargets[channelId];
    if (!sourceKey) return;
    const [addonId, streamChannelId] = sourceKey.split(':', 2);
    if (!addonId || !streamChannelId) return;
    setChannels((current) =>
      current.map((channel) => {
        if (channel.id !== channelId) return channel;
        const source = channel.availableStreamSources?.find(
          (item) =>
            item.addonId === addonId && item.channelId === streamChannelId
        );
        if (!source) return channel;
        return {
          ...channel,
          mappings: [
            ...channel.mappings,
            {
              id: source.channelId,
              addonId: source.addonId,
              addonName: source.addonName,
              channelId: source.channelId,
              name: source.name,
              poster: source.poster,
              confidence: 0,
              enabled: true,
              epgProvider: false,
              canStream: true,
            },
          ],
          availableStreamSources: channel.availableStreamSources?.filter(
            (item) =>
              !(item.addonId === addonId && item.channelId === streamChannelId)
          ),
        };
      })
    );
    setLinkStreamTargets((current) => ({ ...current, [channelId]: '' }));
  };

  const addManualStream = (channelId: string, url: string, name: string) => {
    const streamChannelId = buildManualStreamChannelId(url);
    setChannels((current) =>
      current.map((channel) => {
        if (channel.id !== channelId) return channel;
        if (
          channel.mappings.some(
            (mapping) => isManualStreamMapping(mapping) && mapping.url === url
          )
        ) {
          return channel;
        }
        return {
          ...channel,
          mappings: [
            ...channel.mappings,
            {
              id: streamChannelId,
              addonId: MANUAL_STREAM_ADDON_ID,
              addonName: 'Manual HLS',
              channelId: streamChannelId,
              name,
              url,
              poster: null,
              confidence: 0,
              enabled: true,
              epgProvider: false,
              canStream: true,
            },
          ],
        };
      })
    );
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

  const removeChannels = (channelIds: Iterable<string>) => {
    const ids = new Set(channelIds);
    const nextChannels = channels.filter((channel) => !ids.has(channel.id));
    queryClient.setQueryData(queryKey, nextChannels);
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of ids) next.delete(id);
      return next;
    });
    setUserData((current) => {
      const visibleMappings = buildVisibleMappings(
        nextChannels,
        current.channelMappings
      );
      const hidden = [
        ...(current.channelMappings ?? []).filter(
          (mapping) => mapping.hidden && !ids.has(mapping.id)
        ),
        ...[...ids].map((id) => ({
          id,
          hidden: true as const,
          enabled: false,
        })),
      ];
      return { ...current, channelMappings: [...visibleMappings, ...hidden] };
    });
  };

  const removeChannel = (channelId: string) => {
    removeChannels([channelId]);
  };

  const saveChannelEdit = (channelId: string, name: string, poster: string) => {
    setCustomizedIds((current) => new Set(current).add(channelId));
    updateChannel(channelId, (channel) => ({
      ...channel,
      name,
      poster: poster || null,
    }));
  };

  const filteredChannels = sortChannels(
    channels.filter((channel) =>
      channel.name.toLowerCase().includes(search.trim().toLowerCase())
    ),
    sortMode
  );
  const groupedChannels =
    sortMode === 'source' ? groupChannelsBySource(filteredChannels) : null;
  const visibleIds = filteredChannels.map((channel) => channel.id);
  const isAllSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const hasSelection = selectedIds.size > 0;
  const selectedChannels = channels.filter((channel) =>
    selectedIds.has(channel.id)
  );
  const toggleWillEnable = selectedChannels.some((channel) => !channel.enabled);
  const mappingChannel =
    channels.find((channel) => channel.id === mappingChannelId) ?? null;
  const editChannel =
    channels.find((channel) => channel.id === editChannelId) ?? null;

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(visibleIds));
  };

  const toggleSelection = (channelId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(channelId)) next.delete(channelId);
      else next.add(channelId);
      return next;
    });
  };

  const batchToggleEnabled = () => {
    const nextValue = toggleWillEnable;
    setChannels((current) =>
      current.map((channel) =>
        selectedIds.has(channel.id)
          ? { ...channel, enabled: nextValue }
          : channel
      )
    );
  };

  const batchRemove = () => {
    removeChannels(selectedIds);
    setSelectedIds(new Set());
  };

  const openMappings = (channelId: string) => {
    setMappingChannelId(channelId);
    mappingModal.open();
  };

  const openEdit = (channelId: string) => {
    setEditChannelId(channelId);
    editModal.open();
  };

  const renderChannel = (channel: ChannelInfo) => (
    <ChannelListItem
      key={channel.id}
      channel={channel}
      isSelected={selectedIds.has(channel.id)}
      onToggleSelect={() => toggleSelection(channel.id)}
      onToggleEnabled={(enabled) => {
        updateChannel(channel.id, (item) => ({ ...item, enabled }));
      }}
      onOpenMappings={() => openMappings(channel.id)}
      onEdit={() => openEdit(channel.id)}
      onRemove={() => removeChannel(channel.id)}
    />
  );

  return (
    <PageWrapper className="space-y-4 p-4 sm:p-8">
      <div className="flex w-full items-center">
        <div>
          <h2>Channels</h2>
          <p className="text-[--muted]">
            Review channels and their live stream mappings. Suggestions stay in
            draft until you accept them.
          </p>
        </div>
        <div className="hidden lg:ml-auto lg:block">
          <PageControls />
        </div>
      </div>

      <SettingsCard
        title="My Channels"
        description="Manage merged channels, review mappings, and control stream priority."
        action={
          <div className="flex items-center gap-2">
            <IconButton
              rounded
              intent={sortMode === 'source' ? 'primary' : 'primary-subtle'}
              icon={<LuLayers className="h-5 w-5" />}
              onClick={() => setSortMode('source')}
              disabled={channels.length === 0}
              title="Group by source"
            />
            <IconButton
              rounded
              intent={
                sortMode === 'alphabetical' ? 'primary' : 'primary-subtle'
              }
              icon={<LuArrowDownAZ className="h-5 w-5" />}
              onClick={() => setSortMode('alphabetical')}
              disabled={channels.length === 0}
              title="Sort alphabetically"
            />
            <IconButton
              rounded
              intent={isAllSelected ? 'primary' : 'primary-subtle'}
              icon={<LuSquareCheck className="h-5 w-5" />}
              onClick={toggleSelectAll}
              disabled={filteredChannels.length === 0}
              title={isAllSelected ? 'Deselect all' : 'Select all'}
            />
            <IconButton
              rounded
              intent="primary-subtle"
              icon={<BiRefresh className="h-5 w-5" />}
              onClick={() => query.refetch()}
              disabled={query.isFetching}
              title="Refresh channels"
            />
          </div>
        }
      >
        {channels.length > 0 ? (
          <div className="mb-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-[140px] flex-1">
                <TextInput
                  value={search}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setSearch(e.target.value)
                  }
                  placeholder="Search channels..."
                  leftIcon={<SearchIcon className="h-4 w-4" />}
                  aria-label="Search channels"
                />
              </div>
              {hasSelection ? (
                <div className="flex animate-in fade-in items-center gap-1.5 duration-150">
                  <span className="whitespace-nowrap text-xs font-semibold text-[--brand]">
                    {selectedIds.size} selected
                  </span>
                  <IconButton
                    size="sm"
                    rounded
                    intent="primary-subtle"
                    icon={
                      toggleWillEnable ? (
                        <LuPower className="h-3.5 w-3.5" />
                      ) : (
                        <LuPowerOff className="h-3.5 w-3.5" />
                      )
                    }
                    onClick={batchToggleEnabled}
                    title={
                      toggleWillEnable ? 'Enable selected' : 'Disable selected'
                    }
                  />
                  <IconButton
                    size="sm"
                    rounded
                    intent="alert-subtle"
                    icon={<LuTrash2 className="h-3.5 w-3.5" />}
                    onClick={batchRemove}
                    title="Remove selected"
                  />
                </div>
              ) : null}
            </div>
            {suggestionCount > 0 ? (
              <p className="text-xs text-amber-400">
                {suggestionCount} mapping suggestion
                {suggestionCount === 1 ? '' : 's'} pending review across all
                channels.
              </p>
            ) : null}
          </div>
        ) : null}

        {isInitialLoading ? (
          <div className="flex justify-center py-16">
            <LoadingSpinner />
          </div>
        ) : query.error ? (
          <p className="py-8 text-center text-red-400">{query.error.message}</p>
        ) : filteredChannels.length === 0 ? (
          <p className="py-8 text-center text-[--muted]">
            {channels.length === 0
              ? 'Add a Live TV addon, XMLTV guide, or M3U playlist on the Addons page.'
              : 'No channels match your search.'}
          </p>
        ) : groupedChannels ? (
          <div className="space-y-5">
            {groupedChannels.map(([source, sourceChannels]) => (
              <div key={source} className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <span className="h-2 w-2 rounded-full bg-blue-500" />
                  <p className="text-xs font-semibold uppercase tracking-widest text-[--muted]">
                    {source} ({sourceChannels.length})
                  </p>
                </div>
                <ul className="space-y-2">
                  {sourceChannels.map(renderChannel)}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <ul className="space-y-2">{filteredChannels.map(renderChannel)}</ul>
        )}
      </SettingsCard>

      <ChannelMappingModal
        channel={mappingChannel}
        open={mappingModal.isOpen}
        onOpenChange={(open) => {
          if (open) mappingModal.open();
          else {
            mappingModal.close();
            setMappingChannelId(null);
          }
        }}
        linkStreamTarget={
          mappingChannelId ? (linkStreamTargets[mappingChannelId] ?? '') : ''
        }
        onLinkStreamTargetChange={(value) => {
          if (!mappingChannelId) return;
          setLinkStreamTargets((current) => ({
            ...current,
            [mappingChannelId]: value,
          }));
        }}
        onAcceptSuggestion={(addonId, streamChannelId) => {
          if (!mappingChannelId) return;
          acceptSuggestion(mappingChannelId, addonId, streamChannelId);
        }}
        onRejectSuggestion={(addonId, streamChannelId) => {
          if (!mappingChannelId) return;
          rejectSuggestion(mappingChannelId, addonId, streamChannelId);
        }}
        onAcceptAllSuggestions={() => {
          if (!mappingChannelId) return;
          acceptAllSuggestions(mappingChannelId);
        }}
        onMoveMapping={(index, direction) => {
          if (!mappingChannelId) return;
          moveMapping(mappingChannelId, index, direction);
        }}
        onSplitMapping={(addonId, streamChannelId) => {
          if (!mappingChannelId) return;
          splitMapping(mappingChannelId, addonId, streamChannelId);
        }}
        onLinkStreamSource={() => {
          if (!mappingChannelId) return;
          linkStreamSource(mappingChannelId);
        }}
        onAddManualStream={(url, name) => {
          if (!mappingChannelId) return;
          addManualStream(mappingChannelId, url, name);
        }}
        onSetCanonical={(addonId) => {
          if (!mappingChannelId) return;
          setCanonical(mappingChannelId, addonId);
        }}
        onToggleStream={(addonId, enabled, streamChannelId) => {
          if (!mappingChannelId) return;
          updateChannel(mappingChannelId, (item) => ({
            ...item,
            mappings: item.mappings.map((candidate) =>
              candidate.addonId === addonId &&
              candidate.channelId === streamChannelId
                ? { ...candidate, enabled }
                : candidate
            ),
          }));
        }}
      />

      <ChannelEditModal
        channel={editChannel}
        open={editModal.isOpen}
        onOpenChange={(open) => {
          if (open) editModal.open();
          else {
            editModal.close();
            setEditChannelId(null);
          }
        }}
        onSave={saveChannelEdit}
      />
    </PageWrapper>
  );
}
