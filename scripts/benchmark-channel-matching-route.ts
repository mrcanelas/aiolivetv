import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import {
  CHANNEL_LINK_STREAM_CONFIDENCE,
  findPossibleDuplicateChannels,
  prepareChannelMatchCandidate as prepare,
  getPreparedChannelMatchConfidence as preparedScore,
  isHighConfidenceChannelMatch,
  type ChannelMatchCandidate,
} from '../packages/core/src/main/channelMappings.js';
import {
  compactChannelName,
  containsNormalizedChannelName,
  getChannelNameSimilarity,
  normalizeChannelName,
} from '../packages/core/src/utils/channelName.js';
import { decodeHtmlEntities } from '../packages/core/src/utils/text.js';
import { parseXmltvData } from '../packages/core/src/builtins/xmltv-reader/parser.js';
import { parseM3u } from '../packages/core/src/builtins/m3u-reader/parser.js';

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

type RouteCandidate = ChannelMatchCandidate & {
  addonId: string;
  addonName: string;
  canStream: boolean;
  contributesChannels: boolean;
};

type MappingSnapshot = {
  addonId: string;
  channelId: string;
  name: string;
  confidence: number;
};

type ChannelSnapshot = {
  id: string;
  name: string;
  poster?: string | null;
  canonicalAddonId: string;
  mappings: MappingSnapshot[];
  availableStreamSources: MappingSnapshot[];
};

const MAX_AUTO_MATCH_PAIRS = 5_000_000;

function xmlEscape(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function xmltvTimestamp(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())} +0000`;
}

function plannedCatalog(channelCount: number, streamCount: number) {
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
    'SportTV',
    'News',
  ];
  const regions = ['SP', 'RJ', 'Norte', 'Sul', 'Nordeste'];
  const providers = ['MyTV', 'PlayPlus', 'IPTVBR', 'StreamX'];
  const qualities = ['HD', 'FHD', '4K', '1080p'];
  const channels = Array.from({ length: channelCount }, (_, index) => {
    const brand = brands[index % brands.length];
    const region = regions[index % regions.length];
    const name =
      index % 11 === 0
        ? `S\u00e3o Paulo ${brand} ${index}`
        : `${brand} ${region} ${index}`;
    return {
      id: `epg:${index}`,
      tvgId:
        index % 3 === 0
          ? `${brand.toLowerCase().replace('&', '')}.${index}`
          : undefined,
      name,
      aliases: index % 7 === 0 ? [`Station ${index}`] : [],
      country: index % 2 ? 'BR' : 'US',
      language: index % 2 ? 'pt' : 'en',
      categories: [index % 2 ? 'Sports' : 'News'],
      logo: `https://example.invalid/${index}.png`,
    };
  });
  const streams = Array.from({ length: streamCount }, (_, index) => {
    const base = channels[index % channelCount];
    const provider = providers[index % providers.length];
    const quality = qualities[index % qualities.length];
    let name: string;
    if (index % 5 === 0) name = `Unrelated Cinema ${index}`;
    else if (index % 4 === 1) name = `${base.name}x ${quality}`;
    else if (index % 3 === 0) name = `${provider} - ${base.name} ${quality}`;
    else name = `${base.name} ${quality}`;
    return {
      id: `stream:${index}`,
      tvgId:
        index % 4 === 0
          ? base.tvgId
          : index % 11 === 0 && base.tvgId
            ? base.tvgId.toUpperCase()
            : undefined,
      name,
      aliases: index % 7 === 0 ? base.aliases : [],
      country: base.country,
      language: base.language,
      categories: base.categories,
      logo:
        index % 9 === 0
          ? base.logo
          : `https://cdn.example.invalid/${index}.png`,
    };
  });
  return { channels, streams };
}

