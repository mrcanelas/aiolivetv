import { useState, useEffect, useMemo } from 'react';
import { PageControls } from '../shared/page-controls';
import { PageWrapper } from '../shared/page-wrapper';
import { SettingsCard } from '../shared/settings-card';
import { Combobox } from '../ui/combobox';
import { useUserData, useParentInheritance } from '@/context/userData';
import { useStatus } from '@/context/status';
import { InheritedBadge } from '../shared/inherited-badge';
import { Button, IconButton } from '../ui/button';
import { ReorderModal } from './addons/_components/reorder-modal';
import {
  SORT_CRITERIA,
  SORT_CRITERIA_DETAILS,
  SORT_DIRECTIONS,
  LIVE_TV_SORT_CRITERIA,
  getLiveTvSortCriteria,
  RESOLUTIONS,
  LANGUAGES,
  ENCODES,
  VISUAL_TAGS,
  AUDIO_TAGS,
  AUDIO_CHANNELS,
} from '../../../../core/src/utils/constants';
import {
  DndContext,
  useSensors,
  useSensor,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDownAZ, ArrowUpAZ } from 'lucide-react';
import type { UserData } from '@aiolivetv/core';

type SortCriteriaItem = UserData['sortCriteria']['global'][number];
function SortableItem({
  id,
  name,
  description,
  direction,
  onDirectionChange,
}: {
  id: string;
  name: string;
  description: string;
  direction: (typeof SORT_DIRECTIONS)[number];
  onDirectionChange: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div className="px-2.5 py-2 bg-[var(--background)] rounded-[--radius-md] border flex gap-3 relative">
        <div
          aria-label={`Reorder ${name}`}
          className="rounded-full w-6 h-auto bg-[--muted] md:bg-[--subtle] md:hover:bg-[--subtle-highlight] cursor-move touch-none"
          {...attributes}
          {...listeners}
        />
        <div className="flex-1 flex flex-col justify-center min-w-0">
          <span className="font-mono text-base truncate">{name}</span>
          <span className="text-[--muted] text-sm break-words">
            {description}
          </span>
        </div>
        <IconButton
          aria-label={`Reverse ${name} direction`}
          size="sm"
          rounded
          icon={direction === 'asc' ? <ArrowUpAZ /> : <ArrowDownAZ />}
          intent="primary-subtle"
          onClick={onDirectionChange}
        />
      </div>
    </div>
  );
}

