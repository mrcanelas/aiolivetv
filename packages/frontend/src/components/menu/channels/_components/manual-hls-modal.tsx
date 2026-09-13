import React from 'react';
import { BiPlus, BiTrash } from 'react-icons/bi';
import {
  AUDIO_CHANNELS,
  ENCODES,
  LANGUAGES,
  RESOLUTIONS,
  VISUAL_TAGS,
} from '../../../../../../core/src/utils/constants';
import type { ChannelInfo } from '@/lib/api';
import { Button, IconButton } from '../../../ui/button';
import { Combobox } from '../../../ui/combobox';
import { Modal } from '../../../ui/modal';
import { Select } from '../../../ui/select';
import { TextInput } from '../../../ui/text-input';
import {
  isValidStreamUrl,
  type ManualHlsDetails,
} from '../utils';

const AUTO_VALUE = '__auto__';
const DEFAULT_HEADER_NAMES = [
  'User-Agent',
  'Referer',
  'Origin',
  'Cookie',
] as const;
const LIVE_RESOLUTIONS = RESOLUTIONS.filter((value) => value !== 'Unknown');
const LIVE_ENCODES = ENCODES.filter(
  (value) => value === 'AV1' || value === 'HEVC' || value === 'AVC'
);
const LIVE_AUDIO_CHANNELS = AUDIO_CHANNELS.filter(
  (value) => value !== 'Unknown'
);
const LIVE_VISUAL_TAGS = VISUAL_TAGS.filter(
  (value) =>
    value !== 'Unknown' &&
    value !== 'HDR+DV' &&
    value !== 'DV Only' &&
    value !== 'HDR Only' &&
    value !== 'H-OU' &&
    value !== 'H-SBS' &&
    value !== 'AI' &&
    value !== 'IMAX' &&
    value !== '3D'
);

type HeaderRow = { id: string; name: string; value: string };

function nextId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function headersToRows(headers?: Record<string, string>): HeaderRow[] {
  const remaining = { ...(headers ?? {}) };
  const rows: HeaderRow[] = DEFAULT_HEADER_NAMES.map((name) => ({
    id: name,
    name,
    value: remaining[name] ?? '',
  }));
  for (const name of DEFAULT_HEADER_NAMES) {
    delete remaining[name];
  }
  for (const [name, value] of Object.entries(remaining)) {
    rows.push({ id: nextId(), name, value });
  }
  return rows;
}

function rowsToHeaders(rows: HeaderRow[]): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  for (const row of rows) {
    const name = row.name.trim();
    const value = row.value.trim();
    if (name && value) headers[name] = value;
  }
  return Object.keys(headers).length ? headers : undefined;
}

function optionalList(values: string[]): string[] | undefined {
  return values.length ? values : undefined;
}

function optionalValue(value: string): string | undefined {
  return value && value !== AUTO_VALUE ? value : undefined;
}

type ManualHlsModalProps = {
  open: boolean;
  channelName?: string;
  initial?: ChannelInfo['mappings'][number] | null;
  onOpenChange: (open: boolean) => void;
  onSave: (details: ManualHlsDetails, previousChannelId?: string) => void;
};

