import React from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import type { ChannelListItemProps } from './channel-list-item';

type Row<T> =
  | { key: string; channel: T }
  | { key: string; source: string; count: number };

export function ChannelList<
  T extends { id: string; canonicalAddonId?: string },
>({
  channels,
  groups = null,
  resetKey,
  renderChannel,
}: {
  channels: T[];
  groups?: Array<[string, T[]]> | null;
  resetKey: string;
  renderChannel: (
    channel: T,
    rowProps?: ChannelListItemProps['rowProps']
  ) => React.ReactNode;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [focusedKey, setFocusedKey] = React.useState<string | null>(null);
  const rows = React.useMemo<Row<T>[]>(() => {
    const channelRow = (channel: T): Row<T> => ({
      key: `channel:${channel.canonicalAddonId}:${channel.id}`,
      channel,
    });
    return groups
      ? groups.flatMap(([source, items]) => [
          { key: 'source:' + source, source, count: items.length },
          ...items.map(channelRow),
        ])
      : channels.map(channelRow);
  }, [channels, groups]);
  const focusedIndex = rows.findIndex((row) => row.key === focusedKey);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => rows[index].key,
    estimateSize: (index) => ('channel' in rows[index] ? 66 : 36),
    overscan: 8,
    // Keep the active row mounted while its confirmation dialog has focus.
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      return focusedIndex < 0 || indexes.includes(focusedIndex)
        ? indexes
        : [...indexes, focusedIndex].sort((left, right) => left - right);
    },
  });
  React.useEffect(() => {
    virtualizer.scrollToOffset(0);
  }, [resetKey, virtualizer]);

  return (
    <div
      ref={scrollRef}
      className="max-h-[65vh] overflow-auto"
      style={{ height: Math.min(rows.length * 66, 640) }}
      aria-label="Channels"
    >
      <ul className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          const rowProps: ChannelListItemProps['rowProps'] = {
            ref: virtualizer.measureElement,
            'data-index': item.index,
            'aria-posinset': item.index + 1,
            'aria-setsize': rows.length,
            className: 'absolute left-0 top-0 w-full pb-2',
            style: { transform: `translateY(${item.start}px)` },
            onFocusCapture: () => setFocusedKey(row.key),
          };
          return 'channel' in row ? (
            renderChannel(row.channel, rowProps)
          ) : (
            <li key={row.key} {...rowProps}>
              <p className="px-1 py-2 text-xs font-semibold text-[--muted]">
                {row.source} ({row.count})
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
