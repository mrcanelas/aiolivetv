import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import {
  prepareChannelMatchCandidate as prepare,
  getPreparedChannelMatchConfidence as preparedScore,
  type ChannelMatchCandidate,
} from '../packages/core/src/main/channelMappings.js';
import {
  compactChannelName,
  containsNormalizedChannelName,
  getChannelNameSimilarity,
  normalizeChannelName,
} from '../packages/core/src/utils/channelName.js';
import { decodeHtmlEntities } from '../packages/core/src/utils/text.js';

// Frozen pre-optimization scorer for differential checks and baseline timings.
const normaliseId = (value?: string) =>
  decodeHtmlEntities(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

function equalId(left?: string, right?: string) {
  const normalizedLeft = normaliseId(left);
  return Boolean(normalizedLeft && normalizedLeft === normaliseId(right));
}

function equalOptional(a?: string, b?: string) {
  const left = normaliseId(a);
  return Boolean(left && left === normaliseId(b));
}

function overlaps(left: string[] = [], right: string[] = []) {
  const values = new Set(left.map(normalizeChannelName).filter(Boolean));
  return right.some((value) => values.has(normalizeChannelName(value)));
}

function collectNameEntries(candidate: ChannelMatchCandidate) {
  const entries: Array<{ value: string; alias: boolean }> = [];
  if (candidate.name) entries.push({ value: candidate.name, alias: false });
  for (const alias of candidate.aliases ?? []) {
    entries.push({ value: alias, alias: true });
  }
  return entries;
}

function scoreNamePair(
  left: { value: string; alias: boolean },
  right: { value: string; alias: boolean }
) {
  const leftNorm = normalizeChannelName(left.value);
  const rightNorm = normalizeChannelName(right.value);
  if (!leftNorm || !rightNorm) return 0;

  const aliasMatch = left.alias || right.alias;
  const leftCompact = compactChannelName(left.value);
  const rightCompact = compactChannelName(right.value);
  const minCompact = Math.min(leftCompact.length, rightCompact.length);

  if (
    leftNorm === rightNorm ||
    (leftCompact.length >= 2 && leftCompact === rightCompact)
  ) {
    return aliasMatch ? 0.88 : 0.9;
  }

  if (minCompact <= 3) return 0;

  let score = Math.max(
    getChannelNameSimilarity(leftNorm, rightNorm),
    getChannelNameSimilarity(leftCompact, rightCompact)
  );

  if (
    containsNormalizedChannelName(left.value, right.value) ||
    containsNormalizedChannelName(right.value, left.value)
  ) {
    score = Math.max(score, 0.85);
  }

  if (!score) return 0;
  if (aliasMatch) return Math.min(score, 0.88);
  return score;
}

function matchNormalizedNames(
  left: ChannelMatchCandidate,
  right: ChannelMatchCandidate
) {
  let best = 0;
  for (const leftEntry of collectNameEntries(left)) {
    for (const rightEntry of collectNameEntries(right)) {
      best = Math.max(best, scoreNamePair(leftEntry, rightEntry));
    }
  }
  return best;
}

function getChannelMatchConfidence(
  left: ChannelMatchCandidate,
  right: ChannelMatchCandidate
) {
  if (
    equalId(left.tvgId, right.tvgId) ||
    equalId(left.tvgId, right.id) ||
    equalId(left.id, right.tvgId)
  ) {
    return 1;
  }

  let score = matchNormalizedNames(left, right);
  if (!score) return 0;

  if (equalOptional(left.country, right.country)) score += 0.03;
  if (equalOptional(left.language, right.language)) score += 0.03;
  if (overlaps(left.categories, right.categories)) score += 0.02;
  if (equalOptional(left.logo, right.logo)) score += 0.02;
  return Math.min(score, 0.99);
}

function fixture(channelCount: number, streamCount: number) {
  const brands = [
    'Globo',
    'ESPN',
    'HBO',
    'Discovery',
    'BBC',
    'CNN',
    'Arte',
    'FOX',
    'A&E',
    'SBT',
    'Sport',
    'News',
  ];
  const regions = ['North', 'South', 'East', 'West', 'Central'];
  const channels: ChannelMatchCandidate[] = Array.from(
    { length: channelCount },
    (_, index) => ({
      id: `catalog:${index}`,
      name: `${brands[index % brands.length]} ${regions[index % regions.length]} ${index}`,
      tvgId: index % 3 === 0 ? `channel.${index}` : undefined,
      aliases: index % 7 === 0 ? [`Station ${index}`] : [],
      country: index % 2 ? 'BR' : 'US',
      language: index % 2 ? 'pt' : 'en',
      categories: [index % 2 ? 'Sports' : 'News'],
      logo: `https://example.invalid/${index}.png`,
    })
  );
  const streams = Array.from({ length: streamCount }, (_, index) => {
    const base = channels[index % channelCount];
    return {
      ...base,
      id: `stream:${index}`,
      tvgId: index % 4 === 0 ? base.tvgId : undefined,
      name:
        index % 5 === 0
          ? `Unrelated Cinema ${index}`
          : `${base.name}${index % 4 === 1 ? 'x' : ''} HD`,
      aliases: index % 7 === 0 ? base.aliases : [],
    };
  });
  return { channels, streams };
}

function matrix<A>(channels: A[], streams: A[], score: (a: A, b: A) => number) {
  const values = new Float64Array(channels.length * streams.length);
  let index = 0;
  for (const channel of channels)
    for (const stream of streams) values[index++] = score(stream, channel);
  return values;
}
function measure<T>(run: () => T) {
  const started = performance.now();
  const result = run();
  return { ms: performance.now() - started, result };
}
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const repeats = Number(process.env.BENCH_REPEATS ?? 3);
assert(Number.isInteger(repeats) && repeats > 0);
const sizes = process.env.BENCH_SIZES
  ? process.env.BENCH_SIZES.split(',').map((size) => {
      const dimensions = size.split('x').map(Number);
      assert(
        dimensions.length === 2 &&
          dimensions.every((value) => Number.isInteger(value) && value > 0)
      );
      return dimensions;
    })
  : process.env.BENCH_QUICK
    ? [[64, 100]]
    : [
        [128, 200],
        [512, 800],
        [1287, 2000],
      ];
console.log(
  JSON.stringify({
    node: process.version,
    cpu: cpus()[0].model,
    repeats,
    data: 'deterministic synthetic; no network, database, rendering or production changes',
    scope: 'exhaustive scoring kernel, not full route',
  })
);
const edgeNames = [
  '',
  'A&E',
  'A&amp;E HD',
  'TV',
  'ESPN2',
  'ESPN 2',
  'FOX (103A)',
  'BBC News',
  'BBC News West',
  'a b',
  'abc',
  'abcd',
  'abcde',
  'Provider - Globo HD',
  'S\u00e3o Paulo',
  '&#83;ao Paulo',
  'HBO West',
  'HBO East',
  'Caf\u00e9',
  'Cafe',
  'News 1080p',
  'Station: Provider - News',
  'Unknown',
];
const edgeCases: ChannelMatchCandidate[] = edgeNames.flatMap((name, index) => [
  { id: `edge:${index}`, name },
  {
    id: index % 2 ? 'Shared&amp;ID' : `edge:${index}`,
    tvgId: index % 3 ? 'shared&id' : undefined,
    name,
    aliases: [edgeNames[(index + 1) % edgeNames.length], '', 'Alias HD'],
    country: index % 2 ? 'BR' : 'br',
    language: index % 2 ? 'PT' : 'pt',
    categories: index % 2 ? ['SPORTS HD', ''] : ['sports', 'News'],
    logo: index % 2 ? 'LOGO' : 'logo',
  },
]);
assert.deepEqual(
  matrix(edgeCases.map(prepare), edgeCases.map(prepare), preparedScore),
  matrix(edgeCases, edgeCases, getChannelMatchConfidence)
);
console.log(
  JSON.stringify({
    edgeCasePairsVerified: edgeCases.length ** 2,
    scoresExactlyEqual: true,
  })
);
const warmup = fixture(16, 24);
for (let i = 0; i < 3; i++) {
  matrix(warmup.channels, warmup.streams, getChannelMatchConfidence);
  matrix(
    warmup.channels.map(prepare),
    warmup.streams.map(prepare),
    preparedScore
  );
}
for (const [channelCount, streamCount] of sizes) {
  const { channels, streams } = fixture(channelCount, streamCount);
  const baseline: number[] = [],
    optimized: number[] = [],
    lazy: number[] = [],
    preparation: number[] = [];
  let pairsVerified = 0;
  for (let iteration = 0; iteration < repeats; iteration++) {
    const prepared = measure(() => ({
      channels: channels.map(prepare),
      streams: streams.map(prepare),
    }));
    const runCurrent = () =>
      measure(() => matrix(channels, streams, getChannelMatchConfidence));
    const runPrepared = () =>
      measure(() =>
        matrix(prepared.result.channels, prepared.result.streams, preparedScore)
      );
    // Alternate timing order to reduce systematic warmup/order bias.
    const first = iteration % 2 ? runPrepared() : runCurrent();
    const second = iteration % 2 ? runCurrent() : runPrepared();
    const current = iteration % 2 ? second : first;
    const next = iteration % 2 ? first : second;
    assert.deepEqual(next.result, current.result, 'Scoring changed');
    pairsVerified += current.result.length;
    const onDemand = measure(() =>
      matrix(
        [prepared.result.channels[0]],
        prepared.result.streams,
        preparedScore
      )
    );
    assert.deepEqual(onDemand.result, current.result.slice(0, streamCount));
    baseline.push(current.ms);
    optimized.push(next.ms + prepared.ms);
    preparation.push(prepared.ms);
    lazy.push(onDemand.ms);
    console.log(
      JSON.stringify({
        progress: `${channelCount}x${streamCount}`,
        iteration: iteration + 1,
        currentMs: current.ms,
        preparedIncludingSetupMs: next.ms + prepared.ms,
      })
    );
  }
  console.log(
    JSON.stringify({
      channels: channelCount,
      streams: streamCount,
      pairsPerPass: channelCount * streamCount,
      pairsVerified,
      medianCurrentMs: median(baseline),
      medianPreparedIncludingSetupMs: median(optimized),
      speedup: median(baseline) / median(optimized),
      medianPreparationMs: median(preparation),
      medianOneChannelAlternativesMs: median(lazy),
      scoresExactlyEqual: true,
    })
  );
}
