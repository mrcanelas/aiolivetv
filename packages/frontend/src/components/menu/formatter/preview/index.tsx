import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Braces,
  Eye,
  FileText,
  Hash,
  Radio,
  RotateCcw,
  Tv,
} from 'lucide-react';
import { toast } from 'sonner';
import { collectFieldReferences } from '../../../../../../core/src/formatters/engine';
import { useUserData } from '@/context/userData';
import { getFormattedStream } from '@/lib/api';
import { cn } from '../../../ui/core/styling';
import { SettingsCard } from '../../../shared/settings-card';
import { MenuTabs } from '../../../shared/menu-tabs';
import { IconButton } from '../../../ui/button';
import { Select } from '../../../ui/select';
import { Tooltip } from '../../../ui/tooltip';
import { FormatQueue } from '../format-queue';
import { getTemplates } from '../templates';
import { PreviewFieldsProvider } from './fields';
import { FormatterPreviewBox } from './preview-box';
import {
  applyScenario,
  buildPreviewStream,
  DEFAULT_PREVIEW_INPUT,
  loadPreviewInput,
  PREVIEW_SCENARIOS,
  type PreviewInput,
  savePreviewInput,
  tabHasUsedField,
} from './state';
import { ChannelTab } from './tabs/channel';
import { SourceTab } from './tabs/source';
import { StreamTab } from './tabs/stream';
import { ParsedTab } from './tabs/parsed';
import { ScoringTab } from './tabs/scoring';

export function FormatterPreview() {
  const { userData } = useUserData();
  const formatQueueRef = useRef(new FormatQueue(200));

  const [input, setInput] = useState<PreviewInput>(loadPreviewInput);
  const [activeTab, setActiveTab] = useState('channel');
  const [onlyUsed, setOnlyUsed] = useState(false);
  const [formattedStream, setFormattedStream] = useState<{
    name: string;
    description: string;
  } | null>(null);

  const patch = useCallback((partial: Partial<PreviewInput>) => {
    setInput((previous) => ({ ...previous, ...partial }));
  }, []);

  useEffect(() => {
    savePreviewInput(input);
  }, [input]);

  const templates = getTemplates(userData);
  const usedFields = useMemo(
    () =>
      new Set([
        ...collectFieldReferences(templates.name),
        ...collectFieldReferences(templates.description),
      ]),
    [templates.name, templates.description]
  );

  const formatStream = useCallback(async () => {
    try {
      const stream = buildPreviewStream(input);
      const formatted = await getFormattedStream(stream, {
        userData,
        maxRegexScore: input.maxRegexScore,
        maxSeScore: input.maxSeScore,
        title: input.channelName || 'AXN',
        type: 'tv',
        queryType: 'channel',
      });
      setFormattedStream(formatted);
    } catch (error) {
      console.error('Error formatting stream:', error);
      toast.error(`Failed to format stream: ${error}`);
    }
  }, [input, userData]);

  useEffect(() => {
    formatQueueRef.current.enqueue(formatStream);
  }, [formatStream]);

  const allTabs = [
    {
      value: 'channel',
      label: 'Channel',
      icon: <Tv className="h-4 w-4" />,
      content: <ChannelTab input={input} patch={patch} />,
    },
    {
      value: 'source',
      label: 'Source',
      icon: <Radio className="h-4 w-4" />,
      content: <SourceTab input={input} patch={patch} />,
    },
    {
      value: 'stream',
      label: 'Stream',
      icon: <FileText className="h-4 w-4" />,
      content: <StreamTab input={input} patch={patch} />,
    },
    {
      value: 'parsed',
      label: 'Parsed',
      icon: <Braces className="h-4 w-4" />,
      content: <ParsedTab input={input} patch={patch} />,
    },
    {
      value: 'scoring',
      label: 'Scoring',
      icon: <Hash className="h-4 w-4" />,
      content: <ScoringTab input={input} patch={patch} />,
    },
  ];

  const tabs = onlyUsed
    ? allTabs.filter((tab) => tabHasUsedField(tab.value, usedFields))
    : allTabs;

  useEffect(() => {
    if (tabs.length && !tabs.some((tab) => tab.value === activeTab)) {
      setActiveTab(tabs[0].value);
    }
  }, [tabs, activeTab]);

  const isDefault =
    JSON.stringify(input) === JSON.stringify(DEFAULT_PREVIEW_INPUT);

  return (
    <SettingsCard
      title="Preview"
      description="Preview how Live TV stream labels are formatted. Change the scenario or a field below — the result updates as you type."
    >
      <div className="space-y-4">
        <FormatterPreviewBox
          name={formattedStream?.name}
          description={formattedStream?.description}
        />

        <PreviewToolbar
          scenario={input.scenario}
          onScenario={(id) => setInput(applyScenario(id))}
          onlyUsed={onlyUsed}
          onOnlyUsed={setOnlyUsed}
          usedCount={usedFields.size}
          onReset={() => setInput(DEFAULT_PREVIEW_INPUT)}
          resetDisabled={isDefault}
        />

        <PreviewFieldsProvider used={usedFields} onlyUsed={onlyUsed}>
          {tabs.length ? (
            <MenuTabs
              tabs={tabs}
              activeTab={activeTab}
              onTabChange={setActiveTab}
            />
          ) : (
            <p className="text-sm text-[--muted]">
              This formatter reads no controllable fields.
            </p>
          )}
        </PreviewFieldsProvider>
      </div>
    </SettingsCard>
  );
}

function PreviewToolbar({
  scenario,
  onScenario,
  onlyUsed,
  onOnlyUsed,
  usedCount,
  onReset,
  resetDisabled,
}: {
  scenario: string;
  onScenario: (id: string) => void;
  onlyUsed: boolean;
  onOnlyUsed: (value: boolean) => void;
  usedCount: number;
  onReset: () => void;
  resetDisabled: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-[12rem] flex-1">
        <Select
          label="Scenario"
          value={scenario}
          options={PREVIEW_SCENARIOS.map((preset) => ({
            label: preset.label,
            value: preset.id,
          }))}
          onValueChange={onScenario}
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onOnlyUsed(!onlyUsed)}
          className={cn(
            'flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
            onlyUsed
              ? 'border-[--brand] bg-brand/10 text-[--brand]'
              : 'border-gray-800 text-[--muted] hover:text-[--foreground]'
          )}
        >
          <Eye className="h-4 w-4" />
          Used only
          <span className="text-xs opacity-70">{usedCount}</span>
        </button>
        <Tooltip
          trigger={
            <IconButton
              rounded
              size="sm"
              intent="primary-subtle"
              aria-label="Reset preview inputs"
              disabled={resetDisabled}
              onClick={onReset}
              icon={<RotateCcw />}
            />
          }
        >
          Reset all preview inputs
        </Tooltip>
      </div>
    </div>
  );
}
