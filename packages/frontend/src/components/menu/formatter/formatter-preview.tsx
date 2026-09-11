import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { ParsedStream } from '../../../../../core/src/db/schemas';
import {
  formatDeclaredStreamSummary,
  parseDeclaredStreamInfo,
} from '../../../../../core/src/streams/declared';
import { useUserData } from '@/context/userData';
import { SettingsCard } from '../../shared/settings-card';
import { TextInput } from '../../ui/text-input';
import { Select } from '../../ui/select';
import { Switch } from '../../ui/switch';
import { Button } from '../../ui/button';
import { getFormattedStream } from '@/lib/api';
import { toast } from 'sonner';
import { useDisclosure } from '@/hooks/disclosure';
import { FormatQueue } from './format-queue';
import { AdvancedModal } from './advanced-modal';

const LIVE_STREAM_TYPES = ['live', 'http'] as const;

function FormatterPreviewBox({
  name,
  description,
}: {
  name?: string;
  description?: string;
}) {
  return (
    <div className="bg-gray-900 rounded-md p-4 border border-gray-800">
      <div
        className="text-xl font-bold mb-1 overflow-x-auto"
        style={{ whiteSpace: 'pre' }}
      >
        {name}
      </div>
      <div
        className="text-base text-muted-foreground overflow-x-auto"
        style={{ whiteSpace: 'pre' }}
      >
        {description}
      </div>
    </div>
  );
}

export function FormatterPreview() {
  const { userData } = useUserData();
  const advancedModalDisclosure = useDisclosure(false);
  const formatQueueRef = useRef<FormatQueue>(new FormatQueue(200));

  const [formattedStream, setFormattedStream] = useState<{
    name: string;
    description: string;
  } | null>(null);
  const [isFormatting, setIsFormatting] = useState(false);

  const [streamLabel, setStreamLabel] = useState('AXN H265 FHD LEG');
  const [addonName, setAddonName] = useState('Live TV');
  const [type, setType] =
    useState<(typeof LIVE_STREAM_TYPES)[number]>('live');
  const [proxied, setProxied] = useState(false);
  const [regexMatched, setRegexMatched] = useState<string | undefined>(
    undefined
  );

  const [regexScore, setRegexScore] = useState<number | undefined>(25);
  const [streamExpressionScore, setStreamExpressionScore] = useState<
    number | undefined
  >(150);
  const [maxRegexScore, setMaxRegexScore] = useState<number | undefined>(50);
  const [maxSeScore, setMaxSeScore] = useState<number | undefined>(100);
  const [seMatched, setSeMatched] = useState<string | undefined>(undefined);
  const [rseMatched, setRseMatched] = useState<string | undefined>(undefined);
  const [rankedRegexMatched, setRankedRegexMatched] = useState('');

  const declaredInfo = useMemo(
    () => parseDeclaredStreamInfo({ name: streamLabel }),
    [streamLabel]
  );

  const formatStream = useCallback(async () => {
    if (isFormatting) return;
    try {
      setIsFormatting(true);

      const stream: ParsedStream = {
        id: 'preview',
        type,
        addon: {
          name: addonName,
          preset: { type: 'custom', id: 'custom', options: {} },
          enabled: true,
          manifestUrl: 'http://localhost:2000/manifest.json',
          timeout: 10000,
        },
        library: false,
        parsedFile: declaredInfo?.parsedFile,
        filename: streamLabel,
        regexMatched: regexMatched
          ? { name: regexMatched, index: 0 }
          : undefined,
        proxied,
        message: streamLabel,
        originalName: streamLabel,
        streamExpressionScore,
        streamExpressionMatched: seMatched
          ? { name: seMatched, index: 0 }
          : undefined,
        rankedStreamExpressionsMatched: rseMatched
          ? rseMatched
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
        regexScore,
        rankedRegexesMatched: rankedRegexMatched
          ? rankedRegexMatched
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
      };

      const context = { userData, maxRegexScore, maxSeScore };
      const formattedData = await getFormattedStream(stream, context);
      setFormattedStream(formattedData);
    } catch (error) {
      console.error('Error formatting stream:', error);
      toast.error(`Failed to format stream: ${error}`);
    } finally {
      setIsFormatting(false);
    }
  }, [
    streamLabel,
    declaredInfo,
    addonName,
    type,
    proxied,
    isFormatting,
    regexMatched,
    userData,
    seMatched,
    rseMatched,
    rankedRegexMatched,
    regexScore,
    maxRegexScore,
    maxSeScore,
    streamExpressionScore,
  ]);

  useEffect(() => {
    formatQueueRef.current.enqueue(formatStream);
  }, [formatStream]);

  return (
    <>
      <SettingsCard
        title="Preview"
        description="Preview how Live TV stream labels are formatted. ffprobe metadata is applied in the stream pipeline when enabled under Miscellaneous → Built-ins."
      >
        <div className="space-y-4">
          <FormatterPreviewBox
            name={formattedStream?.name}
            description={formattedStream?.description}
          />

          {formatDeclaredStreamSummary(declaredInfo?.parsedFile) ? (
            <p className="text-xs text-[--muted]">
              Declared metadata:{' '}
              {formatDeclaredStreamSummary(declaredInfo?.parsedFile)}
            </p>
          ) : null}

          <TextInput
            label={<span className="truncate block">Stream label</span>}
            value={streamLabel}
            onValueChange={(v) => setStreamLabel(v || '')}
            className="w-full"
            placeholder="AXN H265 FHD LEG"
          />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <TextInput
              label={<span className="truncate block">Addon Name</span>}
              value={addonName}
              onChange={(e) => setAddonName(e.target.value)}
              className="w-full"
            />
            <Select
              label={<span className="truncate block">Stream Type</span>}
              value={type}
              onValueChange={(v) =>
                setType(v as (typeof LIVE_STREAM_TYPES)[number])
              }
              options={LIVE_STREAM_TYPES.map((t) => ({
                label: t === 'live' ? 'Live' : 'HTTP',
                value: t,
              }))}
              className="w-full"
            />
            <TextInput
              label={<span className="truncate block">Regex Matched</span>}
              value={regexMatched}
              onValueChange={(v) => setRegexMatched(v || undefined)}
              className="w-full"
            />
          </div>

          <div className="flex justify-center pt-2">
            <Button
              intent="white"
              size="sm"
              onClick={advancedModalDisclosure.open}
            >
              Advanced Variables
            </Button>
          </div>

          <div className="flex justify-center flex-wrap gap-4 pt-2">
            <Switch
              label={<span className="truncate block">Proxied</span>}
              value={proxied}
              onValueChange={setProxied}
            />
          </div>
        </div>
      </SettingsCard>

      <AdvancedModal
        open={advancedModalDisclosure.isOpen}
        onOpenChange={advancedModalDisclosure.toggle}
        regexScore={regexScore}
        setRegexScore={setRegexScore}
        maxRegexScore={maxRegexScore}
        setMaxRegexScore={setMaxRegexScore}
        streamExpressionScore={streamExpressionScore}
        setStreamExpressionScore={setStreamExpressionScore}
        maxSeScore={maxSeScore}
        setMaxSeScore={setMaxSeScore}
        seMatched={seMatched}
        setSeMatched={setSeMatched}
        rseMatched={rseMatched}
        setRseMatched={setRseMatched}
        rankedRegexMatched={rankedRegexMatched}
        setRankedRegexMatched={setRankedRegexMatched}
        seadex={false}
        setSeadex={() => {}}
        seadexBest={false}
        setSeadexBest={() => {}}
      />
    </>
  );
}
