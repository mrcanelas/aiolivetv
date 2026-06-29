import React from 'react';
import { Modal } from '../../../ui/modal';
import { Button } from '../../../ui/button';
import { TextInput } from '../../../ui/text-input';
import type { ChannelInfo } from '@/lib/api';

type ChannelEditModalProps = {
  channel: ChannelInfo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (channelId: string, name: string, poster: string) => void;
};

export function ChannelEditModal({
  channel,
  open,
  onOpenChange,
  onSave,
}: ChannelEditModalProps) {
  const [name, setName] = React.useState('');
  const [poster, setPoster] = React.useState('');

  React.useEffect(() => {
    if (!channel) return;
    setName(channel.name);
    setPoster(channel.poster ?? '');
  }, [channel, open]);

  const handleSave = () => {
    if (!channel || !name.trim()) return;
    onSave(channel.id, name.trim(), poster.trim());
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Edit Channel"
      description="Override the display name or logo for this channel."
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
