import React from 'react';
import {
  BiCheck,
  BiChevronDown,
  BiChevronUp,
  BiLink,
  BiPlus,
  BiUnlink,
  BiX,
} from 'react-icons/bi';
import { SearchIcon } from 'lucide-react';
import { Modal } from '../../../ui/modal';
import { Button } from '../../../ui/button';
import { Combobox } from '../../../ui/combobox';
import { Switch } from '../../../ui/switch';
import { TextInput } from '../../../ui/text-input';
import type { ChannelInfo } from '@/lib/api';
import {
  isChannelSuggestion,
  isManualStreamMapping,
  isValidStreamUrl,
} from '../utils';

function streamSourceKey(addonId: string, channelId: string) {
  return `${addonId}:${channelId}`;
}

type ChannelMappingModalProps = {
  channel: ChannelInfo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linkStreamTarget: string;
  onLinkStreamTargetChange: (value: string) => void;
  onAcceptSuggestion: (addonId: string, streamChannelId: string) => void;
  onRejectSuggestion: (addonId: string, streamChannelId: string) => void;
  onAcceptAllSuggestions: () => void;
  onMoveMapping: (index: number, direction: -1 | 1) => void;
  onSplitMapping: (addonId: string, streamChannelId: string) => void;
  onLinkStreamSource: () => void;
  onAddManualStream: (url: string, name: string) => void;
  onSetCanonical: (addonId: string) => void;
  onToggleStream: (
    addonId: string,
    enabled: boolean,
    streamChannelId: string
  ) => void;
};

export function ChannelMappingModal({
  channel,
  open,
  onOpenChange,
  linkStreamTarget,
  onLinkStreamTargetChange,
  onAcceptSuggestion,
  onRejectSuggestion,
  onAcceptAllSuggestions,
  onMoveMapping,
  onSplitMapping,
  onLinkStreamSource,
  onAddManualStream,
  onSetCanonical,
  onToggleStream,
}: ChannelMappingModalProps) {
  const [manualUrl, setManualUrl] = React.useState('');
  const [manualName, setManualName] = React.useState('');

  React.useEffect(() => {
    if (!open) {
      setManualUrl('');
      setManualName('');
    }
  }, [open]);

  if (!channel) return null;

  const pendingCount = channel.mappings.filter((mapping) =>
    isChannelSuggestion(mapping.confidence)
  ).length;

  const streamSourceOptions =
    channel.availableStreamSources?.map((source) => ({
      value: streamSourceKey(source.addonId, source.channelId),
      label: `${source.addonName} · ${source.name}`,
      textValue: `${source.addonName} ${source.name}`,
    })) ?? [];

  const handleAddManualStream = () => {
    const url = manualUrl.trim();
    if (!isValidStreamUrl(url)) return;
    onAddManualStream(url, manualName.trim() || 'Manual HLS');
    setManualUrl('');
    setManualName('');
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={channel.name}
      description="Review stream mappings and suggestions for this channel."
    >
      <div className="space-y-4">
        {pendingCount > 0 ? (
          <div className="flex items-center justify-between gap-3 rounded border border-amber-500/40 bg-amber-500/5 p-3">
            <p className="text-sm text-amber-300">
              {pendingCount} suggestion{pendingCount === 1 ? '' : 's'} pending
              review
            </p>
            <Button
              size="sm"
              leftIcon={<BiCheck />}
              onClick={onAcceptAllSuggestions}
            >
              Accept all
            </Button>
          </div>
        ) : null}

        {streamSourceOptions.length > 0 ? (
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Combobox
                label="Link stream source"
                placeholder="Search stream channels..."
                value={linkStreamTarget ? [linkStreamTarget] : []}
                onValueChange={(value) =>
                  onLinkStreamTargetChange(value[value.length - 1] ?? '')
                }
                options={streamSourceOptions}
                emptyMessage="No matching stream channels"
                leftIcon={<SearchIcon className="h-4 w-4" />}
                keepOpenOnSelect={false}
              />
            </div>
            <Button
              size="sm"
              leftIcon={<BiLink />}
              disabled={!linkStreamTarget}
              onClick={onLinkStreamSource}
            >
              Link
            </Button>
          </div>
        ) : (
          <p className="text-xs text-[--muted]">
            No unlinked stream channels available. Add a stream addon such as
            FrostView TV or M3U, or add a manual HLS link below.
          </p>
        )}

        <div className="space-y-3 rounded border border-[--border] p-3">
          <p className="text-sm font-medium">Manual HLS link</p>
          <TextInput
            label="Stream URL"
            placeholder="https://example.com/stream.m3u8"
            value={manualUrl}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setManualUrl(e.target.value)
            }
          />
          <TextInput
            label="Label"
            placeholder="Manual HLS"
            value={manualName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setManualName(e.target.value)
            }
          />
          <Button
            size="sm"
            leftIcon={<BiPlus />}
            disabled={!isValidStreamUrl(manualUrl)}
            onClick={handleAddManualStream}
          >
            Add HLS link
          </Button>
        </div>

        <div className="space-y-2">
          {channel.mappings.length === 0 ? (
            <p className="rounded border border-[--border] p-3 text-sm text-[--muted]">
              No stream sources linked yet.
            </p>
          ) : null}
          {channel.mappings.map((mapping, index) => {
            const suggestion = isChannelSuggestion(mapping.confidence);
            const manual = isManualStreamMapping(mapping);
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
                    {manual ? (
                      <span className="ml-2 text-xs text-purple-400">
                        Manual HLS
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
                  <p className="truncate text-xs text-[--muted]">
                    {manual ? mapping.url : mapping.name} ·{' '}
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
                          onAcceptSuggestion(
                            mapping.addonId,
                            mapping.channelId
                          )
                        }
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        leftIcon={<BiX />}
                        onClick={() =>
                          onRejectSuggestion(
                            mapping.addonId,
                            mapping.channelId
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
                        onClick={() => onMoveMapping(index, -1)}
                      >
                        <BiChevronUp />
                      </Button>
                      <Button
                        size="sm"
                        aria-label={`Move ${mapping.addonName} down`}
                        disabled={index === channel.mappings.length - 1}
                        onClick={() => onMoveMapping(index, 1)}
                      >
                        <BiChevronDown />
                      </Button>
                      {!manual &&
                      mapping.addonId !== channel.canonicalAddonId ? (
                        <Button
                          size="sm"
                          onClick={() => onSetCanonical(mapping.addonId)}
                        >
                          Canonical
                        </Button>
                      ) : null}
                      {channel.mappings.length > 1 &&
                      !manual &&
                      mapping.addonId !== channel.canonicalAddonId ? (
                        <Button
                          size="sm"
                          aria-label={`Split mapping from ${mapping.addonName}`}
                          leftIcon={<BiUnlink />}
                          onClick={() =>
                            onSplitMapping(
                              mapping.addonId,
                              mapping.channelId
                            )
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
                    onValueChange={(enabled) =>
                      onToggleStream(
                        mapping.addonId,
                        enabled,
                        mapping.channelId
                      )
                    }
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
