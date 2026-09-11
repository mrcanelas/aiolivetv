import { SettingsCard } from '@/components/shared/settings-card';
import { StaticTabs } from '@/components/ui/tabs';
import type {
  ChannelInfo,
  DuplicateChannelGroup,
  UnmatchedStreamInfo,
  UnavailableStreamInfo,
} from '@/lib/api';
import { type ChannelReviewFilter, countSuggestions } from '../utils';

type NeedsReviewCardProps = {
  filter: ChannelReviewFilter;
  onFilterChange: (filter: ChannelReviewFilter) => void;
  channels: ChannelInfo[];
  noStreamCount: number;
  duplicateGroups: DuplicateChannelGroup[];
  unmatchedStreams: UnmatchedStreamInfo[];
  unavailableStreams: UnavailableStreamInfo[];
  noScheduleCount: number;
};

const CHANNEL_FILTERS: ChannelReviewFilter[] = [
  'no-stream',
  'suggestions',
  'duplicates',
  'no-schedule',
];

export function NeedsReviewCard({
  filter,
  onFilterChange,
  channels,
  noStreamCount,
  duplicateGroups,
  unmatchedStreams,
  unavailableStreams,
  noScheduleCount,
}: NeedsReviewCardProps) {
  const suggestionCount = countSuggestions(channels);
  const duplicateCount = duplicateGroups.reduce(
    (total, group) => total + group.channelIds.length,
    0
  );
  const total =
    noStreamCount +
    suggestionCount +
    duplicateCount +
    unmatchedStreams.length +
    unavailableStreams.length +
    noScheduleCount;
  const showUnmatched =
    (filter === 'all' || filter === 'unmatched') &&
    unmatchedStreams.length > 0;
  const showUnavailable =
    (filter === 'all' || filter === 'unavailable') &&
    unavailableStreams.length > 0;

  const tab = (
    name: string,
    value: ChannelReviewFilter,
    count: number
  ) => ({
    name: count > 0 ? `${name} (${count})` : name,
    isCurrent: filter === value,
    onClick: () => onFilterChange(value),
  });

  return (
    <SettingsCard
      title="Needs review"
      description="Conflicts from the latest scan. Channel lists filter My Channels; unmatched and unavailable streams stay here until you map or refresh them."
    >
      <StaticTabs
        className="mb-4 h-10 w-fit max-w-full rounded-full border"
        triggerClass="px-3 py-1 text-xs"
        items={[
          tab('All', 'all', total),
          tab('No stream', 'no-stream', noStreamCount),
          tab('Suggestions', 'suggestions', suggestionCount),
          tab('Duplicates', 'duplicates', duplicateCount),
          tab('No schedule', 'no-schedule', noScheduleCount),
          tab('Unmatched', 'unmatched', unmatchedStreams.length),
          tab('Unavailable', 'unavailable', unavailableStreams.length),
        ]}
      />

      {showUnmatched ? (
        <div className="mb-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-[--muted]">
            Streams without a channel ({unmatchedStreams.length})
          </p>
          <ul className="space-y-1.5">
            {unmatchedStreams.map((item) => (
              <li
                key={`${item.addonId}\0${item.channelId}`}
                className="rounded-[--radius-md] border border-[--border] px-3 py-2 text-sm"
              >
                <p className="truncate font-medium">{item.name}</p>
                <p className="text-xs text-[--muted]">{item.addonName}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {showUnavailable ? (
        <div className="mb-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-[--muted]">
            Unavailable streams ({unavailableStreams.length})
          </p>
          <ul className="space-y-1.5">
            {unavailableStreams.map((item) => (
              <li
                key={`${item.channelId}\0${item.addonId}\0${item.streamChannelId}`}
                className="rounded-[--radius-md] border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm"
              >
                <p className="truncate font-medium">{item.name}</p>
                <p className="text-xs text-[--muted]">
                  {item.channelName} · {item.addonName}
                </p>
                <p className="mt-0.5 text-xs text-red-400">{item.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {total === 0 ? (
        <p className="py-2 text-sm text-[--muted]">
          No mapping conflicts in the current scan.
        </p>
      ) : CHANNEL_FILTERS.includes(filter) ? (
        <p className="text-xs text-[--muted]">
          My Channels below is filtered to this list.
        </p>
      ) : null}
    </SettingsCard>
  );
}