export function ManualHlsModal({
  open,
  channelName,
  initial,
  onOpenChange,
  onSave,
}: ManualHlsModalProps) {
  const editing = Boolean(initial?.url);
  const [url, setUrl] = React.useState('');
  const [name, setName] = React.useState('');
  const [resolution, setResolution] = React.useState(AUTO_VALUE);
  const [encode, setEncode] = React.useState(AUTO_VALUE);
  const [languages, setLanguages] = React.useState<string[]>([]);
  const [audioChannels, setAudioChannels] = React.useState<string[]>([]);
  const [visualTags, setVisualTags] = React.useState<string[]>([]);
  const [headerRows, setHeaderRows] = React.useState<HeaderRow[]>(() =>
    headersToRows()
  );

  React.useEffect(() => {
    if (!open) return;
    setUrl(initial?.url ?? '');
    setName(initial?.name && initial.name !== 'Manual HLS' ? initial.name : '');
    setResolution(initial?.resolution || AUTO_VALUE);
    setEncode(initial?.encode || AUTO_VALUE);
    setLanguages(initial?.languages ?? []);
    setAudioChannels(initial?.audioChannels ?? []);
    setVisualTags(initial?.visualTags ?? []);
    setHeaderRows(headersToRows(initial?.headers));
  }, [open, initial]);

  const canSave = isValidStreamUrl(url);

  const handleSave = () => {
    if (!canSave) return;
    onSave(
      {
        url: url.trim(),
        name: name.trim() || 'Manual HLS',
        headers: rowsToHeaders(headerRows),
        resolution: optionalValue(resolution),
        encode: optionalValue(encode),
        languages: optionalList(languages),
        audioChannels: optionalList(audioChannels),
        visualTags: optionalList(visualTags),
      },
      initial?.channelId
    );
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? 'Edit HLS stream' : 'Add HLS stream'}
      description={
        channelName
          ? `Playback URL, headers and formatter metadata for ${channelName}.`
          : 'Playback URL, request headers and formatter metadata.'
      }
      contentClass="max-w-2xl w-[calc(100vw-2rem)] min-w-0 max-h-[90vh] overflow-y-auto"
      footer={
        <>
          <Button intent="primary-outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSave} onClick={handleSave}>
            {editing ? 'Save stream' : 'Add stream'}
          </Button>
        </>
      }
    >
      <div className="min-w-0 space-y-5">
        <div className="space-y-3">
          <TextInput
            label="Stream URL"
            placeholder="https://example.com/live.m3u8"
            value={url}
            onValueChange={(value) => setUrl(value ?? '')}
          />
          <TextInput
            label="Label"
            placeholder="Caras TV FHD"
            help="Shown in Stremio and used to detect resolution if you leave Display empty."
            value={name}
            onValueChange={(value) => setName(value ?? '')}
          />
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">Request headers</p>
            <p className="text-xs text-[--muted]">
              Needed when the origin checks Referer, Origin or User-Agent.
              Streams with headers are marked not web-ready so Stremio can send
              them.
            </p>
          </div>
          <div className="space-y-2">
            {headerRows.map((row, index) => {
              const lockedName = (
                DEFAULT_HEADER_NAMES as readonly string[]
              ).includes(row.id);
              return (
                <div key={row.id} className="flex min-w-0 items-end gap-2">
                  <TextInput
                    className="min-w-0 flex-1"
                    label={index === 0 ? 'Header' : undefined}
                    placeholder="Header"
                    value={row.name}
                    disabled={lockedName}
                    onValueChange={(value) =>
                      setHeaderRows((current) =>
                        current.map((item) =>
                          item.id === row.id
                            ? { ...item, name: value ?? '' }
                            : item
                        )
                      )
                    }
                  />
                  <TextInput
                    className="min-w-0 flex-[2]"
                    label={index === 0 ? 'Value' : undefined}
                    placeholder={
                      row.name === 'User-Agent'
                        ? 'Mozilla/5.0 ...'
                        : row.name === 'Referer'
                          ? 'https://example.com/'
                          : row.name === 'Origin'
                            ? 'https://example.com'
                            : row.name === 'Cookie'
                              ? 'session=...'
                              : 'Value'
                    }
                    value={row.value}
                    onValueChange={(value) =>
                      setHeaderRows((current) =>
                        current.map((item) =>
                          item.id === row.id
                            ? { ...item, value: value ?? '' }
                            : item
                        )
                      )
                    }
                  />
                  {!lockedName ? (
                    <IconButton
                      size="sm"
                      intent="alert-subtle"
                      icon={<BiTrash />}
                      aria-label={`Remove ${row.name || 'header'}`}
                      onClick={() =>
                        setHeaderRows((current) =>
                          current.filter((item) => item.id !== row.id)
                        )
                      }
                    />
                  ) : (
                    <div className="h-10 w-8 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
          <Button
            size="sm"
            intent="primary-subtle"
            leftIcon={<BiPlus />}
            onClick={() =>
              setHeaderRows((current) => [
                ...current,
                { id: nextId(), name: '', value: '' },
              ])
            }
          >
            Add header
          </Button>
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">Display</p>
            <p className="text-xs text-[--muted]">
              Used by the stream formatter (`stream.resolution`, encode,
              languages). Leave on detect to parse the label.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              label="Resolution"
              value={resolution}
              onValueChange={setResolution}
              options={[
                { value: AUTO_VALUE, label: 'Detect from label' },
                ...LIVE_RESOLUTIONS.map((value) => ({ value, label: value })),
              ]}
            />
            <Select
              label="Encode"
              value={encode}
              onValueChange={setEncode}
              options={[
                { value: AUTO_VALUE, label: 'Detect from label' },
                ...LIVE_ENCODES.map((value) => ({ value, label: value })),
              ]}
            />
          </div>
          <Combobox
            multiple
            label="Languages"
            placeholder="Select languages..."
            emptyMessage="No languages"
            value={languages}
            onValueChange={setLanguages}
            options={LANGUAGES.map((value) => ({ value, label: value }))}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Combobox
              multiple
              label="Audio channels"
              placeholder="Optional"
              emptyMessage="No audio layouts"
              value={audioChannels}
              onValueChange={setAudioChannels}
              options={LIVE_AUDIO_CHANNELS.map((value) => ({
                value,
                label: value,
              }))}
            />
            <Combobox
              multiple
              label="Visual tags"
              placeholder="HDR, 10bit..."
              emptyMessage="No visual tags"
              value={visualTags}
              onValueChange={setVisualTags}
              options={LIVE_VISUAL_TAGS.map((value) => ({
                value,
                label: value,
              }))}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
