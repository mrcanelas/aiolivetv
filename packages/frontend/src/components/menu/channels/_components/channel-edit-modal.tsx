import React from 'react';
import { Modal } from '../../../ui/modal';
import { Button } from '../../../ui/button';
import { TextInput } from '../../../ui/text-input';
import { Select } from '../../../ui/select';
import { Combobox } from '../../../ui/combobox';
import type { ChannelInfo } from '@/lib/api';
import {
  normalizeChannelGroup,
  streamSourceKey,
  parseStreamSourceKey,
} from '../utils';

type ChannelEditModalProps = {
  channel: ChannelInfo | null;
  groups: string[];
  epgSources?: ChannelInfo['availableEpgSources'];
  loadingEpgSources?: boolean;
  epgSourcesError?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (
    channelId: string,
    name: string,
    poster: string,
    group: string,
    epgSource?: ChannelInfo['epgSource']
  ) => void;
};

export function ChannelEditModal({
  channel,
  groups,
  epgSources = [],
  loadingEpgSources = false,
  epgSourcesError,
  open,
  onOpenChange,
  onSave,
}: ChannelEditModalProps) {
  const [name, setName] = React.useState('');
  const [poster, setPoster] = React.useState('');
  const [group, setGroup] = React.useState('');
  const [epgSource, setEpgSource] = React.useState('');

  React.useEffect(() => {
    if (!channel) return;
    setName(channel.name);
    setPoster(channel.poster ?? '');
    setGroup(channel.group ?? '');
    setEpgSource(
      channel.epgSource
        ? streamSourceKey(
            channel.epgSource.addonId,
            channel.epgSource.channelId
          )
        : ''
    );
  }, [channel, open]);

  const handleSave = () => {
    if (!channel || !name.trim()) return;
    const source = epgSource ? parseStreamSourceKey(epgSource) : undefined;
    onSave(
      channel.id,
      name.trim(),
      poster.trim(),
      normalizeChannelGroup(group) ?? '',
      source
        ? { addonId: source.addonId, channelId: source.streamChannelId }
        : undefined
    );
    onOpenChange(false);
  };

  const groupOptions = React.useMemo(() => {
    const seen = new Set(groups);
    const options = [
      { value: '__none__', label: 'No group' },
      ...groups.map((item) => ({ value: item, label: item })),
    ];
    if (group && !seen.has(group)) {
      options.push({ value: group, label: group });
    }
    return options;
  }, [group, groups]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Edit Channel"
      description="Override the display name, logo or group for this channel."
    >
      <div className="space-y-4">
        <TextInput
          label="Name"
          value={name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setName(e.target.value)
          }
          placeholder="Channel name"
        />
        <TextInput
          label="Logo URL"
          value={poster}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setPoster(e.target.value)
          }
          placeholder="https://..."
        />
        {poster ? (
          <div className="flex items-center gap-3 rounded border border-[--border] p-3">
            <img
              src={poster}
              alt=""
              className="h-12 w-12 rounded object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
            <p className="text-xs text-[--muted]">Logo preview</p>
          </div>
        ) : null}
        <Select
          label="Group"
          options={groupOptions}
          value={group || '__none__'}
          onValueChange={(value) => setGroup(value === '__none__' ? '' : value)}
          placeholder="Select a group"
        />
        <TextInput
          label="Custom group"
          value={group}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setGroup(e.target.value)
          }
          placeholder="Or type a new group"
        />
        <Combobox
          label="EPG guide"
          virtualized
          placeholder={
            loadingEpgSources
              ? 'Loading guide channels…'
              : 'Automatic — search to choose a guide channel'
          }
          value={epgSource ? [epgSource] : []}
          onValueChange={(value) => setEpgSource(value[value.length - 1] ?? '')}
          options={[
            ...(epgSource &&
            !epgSources.some(
              (source) =>
                streamSourceKey(source.addonId, source.channelId) === epgSource
            )
              ? [
                  {
                    value: epgSource,
                    label: 'Saved guide (currently unavailable)',
                    textValue: 'Saved guide (currently unavailable)',
                  },
                ]
              : []),
            ...epgSources.map((source) => ({
              value: streamSourceKey(source.addonId, source.channelId),
              label: `${source.addonName} — ${source.name}`,
              textValue: `${source.addonName} — ${source.name}`,
            })),
          ]}
          emptyMessage="No guide channels found"
          keepOpenOnSelect={false}
        />
        {epgSource ? (
          <Button intent="primary-subtle" onClick={() => setEpgSource('')}>
            Use automatic EPG selection
          </Button>
        ) : null}
        {epgSourcesError ? (
          <p className="text-sm text-red-400">{epgSourcesError}</p>
        ) : null}
        <p className="text-xs text-[--muted]">
          A selected guide supplies the schedule. Stream bindings are preserved.
          Configure stream ordering on Sorting. If it becomes unavailable, the
          channel has no schedule until the guide recovers or you change this
          selection.
        </p>
        <div className="flex justify-end gap-2">
          <Button intent="primary-outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!name.trim()}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