function buildXmltv(
  channels: ChannelMatchCandidate[],
  programmesPerChannel: number
) {
  const start = new Date();
  start.setUTCHours(12, 0, 0, 0);
  const channelXml = channels
    .map((channel) => {
      const tvgId = xmlEscape(channel.tvgId ?? channel.id);
      const names = [channel.name, ...(channel.aliases ?? [])]
        .map(
          (name, index) =>
            `    <display-name${index === 0 && channel.language ? ` lang="${xmlEscape(channel.language)}"` : ''}>${xmlEscape(name)}</display-name>`
        )
        .join('\n');
      const icon = channel.logo
        ? `\n    <icon src="${xmlEscape(channel.logo)}" />`
        : '';
      return `  <channel id="${tvgId}">\n${names}${icon}\n  </channel>`;
    })
    .join('\n');
  const programmeXml = channels
    .flatMap((channel) =>
      Array.from({ length: programmesPerChannel }, (_, hour) => {
        const begin = new Date(start.getTime() + hour * 3_600_000);
        const end = new Date(begin.getTime() + 3_600_000);
        return `  <programme channel="${xmlEscape(channel.tvgId ?? channel.id)}" start="${xmltvTimestamp(begin)}" stop="${xmltvTimestamp(end)}">
    <title>Programme ${hour + 1}</title>
    <desc>Synthetic guide row</desc>
  </programme>`;
      })
    )
    .join('\n');
  return `<tv>\n${channelXml}\n${programmeXml}\n</tv>\n`;
}

function buildM3u(streams: ChannelMatchCandidate[]) {
  const rows = streams.map((stream) => {
    const attrs = [
      stream.tvgId ? `tvg-id="${xmlEscape(stream.tvgId)}"` : '',
      `tvg-name="${xmlEscape(stream.name)}"`,
      stream.logo ? `tvg-logo="${xmlEscape(stream.logo)}"` : '',
      stream.categories?.[0]
        ? `group-title="${xmlEscape(stream.categories[0])}"`
        : '',
      stream.country ? `tvg-country="${xmlEscape(stream.country)}"` : '',
      stream.language ? `tvg-language="${xmlEscape(stream.language)}"` : '',
    ]
      .filter(Boolean)
      .join(' ');
    return `#EXTINF:-1 ${attrs},${stream.name}\nhttps://example.invalid/${encodeURIComponent(stream.id)}.m3u8`;
  });
  return `#EXTM3U\n${rows.join('\n')}\n`;
}

function candidatesFromParsed(
  xmltvChannels: Array<{
    id: string;
    name: string;
    logo?: string;
    aliases?: string[];
    language?: string;
  }>,
  m3uEntries: Array<{
    channelId: string;
    name: string;
    url: string;
    logo?: string;
    group?: string;
    country?: string;
    language?: string;
  }>
) {
  return {
    catalog: xmltvChannels.map(
      (channel): RouteCandidate => ({
        id: channel.id,
        name: channel.name,
        tvgId: channel.id,
        aliases: channel.aliases,
        language: channel.language,
        logo: channel.logo,
        addonId: 'xmltv-1',
        addonName: 'Guide',
        canStream: false,
        contributesChannels: true,
      })
    ),
    streams: m3uEntries.map(
      (entry): RouteCandidate => ({
        id: entry.channelId,
        name: entry.name,
        tvgId: entry.channelId,
        country: entry.country,
        language: entry.language,
        categories: entry.group ? [entry.group] : undefined,
        logo: entry.logo,
        addonId: 'm3u-1',
        addonName: 'Playlist',
        canStream: true,
        contributesChannels: false,
      })
    ),
  };
}

function snapshot(channels: ChannelSnapshot[]) {
  return channels.map((channel) => ({
    id: channel.id,
    mappings: channel.mappings.map((mapping) => ({
      addonId: mapping.addonId,
      channelId: mapping.channelId,
      confidence: mapping.confidence,
    })),
    availableStreamSources: channel.availableStreamSources.map((mapping) => ({
      addonId: mapping.addonId,
      channelId: mapping.channelId,
      confidence: mapping.confidence,
    })),
  }));
}

function candidateKey(addonId: string, channelId: string) {
  return `${addonId}\0${channelId}`;
}

