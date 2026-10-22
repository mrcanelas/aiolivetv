import { formatMilliseconds } from '../utils/index.js';
import type { ParsedStream } from '../db/schemas.js';
import type { AIOStreamsContext, StatEntry, PipelineTimings } from './types.js';

/** Split a flat filter-details array into per-📌-header groups. */
export function splitByPin(details: string[]): string[][] {
  const groups: string[][] = [];
  let currentGroup: string[] = [];
  for (const line of details) {
    if (line.trim().startsWith('📌')) {
      if (currentGroup.length > 0) groups.push(currentGroup);
      currentGroup = [line];
    } else {
      currentGroup.push(line);
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup);
  return groups;
}

/**
 * Push filter statistic entries (removal reasons + included reasons) into `statistics`.
 * Groups whose header matches an entry in `excludeHeaders` are silently skipped.
 */
export function pushFilterStats(
  statistics: StatEntry[],
  filterDetails: string[],
  includedDetails: string[],
  forced: boolean,
  excludeHeaders: string[] = []
): void {
  const push = (details: string[], title: string) => {
    for (const group of splitByPin(details)) {
      const header = group[0]?.trim() ?? '';
      if (excludeHeaders.some((ex) => header.startsWith(`📌 ${ex}`))) continue;
      const entry: StatEntry = { title, description: group.join('\n').trim() };
      if (forced) entry.forced = true;
      statistics.push(entry);
    }
  };
  if (filterDetails.length > 0) push(filterDetails, '🔍 Removal Reasons');
  if (includedDetails.length > 0) push(includedDetails, '🔍 Included Reasons');
}

export function buildStatistics(
  ctx: Pick<AIOStreamsContext, 'userData' | 'filterer' | 'precomputer'>,
  finalStreams: ParsedStream[],
  fetchMs: number,
  pipelineTimings: PipelineTimings
): StatEntry[] {
  const { userData, filterer, precomputer } = ctx;
  const statistics: StatEntry[] = [];
  const fmtMs = (ms: number) => formatMilliseconds(ms);

  const { filterDetails, includedDetails } =
    filterer.getFormattedFilterDetails();

  if (
    userData.statistics?.enabled &&
    userData.statistics?.statsToShow?.includes('filter')
  ) {
    pushFilterStats(statistics, filterDetails, includedDetails, false);
  }

  // Forced filter stats when 0 streams remain - only if not already shown above
  const alreadyShowingFilterStats =
    userData.statistics?.enabled &&
    userData.statistics?.statsToShow?.includes('filter');
  if (
    userData.statistics?.showFilterStatsOnNoStreams !== false &&
    finalStreams.length === 0 &&
    !alreadyShowingFilterStats
  ) {
    pushFilterStats(statistics, filterDetails, includedDetails, true);
  }

  if (
    userData.statistics?.enabled &&
    userData.statistics?.statsToShow?.includes('timing')
  ) {
    const filterTimings = filterer.getFilterTimings();
    const accumulatedPrecompute = precomputer.getPrecomputeTimings();
    // totalMs uses pipeline-phase timings only (fetchMs already contains the fetcher filter/precompute)
    const totalMs =
      fetchMs +
      pipelineTimings.metaFilterMs +
      pipelineTimings.deduplicationMs +
      pipelineTimings.precomputeMs +
      pipelineTimings.sortMs +
      pipelineTimings.limitMs +
      pipelineTimings.selMs;

    {
      const lines: string[] = [`📥 Fetch: ${fmtMs(fetchMs)}`];
      // Show accumulated filter total (fetcher + optional re-filter pass)
      if (filterTimings.totalMs > 0) {
        lines.push(`🔍 Filter: ${fmtMs(filterTimings.totalMs)}`);
      }
      lines.push(
        `🔄 Dedup: ${fmtMs(pipelineTimings.deduplicationMs)}`,
        // Show accumulated precompute total (fetcher + optional pipeline pass)
        `⚙️ Precompute: ${fmtMs(accumulatedPrecompute.totalMs)}`,
        `📊 Sort: ${fmtMs(pipelineTimings.sortMs)}`,
        `✂️ Limit: ${fmtMs(pipelineTimings.limitMs)}`,
        `🎯 SEL: ${fmtMs(pipelineTimings.selMs)}`,
        `${'─'.repeat(20)}`,
        `⏱️ Total: ~${fmtMs(totalMs)}`
      );
      statistics.push({
        title: '⏱️ Pipeline Timing',
        description: lines.join('\n'),
      });
    }

    if (filterTimings.calls > 0) {
      const lines: string[] = [
        `⏱️ Total: ${fmtMs(filterTimings.totalMs)} (${filterTimings.calls} call${filterTimings.calls > 1 ? 's' : ''})`,
        `${'─'.repeat(20)}`,
        `🔑 Regex access: ${fmtMs(filterTimings.regexAccessMs)}`,
        `⚡ Expressions: ${fmtMs(filterTimings.expressionMs)}`,
        `🔨 Regex compile: ${fmtMs(filterTimings.regexCompileMs)}`,
        `🧪 Regex test: ${fmtMs(filterTimings.regexTestMs)}`,
        `🌪️ Filter pass: ${fmtMs(filterTimings.filterPassMs)}`,
      ];
      statistics.push({
        title: '🔍 Filter Breakdown',
        description: lines.join('\n'),
      });
    }

    if (accumulatedPrecompute.totalMs > 0) {
      const sub = accumulatedPrecompute;
      const fetcherPrecomputeMs =
        accumulatedPrecompute.totalMs - pipelineTimings.precomputeMs;
      const rows: Array<[string, number, string]> = [
        ['Preferred regex', sub.preferredRegexMs, '⭐'],
        ['Ranked regex', sub.rankedRegexMs, '📈'],
        ['Ranked SEL', sub.rankedSELMs, '🎯'],
        ['Preferred SEL', sub.preferredSELMs, '✨'],
      ];
      const activeRows = rows.filter(([, ms]) => (ms as number) > 0);
      if (activeRows.length > 0) {
        const lines: string[] = [
          `⏱️ Total: ${fmtMs(accumulatedPrecompute.totalMs)}`,
        ];
        if (fetcherPrecomputeMs > 0 && pipelineTimings.precomputeMs > 0) {
          lines.push(
            `    • Fetcher: ${fmtMs(fetcherPrecomputeMs)}`,
            `    • Pipeline: ${fmtMs(pipelineTimings.precomputeMs)}`
          );
        }
        lines.push(`${'─'.repeat(20)}`);
        for (const [label, ms, emoji] of activeRows) {
          lines.push(`${emoji} ${label}: ${fmtMs(ms as number)}`);
        }
        statistics.push({
          title: '⚙️ Precompute Breakdown',
          description: lines.join('\n'),
        });
      }
    }
  }

  return statistics;
}
