import { BiUndo } from 'react-icons/bi';
import { SettingsCard } from '@/components/shared/settings-card';
import { Button, IconButton } from '@/components/ui/button';
import { getRemovedChannels } from '../utils';

type RemovedChannel = ReturnType<typeof getRemovedChannels>[number];

type RemovedChannelsCardProps = {
  channels: RemovedChannel[];
  onRestore: (channelIds: string[]) => void;
};

export function RemovedChannelsCard({
  channels,
  onRestore,
}: RemovedChannelsCardProps) {
  if (channels.length === 0) return null;

  return (
    <SettingsCard
      title="Removed channels"
      description="These channels are hidden from the catalog. Restore one to put it back in My Channels."
      action={
        <Button
          size="sm"
          intent="primary-subtle"
          leftIcon={<BiUndo />}
          onClick={() => onRestore(channels.map((channel) => channel.id))}
        >
          Restore all
        </Button>
      }
    >
      <ul className="space-y-2">
        {channels.map((channel) => (
          <li
            key={channel.id}
            className="flex items-center gap-3 rounded-[--radius-md] border border-[--border] bg-[var(--background)] px-2.5 py-2"
          >
            <div className="relative hidden h-8 w-8 flex-shrink-0 sm:block">
              {channel.poster ? (
                <img
                  src={channel.poster}
                  alt=""
                  className="absolute inset-0 h-full w-full rounded-md object-contain"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center rounded-md bg-gray-950">
                  <p className="text-lg font-bold">
                    {channel.name.trim()[0]?.toUpperCase() ?? '?'}
                  </p>
                </div>
              )}
            </div>
            <p className="min-w-0 flex-1 truncate text-base">{channel.name}</p>
            <IconButton
              className="h-8 w-8 rounded-full md:h-10 md:w-10"
              icon={<BiUndo />}
              intent="primary-subtle"
              onClick={() => onRestore([channel.id])}
              title={`Restore ${channel.name}`}
            />
          </li>
        ))}
      </ul>
    </SettingsCard>
  );
}