function autoMatchChannels(
  catalogCandidates: RouteCandidate[],
  streamCandidates: RouteCandidate[],
  score: (left: RouteCandidate, right: RouteCandidate) => number
) {
  const channels: ChannelSnapshot[] = [];
  const assigned = new Set<string>();
  const catalogByKey = new Map(
    catalogCandidates.map((candidate) => [
      candidateKey(candidate.addonId, candidate.id),
      candidate,
    ])
  );
  const resolveCanonical = (channel: ChannelSnapshot): RouteCandidate =>
    catalogByKey.get(candidateKey(channel.canonicalAddonId, channel.id)) ?? {
      id: channel.id,
      name: channel.name,
      logo: channel.poster ?? undefined,
      addonId: channel.canonicalAddonId,
      addonName: channel.canonicalAddonId,
      canStream: false,
      contributesChannels: true,
    };

  for (const candidate of catalogCandidates) {
    channels.push({
      id: candidate.id,
      name: candidate.name,
      poster: candidate.logo,
      canonicalAddonId: candidate.addonId,
      mappings: [],
      availableStreamSources: [],
    });
    assigned.add(candidateKey(candidate.addonId, candidate.id));
  }

  let autoMatchPairs = 0;
  if (streamCandidates.length * channels.length <= MAX_AUTO_MATCH_PAIRS) {
    for (const candidate of streamCandidates) {
      if (assigned.has(candidateKey(candidate.addonId, candidate.id))) continue;
      let best: { channel: ChannelSnapshot; confidence: number } | undefined;
      let suggestion:
        | { channel: ChannelSnapshot; confidence: number }
        | undefined;
      for (const channel of channels) {
        const confidence = score(candidate, resolveCanonical(channel));
        autoMatchPairs += 1;
        if (
          confidence > 0 &&
          (!suggestion || confidence > suggestion.confidence)
        ) {
          suggestion = { channel, confidence };
        }
        if (
          isHighConfidenceChannelMatch(confidence) &&
          (!best || confidence > best.confidence)
        ) {
          best = { channel, confidence };
        }
      }
      const chosen = best ?? suggestion;
      if (!chosen) continue;
      chosen.channel.mappings.push({
        addonId: candidate.addonId,
        channelId: candidate.id,
        name: candidate.name,
        confidence: best ? 1 : chosen.confidence,
      });
      assigned.add(candidateKey(candidate.addonId, candidate.id));
    }
  }

  return { channels, autoMatchPairs, resolveCanonical };
}

function attachAlternatives(
  channels: ChannelSnapshot[],
  streamCandidates: RouteCandidate[],
  resolveCanonical: (channel: ChannelSnapshot) => RouteCandidate,
  score: (left: RouteCandidate, right: RouteCandidate) => number
) {
  let alternativePairs = 0;
  let alternativeKept = 0;
  for (const channel of channels) {
    const used = new Set(
      channel.mappings.map((mapping) =>
        candidateKey(mapping.addonId, mapping.channelId)
      )
    );
    const canonical = resolveCanonical(channel);
    const available: MappingSnapshot[] = [];
    for (const candidate of streamCandidates) {
      if (used.has(candidateKey(candidate.addonId, candidate.id))) continue;
      const confidence = score(candidate, canonical);
      alternativePairs += 1;
      if (confidence < CHANNEL_LINK_STREAM_CONFIDENCE) continue;
      alternativeKept += 1;
      available.push({
        addonId: candidate.addonId,
        channelId: candidate.id,
        name: candidate.name,
        confidence,
      });
    }
    available.sort((left, right) => {
      if (right.confidence !== left.confidence)
        return right.confidence - left.confidence;
      return left.name.localeCompare(right.name, undefined, {
        sensitivity: 'base',
      });
    });
    channel.availableStreamSources = available;
  }
  return { alternativePairs, alternativeKept };
}

function responsePayload(
  channels: ChannelSnapshot[],
  parseXmltvMs: number,
  parseM3uMs: number
) {
  const visible = [...channels].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  );
  return {
    success: true,
    data: {
      channels: visible.map((channel) => ({
        ...channel,
        enabled: true,
        epgProvider: true,
        sourceName: 'Guide',
        availableStreamSources: channel.availableStreamSources,
      })),
      sources: [
        {
          instanceId: 'xmltv-1',
          name: 'Guide',
          ok: true,
          durationMs: parseXmltvMs,
          channelCount: channels.length,
          streamCount: 0,
        },
        {
          instanceId: 'm3u-1',
          name: 'Playlist',
          ok: true,
          durationMs: parseM3uMs,
          channelCount: 0,
          streamCount: channels.reduce(
            (total, channel) => total + channel.mappings.length,
            0
          ),
        },
      ],
      unmatchedStreams: [],
      unavailableStreams: [],
      duplicates: findPossibleDuplicateChannels(visible),
      removedChannels: [],
      scan: {
        durationMs: parseXmltvMs + parseM3uMs,
        budgetMs: null,
        truncated: false,
      },
    },
  };
}

function measure<T>(run: () => T) {
  const started = performance.now();
  const result = run();
  return { ms: performance.now() - started, result };
}

