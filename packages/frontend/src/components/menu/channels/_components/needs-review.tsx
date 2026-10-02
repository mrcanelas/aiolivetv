import { StaticTabs } from '@/components/ui/tabs';
import type { ChannelInfo, DuplicateChannelGroup } from '@/lib/api';
import { type ChannelReviewFilter, countSuggestions } from '../utils';

type NeedsReviewCardProps = {
  filter: ChannelReviewFilter;
  onFilterChange: (filter: ChannelReviewFilter) => void;
  channels: ChannelInfo[];
  noStreamCount: number;
  duplicateGroups: DuplicateChannelGroup[];
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
  noScheduleCount,
}: NeedsReviewCardProps) {
  const suggestionCount = countSuggestions(channels);
  const duplicateCount = duplicateGroups.reduce(
    (total, group) => total + group.channelIds.length,
    0
  );
  const total =
    noStreamCount + suggestionCount + duplicateCount + noScheduleCount;

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
    <div className="space-y-3">
      <StaticTabs
        className="h-10 w-fit max-w-full rounded-full border"
        triggerClass="px-3 py-1 text-xs"
        items={[
          tab('All', 'all', total),
          tab('No stream', 'no-stream', noStreamCount),
          tab('Suggestions', 'suggestions', suggestionCount),
          tab('Duplicates', 'duplicates', duplicateCount),
          tab('No schedule', 'no-schedule', noScheduleCount),
        ]}
      />

      {total === 0 ? (
        <p className="text-xs text-[--muted]">
          No mapping conflicts in the current scan.
        </p>
      ) : CHANNEL_FILTERS.includes(filter) ? (
        <p className="text-xs text-[--muted]">
          The list below is filtered to this issue.
        </p>
      ) : null}
    </div>
  );
}
