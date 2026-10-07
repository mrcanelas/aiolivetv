import { StaticTabs } from '@/components/ui/tabs';
import { Select } from '@/components/ui/select';
import type { ChannelInfo, DuplicateChannelGroup } from '@/lib/api';
import { type ChannelReviewFilter, isVisibleChannelSuggestion } from '../utils';

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
  const suggestionCount = channels.filter((channel) =>
    channel.mappings.some((mapping) =>
      isVisibleChannelSuggestion(mapping.confidence)
    )
  ).length;
  const duplicateCount = new Set(
    duplicateGroups.flatMap((group) => group.channelIds)
  ).size;
  const total =
    noStreamCount + suggestionCount + duplicateCount + noScheduleCount;

  const tab = (name: string, value: ChannelReviewFilter, count: number) => ({
    name: count > 0 ? `${name} (${count})` : name,
    isCurrent: filter === value,
    onClick: () => onFilterChange(value),
  });
  const filters = [
    tab('All', 'all', channels.length),
    tab('No stream', 'no-stream', noStreamCount),
    tab('Suggestions', 'suggestions', suggestionCount),
    tab('Duplicates', 'duplicates', duplicateCount),
    tab('No schedule', 'no-schedule', noScheduleCount),
  ];

  return (
    <div className="space-y-3">
      <div className="sm:hidden">
        <Select
          aria-label="Filter channels by status"
          value={filter}
          onValueChange={(value) =>
            onFilterChange(value as ChannelReviewFilter)
          }
          options={filters.map((item, index) => ({
            label: item.name,
            value: ['all', ...CHANNEL_FILTERS][index],
          }))}
        />
      </div>
      <StaticTabs
        className="hidden sm:flex h-10 w-fit max-w-full rounded-full border"
        triggerClass="px-3 py-1 text-xs"
        items={filters}
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