async function measureAsync<T>(run: () => Promise<T>) {
  const started = performance.now();
  const result = await run();
  return { ms: performance.now() - started, result };
}

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const repeats = Number(process.env.BENCH_REPEATS ?? 3);
assert(Number.isInteger(repeats) && repeats > 0);
const programmesPerChannel = Number(process.env.BENCH_PROGRAMMES ?? 2);
assert(Number.isInteger(programmesPerChannel) && programmesPerChannel >= 0);
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
      ];

console.log(
  JSON.stringify({
    node: process.version,
    cpu: cpus()[0].model,
    repeats,
    programmesPerChannel,
    data: 'generated XMLTV+M3U in IPTV-like shape; stream-only matching; no live user config, network, auth or browser',
    scope: 'route-shaped phases: parse, auto-match, alternatives, JSON',
  })
);

function runAssembly(
  catalogCandidates: RouteCandidate[],
  streamCandidates: RouteCandidate[],
  score: (left: RouteCandidate, right: RouteCandidate) => number
) {
  const auto = measure(() =>
    autoMatchChannels(catalogCandidates, streamCandidates, score)
  );
  const alternatives = measure(() =>
    attachAlternatives(
      auto.result.channels,
      streamCandidates,
      auto.result.resolveCanonical,
      score
    )
  );
  return {
    channels: auto.result.channels,
    autoMatchPairs: auto.result.autoMatchPairs,
    alternativePairs: alternatives.result.alternativePairs,
    alternativeKept: alternatives.result.alternativeKept,
    autoMs: auto.ms,
    alternativesMs: alternatives.ms,
    matchMs: auto.ms + alternatives.ms,
  };
}

function preparedScorer(
  catalogCandidates: RouteCandidate[],
  streamCandidates: RouteCandidate[]
) {
  const catalog = catalogCandidates.map(prepare);
  const streams = streamCandidates.map(prepare);
  const catalogByRef = new Map(
    catalogCandidates.map((candidate, index) => [candidate, catalog[index]])
  );
  const streamByRef = new Map(
    streamCandidates.map((candidate, index) => [candidate, streams[index]])
  );
  return (left: RouteCandidate, right: RouteCandidate) =>
    preparedScore(
      streamByRef.get(left) ?? prepare(left),
      catalogByRef.get(right) ?? prepare(right)
    );
}

const warmupPlan = plannedCatalog(16, 24);
const warmupXmltv = await measureAsync(() =>
  parseXmltvData(buildXmltv(warmupPlan.channels, programmesPerChannel))
);
const warmupM3u = measure(() => parseM3u(buildM3u(warmupPlan.streams)));
assert(warmupXmltv.result.channels.length === 16);
assert(warmupM3u.result.length === 24);
const warmupCandidates = candidatesFromParsed(
  warmupXmltv.result.channels,
  warmupM3u.result
);
for (let i = 0; i < 2; i++) {
  runAssembly(
    warmupCandidates.catalog,
    warmupCandidates.streams,
    getChannelMatchConfidence
  );
  runAssembly(
    warmupCandidates.catalog,
    warmupCandidates.streams,
    preparedScorer(warmupCandidates.catalog, warmupCandidates.streams)
  );
}

