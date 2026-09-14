import React, { useMemo, useState } from 'react';
import { Bookmark, Layers, PenLine } from 'lucide-react';
import * as constants from '../../../../../../core/src/utils/constants';
import {
  BUILTIN_FORMATTER_DEFINITIONS,
  type FormatterDefinition,
} from '../../../../../../core/src/utils/formatter-definitions';
import { useUserData } from '@/context/userData';
import { Modal } from '../../../ui/modal';
import { Button } from '../../../ui/button';
import { MenuTabs } from '../../../shared/menu-tabs';
import { getActiveSavedName } from '../templates';
import { FormatterCard } from './formatter-card';
import { SavedTab } from './saved-tab';
import { useCardPreviews } from './use-card-previews';

export interface FormatterBrowserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectBuiltin: (id: constants.FormatterType) => void;
  onSelectSaved: (name: string) => void;
  onSelectCustom: () => void;
  onSaveCurrent: (name: string) => void;
  onRename: (oldName: string, newName: string) => void;
  onDelete: (name: string) => void;
}

const BUILTIN_IDS = constants.FORMATTERS.filter(
  (id) => id !== constants.CUSTOM_FORMATTER
);

export function FormatterBrowser({
  open,
  onOpenChange,
  onSelectBuiltin,
  onSelectSaved,
  onSelectCustom,
  onSaveCurrent,
  onRename,
  onDelete,
}: FormatterBrowserProps) {
  const { userData } = useUserData();
  const [activeTab, setActiveTab] = useState('builtin');

  const currentId = userData.formatter.id;
  const definitions = userData.formatter.definitions;
  const overrides = definitions?.overrides;
  const saved = definitions?.saved;
  const custom = definitions?.custom;
  const activeSaved = getActiveSavedName(userData);
  const customActive =
    currentId === constants.CUSTOM_FORMATTER && !activeSaved;

  const cardDefinitions = useMemo(() => {
    const out: Record<string, FormatterDefinition> = {};
    for (const id of BUILTIN_IDS) {
      const definition = overrides?.[id] ?? BUILTIN_FORMATTER_DEFINITIONS[id];
      if (definition) out[id] = definition;
    }
    for (const [name, definition] of Object.entries(saved ?? {})) {
      out[`saved:${name}`] = definition;
    }
    if (custom) out.custom = custom;
    return out;
  }, [overrides, saved, custom]);

  const previews = useCardPreviews(cardDefinitions, open);

  const builtinTab = (
    <div className="grid gap-4 sm:grid-cols-2">
      {BUILTIN_IDS.map((id) => {
        const detail = constants.FORMATTER_DETAILS[id];
        const active = currentId === id;
        const customised = !!overrides?.[id];
        return (
          <FormatterCard
            key={id}
            title={detail.name}
            description={detail.description}
            active={active}
            preview={previews[id]}
            badge={
              customised ? (
                <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-yellow-400/20 text-yellow-400 border border-yellow-400/30">
                  Customised
                </span>
              ) : undefined
            }
            actions={
              <Button
                size="sm"
                intent={active ? 'white' : 'primary-subtle'}
                onClick={() => onSelectBuiltin(id)}
              >
                {active ? 'In use' : 'Use'}
              </Button>
            }
          />
        );
      })}
      <FormatterCard
        title="Custom"
        description={
          constants.FORMATTER_DETAILS[constants.CUSTOM_FORMATTER].description
        }
        active={customActive}
        preview={previews.custom}
        badge={
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
            <PenLine className="h-3 w-3" />
            Custom
          </span>
        }
        actions={
          <Button
            size="sm"
            intent={customActive ? 'white' : 'primary-subtle'}
            onClick={onSelectCustom}
          >
            {customActive ? 'In use' : 'Use'}
          </Button>
        }
      />
    </div>
  );

  const tabs = [
    {
      value: 'builtin',
      label: 'Built-in',
      icon: <Layers className="h-4 w-4" />,
      content: builtinTab,
    },
    {
      value: 'saved',
      label: `Saved (${Object.keys(saved ?? {}).length})`,
      icon: <Bookmark className="h-4 w-4" />,
      content: (
        <SavedTab
          saved={saved ?? {}}
          previews={previews}
          activeName={activeSaved}
          onSelect={onSelectSaved}
          onSaveCurrent={onSaveCurrent}
          onRename={onRename}
          onDelete={onDelete}
        />
      ),
    },
  ];

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Formatters"
      description="Pick a built-in formatter or one you saved. Previews use the sample from the preview panel."
      contentClass="max-w-4xl sm:max-w-4xl"
    >
      <MenuTabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
    </Modal>
  );
}
