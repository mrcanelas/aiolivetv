import { BiRefresh } from 'react-icons/bi';
import { SettingsCard } from '@/components/shared/settings-card';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/loading-spinner';
import type { ChannelSourceDiagnostic } from '@/lib/api';
import { formatDurationMs, formatFetchedAt } from '../utils';

function SourceKind({ source }: { source: ChannelSourceDiagnostic }) {
  const parts: string[] = [];
  if (source.epgProvider) parts.push('EPG');
  if (source.contributesChannels) parts.push('Channels');
  if (source.canStream) parts.push('Streams');
  return parts.length ? parts.join(' · ') : 'Source';
}

function SourceRow({ source }: { source: ChannelSourceDiagnostic }) {
  const counts = [
    source.channelCount ? `${source.channelCount} channels` : null,
    source.streamCount ? `${source.streamCount} streams` : null,
    source.programCount ? `${source.programCount} programmes` : null,
  ].filter(Boolean);

  return (
    <li
      className={`rounded-[--radius-md] border px-3 py-2.5 ${
        source.ok
          ? 'border-[--border] bg-[var(--background)]'
          : 'border-red-500/40 bg-red-500/10'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold">{source.name}</p>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                source.ok
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400'
                  : 'border-red-500/40 bg-red-500/15 text-red-400'
              }`}
            >
              {source.ok ? 'OK' : 'Error'}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-[--muted]">
            <SourceKind source={source} />
            {source.presetType ? ` · ${source.presetType}` : ''}
          </p>
        </div>
        <p className="text-xs text-[--muted]">
          {formatDurationMs(source.durationMs)}
          {source.fetchedAt ? ` · ${formatFetchedAt(source.fetchedAt)}` : ''}
        </p>
      </div>
      {counts.length > 0 ? (
        <p className="mt-1 text-xs text-[--muted]">{counts.join(' · ')}</p>
      ) : null}
      {source.error ? (
        <p className="mt-1 text-xs text-red-400">{source.error}</p>
      ) : null}
    </li>
  );
}

type SourceDiagnosticsCardProps = {
  sources: ChannelSourceDiagnostic[];
  isRefreshing: boolean;
  disabled?: boolean;
  onRefresh: () => void;
};

export function SourceDiagnosticsCard({
  sources,
  isRefreshing,
  disabled,
  onRefresh,
}: SourceDiagnosticsCardProps) {
  return (
    <SettingsCard
      title="Sources"
      description="Last scan of each catalog and stream source. Refresh tests the sources again and rematches channels."
      action={
        <Button
          size="sm"
          intent="primary-subtle"
          rounded
          leftIcon={
            isRefreshing ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <BiRefresh className="h-4 w-4" />
            )
          }
          onClick={onRefresh}
          disabled={isRefreshing || disabled}
        >
          Test / Refresh now
        </Button>
      }
    >
      {sources.length === 0 ? (
        <p className="py-4 text-center text-sm text-[--muted]">
          Add XMLTV, M3U, Xtream or a live addon on the Addons page to see
          source status here.
        </p>
      ) : (
        <ul className="space-y-2">
          {sources.map((source) => (
            <SourceRow key={source.instanceId} source={source} />
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}