function SortOrderEditor() {
  const { userData, setUserData } = useUserData();
  const [isDragging, setIsDragging] = useState(false);

  const items = getLiveTvSortCriteria(userData.sortCriteria?.global ?? []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 8 },
    })
  );

  useEffect(() => {
    function preventTouchMove(e: TouchEvent) {
      if (isDragging) e.preventDefault();
    }
    if (isDragging) {
      document.body.addEventListener('touchmove', preventTouchMove, {
        passive: false,
      });
    } else {
      document.body.removeEventListener('touchmove', preventTouchMove);
    }
    return () =>
      document.body.removeEventListener('touchmove', preventTouchMove);
  }, [isDragging]);

  function update(newItems: SortCriteriaItem[]) {
    setUserData((prev) => ({
      ...prev,
      sortCriteria: { global: newItems },
    }));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIdx = items.findIndex(
        (i) => `${i.key}-${i.direction}` === active.id
      );
      const newIdx = items.findIndex(
        (i) => `${i.key}-${i.direction}` === over.id
      );
      update(arrayMove(items, oldIdx, newIdx));
    }
    setIsDragging(false);
  }

  return (
    <div className="space-y-2">
      {items.length === 0 ? (
        <p className="text-sm text-[--muted]">
          No criteria selected. Streams keep their source order.
        </p>
      ) : null}
      <Combobox
        label="Sort criteria"
        multiple
        value={items.map((i) => i.key)}
        emptyMessage="No sort criteria available"
        onValueChange={(value) => {
          if (
            value.length === items.length &&
            value.every((key, index) => key === items[index].key)
          )
            return;
          const keys = value as (typeof SORT_CRITERIA)[number][];
          update(
            keys.map(
              (key) =>
                items.find((i) => i.key === key) ?? {
                  key,
                  direction: SORT_CRITERIA_DETAILS[key].defaultDirection,
                }
            )
          );
        }}
        options={[
          ...items.map((item) => item.key),
          ...LIVE_TV_SORT_CRITERIA.filter(
            (key) => !items.some((item) => item.key === key)
          ),
        ].map((c) => ({
          label: SORT_CRITERIA_DETAILS[c].name,
          textValue: SORT_CRITERIA_DETAILS[c].name,
          value: c,
        }))}
      />

      {items.length > 0 && (
        <DndContext
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleDragEnd}
          onDragStart={() => setIsDragging(true)}
          sensors={sensors}
        >
          <SortableContext
            items={items.map((i) => `${i.key}-${i.direction}`)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {items.map((item) => (
                <SortableItem
                  key={`${item.key}-${item.direction}`}
                  id={`${item.key}-${item.direction}`}
                  name={SORT_CRITERIA_DETAILS[item.key].name}
                  description={
                    item.direction === 'asc'
                      ? `${SORT_CRITERIA_DETAILS[item.key].description}, ${SORT_CRITERIA_DETAILS[item.key].ascendingDescription}`
                      : `${SORT_CRITERIA_DETAILS[item.key].description}, ${SORT_CRITERIA_DETAILS[item.key].descendingDescription}`
                  }
                  direction={item.direction}
                  onDirectionChange={() => {
                    const dir =
                      item.direction === 'asc'
                        ? ('desc' as const)
                        : ('asc' as const);
                    update(
                      items.map((i) =>
                        i.key === item.key ? { ...i, direction: dir } : i
                      )
                    );
                  }}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

const PREFERENCES = [
  {
    key: 'preferredResolutions',
    criterion: 'resolution',
    label: 'Resolution',
    options: RESOLUTIONS,
  },
  {
    key: 'preferredLanguages',
    criterion: 'language',
    label: 'Language',
    options: LANGUAGES,
  },
  {
    key: 'preferredEncodes',
    criterion: 'encode',
    label: 'Encode',
    options: ENCODES,
  },
  {
    key: 'preferredVisualTags',
    criterion: 'visualTag',
    label: 'Visual Tag',
    options: VISUAL_TAGS,
  },
  {
    key: 'preferredAudioTags',
    criterion: 'audioTag',
    label: 'Audio Tag',
    options: AUDIO_TAGS,
  },
  {
    key: 'preferredAudioChannels',
    criterion: 'audioChannel',
    label: 'Audio Channel',
    options: AUDIO_CHANNELS,
  },
] as const;

export function SortingMenu() {
  const { userData, setUserData } = useUserData();
  const { status } = useStatus();
  const { isInherited, hasParent } = useParentInheritance();
  const [reorderOpen, setReorderOpen] = useState(false);
  const presetMetadataMap = useMemo(
    () =>
      new Map(
        status?.settings.presets.map((preset) => [preset.ID, preset]) ?? []
      ),
    [status?.settings.presets]
  );
  const manifestCache = useMemo(() => new Map(), []);
  const criteria = getLiveTvSortCriteria(userData.sortCriteria?.global ?? []);

  return (
    <PageWrapper className="space-y-4 p-4 sm:p-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2>Sorting</h2>
            {hasParent && isInherited('sorting') ? (
              <InheritedBadge section="sorting" />
            ) : null}
          </div>
          <p className="text-[--muted]">
            Configure stream ordering for every channel. Changes apply after
            Save.
          </p>
        </div>
        <div className="hidden lg:block">
          <PageControls />
        </div>
      </div>
      <SettingsCard
        id="sortCriteria"
        title="Stream Sort Order"
        description="Criteria are applied from top to bottom. Drag to reorder, or focus a handle and press Space, arrow keys and Space. Reverse a criterion to change its direction."
      >
        <SortOrderEditor />
      </SettingsCard>
      {criteria.some((criterion) => criterion.key === 'addon') ? (
        <SettingsCard
          title="Addon Priority"
          description="The Addon criterion uses the order of your configured addons. Manual URLs follow configured addons when higher priority is selected."
        >
          <Button onClick={() => setReorderOpen(true)}>Reorder Addons</Button>
        </SettingsCard>
      ) : null}
      {PREFERENCES.some((preference) =>
        criteria.some((criterion) => criterion.key === preference.criterion)
      ) ? (
        <SettingsCard
          id="preferredValues"
          title="Preferred Values"
          description="Selected values are preferred in the order selected. Remove and select a value again to place it last. Reverse the corresponding criterion to prefer unlisted values."
        >
          {PREFERENCES.filter((preference) =>
            criteria.some((criterion) => criterion.key === preference.criterion)
          ).map((preference) => (
            <Combobox
              key={preference.key}
              label={preference.label + ' preference'}
              emptyMessage="No values found"
              multiple
              value={userData[preference.key] ?? []}
              options={[
                ...(userData[preference.key] ?? []),
                ...preference.options.filter(
                  (value) =>
                    !(
                      userData[preference.key] as readonly string[] | undefined
                    )?.includes(value)
                ),
              ].map((value) => ({
                value,
                label: value,
                textValue: value,
              }))}
              onValueChange={(values) =>
                setUserData((current) => {
                  const previous = current[preference.key] ?? [];
                  if (
                    previous.length === values.length &&
                    previous.every((value, index) => value === values[index])
                  )
                    return current;
                  return { ...current, [preference.key]: values };
                })
              }
            />
          ))}
        </SettingsCard>
      ) : null}
      <ReorderModal
        open={reorderOpen}
        onOpenChange={setReorderOpen}
        presets={userData.presets}
        presetMetadataMap={presetMetadataMap}
        manifestCache={manifestCache}
        onSave={(presets) =>
          setUserData((current) => ({ ...current, presets }))
        }
      />
    </PageWrapper>
  );
}