for (const [channelCount, streamCount] of sizes) {
  const planned = plannedCatalog(channelCount, streamCount);
  const xmltvText = buildXmltv(planned.channels, programmesPerChannel);
  const m3uText = buildM3u(planned.streams);
  const parseXmltv = [];
  const parseM3uTimes = [];
  const currentMatch = [];
  const preparedMatch = [];
  const currentAuto = [];
  const preparedAuto = [];
  const currentAlt = [];
  const preparedAlt = [];
  const currentJson = [];
  const preparedJson = [];
  const preparation = [];
  let lastStats:
    | {
        autoMatchPairs: number;
        alternativePairs: number;
        alternativeKept: number;
        mappedStreams: number;
        jsonBytes: number;
      }
    | undefined;

  for (let iteration = 0; iteration < repeats; iteration++) {
    const xmltv = await measureAsync(() => parseXmltvData(xmltvText));
    const m3u = measure(() => parseM3u(m3uText));
    assert.equal(xmltv.result.channels.length, channelCount);
    assert.equal(m3u.result.length, streamCount);
    parseXmltv.push(xmltv.ms);
    parseM3uTimes.push(m3u.ms);

    const { catalog: catalogCandidates, streams: streamCandidates } =
      candidatesFromParsed(xmltv.result.channels, m3u.result);

    const prepared = measure(() =>
      preparedScorer(catalogCandidates, streamCandidates)
    );

    const runCurrent = () => {
      const assembled = runAssembly(
        catalogCandidates,
        streamCandidates,
        getChannelMatchConfidence
      );
      const json = measure(() =>
        JSON.stringify(responsePayload(assembled.channels, xmltv.ms, m3u.ms))
      );
      return { assembled, json };
    };
    const runPrepared = () => {
      const assembled = runAssembly(
        catalogCandidates,
        streamCandidates,
        prepared.result
      );
      const json = measure(() =>
        JSON.stringify(responsePayload(assembled.channels, xmltv.ms, m3u.ms))
      );
      return { assembled, json };
    };

    const first = iteration % 2 ? runPrepared() : runCurrent();
    const second = iteration % 2 ? runCurrent() : runPrepared();
    const current = iteration % 2 ? second : first;
    const optimized = iteration % 2 ? first : second;
    assert.deepEqual(
      snapshot(optimized.assembled.channels),
      snapshot(current.assembled.channels),
      'Route assembly changed'
    );

    const jsonBytes = Buffer.byteLength(current.json.result);
    lastStats = {
      autoMatchPairs: current.assembled.autoMatchPairs,
      alternativePairs: current.assembled.alternativePairs,
      alternativeKept: current.assembled.alternativeKept,
      mappedStreams: current.assembled.channels.reduce(
        (total, channel) => total + channel.mappings.length,
        0
      ),
      jsonBytes,
    };

    currentMatch.push(current.assembled.matchMs);
    preparedMatch.push(optimized.assembled.matchMs + prepared.ms);
    currentAuto.push(current.assembled.autoMs);
    preparedAuto.push(optimized.assembled.autoMs);
    currentAlt.push(current.assembled.alternativesMs);
    preparedAlt.push(optimized.assembled.alternativesMs);
    currentJson.push(current.json.ms);
    preparedJson.push(optimized.json.ms);
    preparation.push(prepared.ms);

    console.log(
      JSON.stringify({
        progress: `${channelCount}x${streamCount}`,
        iteration: iteration + 1,
        parseXmltvMs: xmltv.ms,
        parseM3uMs: m3u.ms,
        currentAutoMatchMs: current.assembled.autoMs,
        currentAlternativesMs: current.assembled.alternativesMs,
        currentMatchMs: current.assembled.matchMs,
        preparedMatchIncludingSetupMs:
          optimized.assembled.matchMs + prepared.ms,
        currentJsonMs: current.json.ms,
        jsonBytes,
      })
    );
  }

  assert(lastStats);
  console.log(
    JSON.stringify({
      channels: channelCount,
      streams: streamCount,
      xmltvBytes: Buffer.byteLength(xmltvText),
      m3uBytes: Buffer.byteLength(m3uText),
      programmes: channelCount * programmesPerChannel,
      autoMatchPairs: lastStats.autoMatchPairs,
      alternativePairs: lastStats.alternativePairs,
      scoringPairs: lastStats.autoMatchPairs + lastStats.alternativePairs,
      mappedStreams: lastStats.mappedStreams,
      alternativesKept: lastStats.alternativeKept,
      jsonBytes: lastStats.jsonBytes,
      medianParseXmltvMs: median(parseXmltv),
      medianParseM3uMs: median(parseM3uTimes),
      medianCollectionMs: median(
        parseXmltv.map((value, index) => value + parseM3uTimes[index])
      ),
      medianCurrentAutoMatchMs: median(currentAuto),
      medianCurrentAlternativesMs: median(currentAlt),
      medianCurrentMatchMs: median(currentMatch),
      medianPreparedAutoMatchMs: median(preparedAuto),
      medianPreparedAlternativesMs: median(preparedAlt),
      medianPreparedMatchIncludingSetupMs: median(preparedMatch),
      matchingSpeedup: median(currentMatch) / median(preparedMatch),
      medianPreparationMs: median(preparation),
      medianCurrentJsonMs: median(currentJson),
      medianPreparedJsonMs: median(preparedJson),
      scoresExactlyEqual: true,
    })
  );
}

process.exit(0);
