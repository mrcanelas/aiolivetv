import React from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import type { ChannelListItemProps } from './channel-list-item';

type Row<T> =
  | { key: string; channel: T }
  | { key: string; source: string; count: number };

export function ChannelList<
  T extends { id: string; name: string; canonicalAddonId?: string },
>({
  channels,
  groups = null,
  resetKey,
  renderChannel,
  onReorder,
}: {
  channels: T[];
  groups?: Array<[string, T[]]> | null;
  resetKey: string;
  renderChannel: (
    channel: T,
    rowProps: ChannelListItemProps['rowProps'],
    sortableId?: string
  ) => React.ReactNode;
  onReorder?: (from: number, to: number) => void;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [focusedKey, setFocusedKey] = React.useState<string | null>(null);
  const [draggedKey, setDraggedKey] = React.useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
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
  const sortableIds = React.useMemo(() => rows.map((row) => row.key), [rows]);
  const focusedIndex = rows.findIndex((row) => row.key === focusedKey);
  const draggedIndex = rows.findIndex((row) => row.key === draggedKey);
  const draggedRow = rows[draggedIndex];
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => rows[index].key,
    estimateSize: (index) => ('channel' in rows[index] ? 66 : 36),
    overscan: 8,
    // Keep focused and dragged rows mounted when they leave the viewport.
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      for (const index of [focusedIndex, draggedIndex]) {
        if (index >= 0 && !indexes.includes(index)) indexes.push(index);
      }
      return indexes.sort((left, right) => left - right);
    },
  });
  React.useEffect(() => {
    virtualizer.scrollToOffset(0);
  }, [resetKey, virtualizer]);

  const list = (
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
            className: 'absolute left-0 w-full pb-2',
            // dnd-kit ignores transforms when measuring sortable rows.
            style: { top: item.start },
            onFocusCapture: () => setFocusedKey(row.key),
          };
          return 'channel' in row ? (
            renderChannel(
              row.channel,
              rowProps,
              onReorder ? row.key : undefined
            )
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

  if (!onReorder) return list;

  const rowLabel = (id: string | number) => {
    const row = rows.find((item) => item.key === id);
    return row && 'channel' in row ? row.channel.name : 'Channel';
  };
  const positionLabel = (id: string | number) =>
    `Position ${sortableIds.indexOf(String(id)) + 1} of ${rows.length}.`;
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setDraggedKey(null);
    if (!over || active.id === over.id) return;
    const from = rows.findIndex((row) => row.key === active.id);
    const to = rows.findIndex((row) => row.key === over.id);
    if (from >= 0 && to >= 0) onReorder(from, to);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `Picked up ${rowLabel(active.id)}.`,
          onDragOver: ({ over }) => (over ? positionLabel(over.id) : undefined),
          onDragEnd: ({ active, over }) =>
            over
              ? `Dropped ${rowLabel(active.id)}. ${positionLabel(over.id)}`
              : `Reordering ${rowLabel(active.id)} cancelled.`,
          onDragCancel: ({ active }) =>
            `Reordering ${rowLabel(active.id)} cancelled.`,
        },
      }}
      onDragStart={({ active }) => setDraggedKey(String(active.id))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDraggedKey(null)}
    >
      <SortableContext
        items={sortableIds}
        strategy={verticalListSortingStrategy}
      >
        {list}
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {draggedRow && 'channel' in draggedRow ? (
          <div
            aria-hidden="true"
            className="truncate rounded-[--radius-md] border border-brand-500 bg-[--background] px-3 py-2 shadow-lg"
          >
            {draggedRow.channel.name}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
