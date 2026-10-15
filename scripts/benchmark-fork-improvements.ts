import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { cpus, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import type { ChannelMatchCandidate } from '../packages/core/src/main/channelMappings.js';

// Load actual before/after implementations without checking out or building either revision.
const root = resolve('.');
const baseline =
  process.env.BENCH_BASE_REF ?? '41bbdfa7370ed38eb8525aae17fb25194b2b8519';
const repeats = Number(process.env.BENCH_REPEATS ?? 5);
assert(Number.isInteger(repeats) && repeats >= 3);
const scratch = await mkdtemp(join(tmpdir(), 'aiolivetv-perf-'));
const require = createRequire(import.meta.url);
const moduleUrl = (path: string) => pathToFileURL(path).href;
const repoUrl = (path: string) => moduleUrl(resolve(root, path));
const results: unknown[] = [];
const emit = (result: unknown) => {
  results.push(result);
  console.log(JSON.stringify(result));
};
const source = (path: string, ref?: string) =>
  ref
    ? Promise.resolve(
        execFileSync('git', ['show', `${ref}:${path}`], {
          cwd: root,
          encoding: 'utf8',
          maxBuffer: 8 * 1024 * 1024,
        })
      )
    : readFile(resolve(root, path), 'utf8');

function rewrite(
  code: string,
  original: string,
  overrides: Record<string, string> = {}
) {
  return code.replace(
    /(from\s+|import\s+)(['"])([^'"]+)\2/g,
    (match, prefix, quote, specifier) => {
      const replacement =
        overrides[specifier] ??
        (specifier.startsWith('.')
          ? moduleUrl(
              resolve(
                root,
                dirname(original),
                specifier.replace(/\.js$/, '.ts')
              )
            )
          : undefined);
      return replacement ? `${prefix}${quote}${replacement}${quote}` : match;
    }
  );
}

async function save(name: string, code: string) {
  const path = join(scratch, name + '.mts');
  await writeFile(path, code);
  return moduleUrl(path);
}

async function load(label: string, ref?: string) {
  const namesPath = 'packages/core/src/utils/channelName.ts';
  const names = await save(
    label + '-names',
    rewrite(await source(namesPath, ref), namesPath)
  );
  const scorerPath = 'packages/core/src/main/channelMappings.ts';
  const scorerUrl = await save(
    label + '-scorer',
    rewrite(await source(scorerPath, ref), scorerPath, {
      '../utils/channelName.js': names,
    })
  );
  const scorer = await import(scorerUrl);
  return {
    label,
    ref:
      ref ??
      execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    scorer,
    scorerUrl,
    names,
  };
}
type Revision = Awaited<ReturnType<typeof load>>;
const median = (samples: number[]) =>
  [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)];
const stats = (samples: number[]) => ({
  medianMs: median(samples),
  minMs: Math.min(...samples),
  maxMs: Math.max(...samples),
  samplesMs: samples,
});
const letters = (index: number): string =>
  index >= 26
    ? letters(Math.floor(index / 26) - 1) + letters(index % 26)
    : String.fromCharCode(97 + index);

function fixture(channels: number, streams: number, kind: string) {
  const brands = [
    'BBC',
    'Premier Sports',
    'TNT Sports',
    'Discovery',
    'Globo',
    'HBO',
    'CNN',
    'Arte',
  ];
  const canonical: ChannelMatchCandidate[] = Array.from(
    { length: channels },
    (_, index) => ({
      id: `catalog:${index}`,
      name: `${brands[index % brands.length]} ${letters(index)}${kind === 'numbered' ? ` ${index}` : kind === 'same-number' ? ' 1' : ''}`,
      aliases: index % 7 === 0 ? [`Station ${letters(index)}`] : [],
      country: index % 2 ? 'GB' : 'BR',
      language: index % 2 ? 'en' : 'pt',
      categories: ['Sports'],
    })
  );
  const candidates = Array.from({ length: streams }, (_, index) => ({
    ...canonical[index % channels],
    id: `stream:${index}`,
    name:
      canonical[index % channels].name +
      (index % 4 === 0 ? ' International HD' : ' HD'),
  }));
  return { canonical, candidates };
}

function kernel(revision: Revision, data: ReturnType<typeof fixture>) {
  const started = performance.now();
  const canonical = data.canonical.map(
    revision.scorer.prepareChannelMatchCandidate
  );
  const candidates = data.candidates.map(
    revision.scorer.prepareChannelMatchCandidate
  );
  const preparationMs = performance.now() - started;
  let checksum = 0;
  for (const channel of canonical)
    for (const candidate of candidates)
      checksum += revision.scorer.getPreparedChannelMatchConfidence(
        candidate,
        channel
      );
  assert(Number.isFinite(checksum) && checksum > 0);
  return { ms: performance.now() - started, preparationMs, checksum };
}

async function setupRoute(revision: Revision) {
  // Real Express handler and scorers; only provider I/O, auth, validation and cache are fixtures.
  const fixtureUrl = await save(
    revision.label + '-route-fixture',
    `
    export * from ${JSON.stringify(revision.scorerUrl)};
    export { decodeHtmlEntities } from ${JSON.stringify(repoUrl('packages/core/src/utils/text.ts'))};
    export { normalizeChannelGroup } from ${JSON.stringify(revision.names)};
    export { parseDeclaredStreamInfo } from ${JSON.stringify(repoUrl('packages/core/src/streams/declared.ts'))};
    import * as constants from ${JSON.stringify(repoUrl('packages/core/src/utils/constants.ts'))};
    export { constants };
    export const state = { channels: [], streams: [], events: 0, pageSize: 100, delayMs: 0, rounded: false, calls: 0 };
    export const config = { resources: { timeouts: { channelScan: 0 } } };
    export const createLogger = () => ({ info() {}, warn() {}, error() {} });
    export const createResponse = value => value;
    export const catalogApiRateLimiter = (_req, _res, next) => next();
    export const attachSession = catalogApiRateLimiter;
    export const injectAccessKey = () => {};
    export const validateConfig = async data => structuredClone(data);
    export class APIError extends Error {}
    export const UserRepository = {};
    export const mergeConfigs = Object.assign;
    export const Cache = { getInstance: () => ({ get: async () => undefined, set: async () => {}, delete: async () => {} }) };
    export const getSimpleTextHash = value => value;
    export const addonProvidesResource = (addon, resource) => addon.instanceId === 'guide' ? resource === 'catalog' : resource === 'stream';
    export const catalogSupportsSkip = () => true;
    const addons = ['guide', 'streams'].map(id => ({ instanceId: id, name: id, preset: { type: id === 'guide' ? 'xmltv' : 'custom' } }));
    export class AIOStreams {
      async initialise() { return this; }
      getAddons() { return addons; }
      getAddon(id) { return addons.find(addon => addon.instanceId === id); }
      getInitialisationErrors() { return []; }
      getManifest(id) { return { resources: id === 'guide' ? ['catalog', 'meta'] : ['stream'], catalogs: [
        { id: 'channels', type: 'tv', extra: [{ name: 'skip' }] },
        ...(id === 'streams' && state.events ? [{ id: 'events', type: 'tv', extra: [{ name: 'skip' }] }] : [])
      ], behaviorHints: { epgProvider: id === 'guide' } }; }
      async getCatalog(_type, id, extras) {
        state.calls++;
        if (state.delayMs) await new Promise(resolve => setTimeout(resolve, state.delayMs));
        let skip = Number(new URLSearchParams(extras).get('skip') || 0);
        if (state.rounded) skip = Math.floor(skip / state.pageSize) * state.pageSize;
        const items = id.startsWith('guide.') ? state.channels : id.endsWith('.events')
          ? Array.from({ length: state.events }, (_, index) => ({ id: 'event:' + index, name: 'One off event ' + index })) : state.streams;
        return { success: true, errors: [], data: items.slice(skip, skip + state.pageSize) };
      }
    }
  `
  );
  const routePath = 'packages/server/src/routes/api/catalog.ts';
  const expressUrl = moduleUrl(
    require.resolve('express', { paths: [resolve(root, 'packages/server')] })
  );
  const routeUrl = await save(
    revision.label + '-route',
    rewrite(
      await source(
        routePath,
        revision.label === 'before' ? baseline : undefined
      ),
      routePath,
      {
        '@aiolivetv/core': fixtureUrl,
        '../../utils/responses.js': fixtureUrl,
        '../../middlewares/ratelimit.js': fixtureUrl,
        '../../middlewares/auth.js': fixtureUrl,
        express: expressUrl,
      }
    )
  );
  const { default: express } = await import(expressUrl);
  const { default: route } = await import(routeUrl);
  const { state } = await import(fixtureUrl);
  const app = express();
  app.use(express.json());
  app.use('/catalogs', route);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  return {
    state,
    server,
    url: `http://127.0.0.1:${address.port}/catalogs/channels`,
  };
}

async function scan(
  route: Awaited<ReturnType<typeof setupRoute>>,
  scenario: {
    channels: number;
    streams: number;
    pageSize: number;
    delayMs: number;
    autoMatch: boolean;
    events?: number;
    rounded?: boolean;
    kind?: string;
  }
) {
  const data = fixture(
    scenario.channels,
    scenario.streams,
    scenario.kind ?? 'numbered'
  );
  Object.assign(route.state, {
    channels: data.canonical,
    streams: data.candidates,
    pageSize: scenario.pageSize,
    delayMs: scenario.delayMs,
    events: scenario.events ?? 0,
    rounded: scenario.rounded ?? false,
    calls: 0,
  });
  const start = performance.now();
  const response = await fetch(route.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userData: { presets: [], channelMappings: [] },
      autoMatch: scenario.autoMatch,
    }),
  });
  assert.equal(response.status, 200);
  const { data: result } = await response.json();
  assert.equal(result.channels.length, scenario.channels);
  assert.equal(result.scan.truncated, false);
  return {
    ms: performance.now() - start,
    calls: route.state.calls,
    matchingPairs: result.scan.matchingPairs,
    bytes: Buffer.byteLength(JSON.stringify(result)),
    mappings: result.channels.reduce(
      (sum, channel) => sum + channel.mappings.length,
      0
    ),
  };
}

async function setupFetcher(revision: Revision) {
  const fixtureUrl = await save(
    revision.label + '-fetch-fixture',
    `
    export * as constants from ${JSON.stringify(repoUrl('packages/core/src/utils/constants.ts'))};
    export const state = { delayMs: 10, calls: 0, active: 0, peak: 0 };
    export const createLogger = () => ({ debug() {}, warn() {}, error() {} });
    export const getAddonName = addon => addon.name;
    export const getTimeTakenSincePoint = () => '0ms';
    export const classifyAddonError = () => ({ error_kind: 'network' });
    export class Wrapper {
      constructor(addon) { this.addon = addon; }
      async getStreams(_type, id) {
        state.calls++; state.active++; state.peak = Math.max(state.peak, state.active);
        if (state.delayMs) await new Promise(resolve => setTimeout(resolve, state.delayMs));
        state.active--;
        return [{ id: this.addon.instanceId + '-0', addon: this.addon, type: 'live', url: 'https://example.invalid/' + id }];
      }
    }
    export class ExitConditionEvaluator {}
    export class GroupConditionEvaluator {}
    export default class StreamDeduplicator { async deduplicate(streams) { return streams; } }
  `
  );
  const path = 'packages/core/src/streams/fetcher.ts';
  const url = await save(
    revision.label + '-fetcher',
    rewrite(
      await source(path, revision.label === 'before' ? baseline : undefined),
      path,
      Object.fromEntries(
        [
          '../utils/index.js',
          '../main/wrapper.js',
          '../parser/streamExpression.js',
          './deduplicator.js',
          '../analytics/index.js',
        ].map((specifier) => [specifier, fixtureUrl])
      )
    )
  );
  return {
    Fetcher: (await import(url)).default,
    state: (await import(fixtureUrl)).state,
  };
}

try {
  const before = await load('before', baseline);
  const after = await load('after');
  emit({
    environment: {
      node: process.version,
      cpu: cpus()[0].model,
      baseline: before.ref,
      current: after.ref,
      worktreeChanges: execFileSync('git', ['diff', '--name-only'], {
        encoding: 'utf8',
      })
        .trim()
        .split('\n')
        .filter(Boolean),
      repeats,
      note: 'Sequential alternating runs; deterministic fixtures. Existing user dev processes are not stopped.',
    },
  });
  const sizes = (process.env.BENCH_SIZES ?? '128x200,512x800,1287x2000')
    .split(',')
    .map((size) => size.split('x').map(Number));
  for (const kind of ['numbered', 'unnumbered', 'same-number'])
    for (const [channels, streams] of sizes) {
      const data = fixture(channels, streams, kind);
      const samples = { before: [] as number[], after: [] as number[] };
      const prep = { before: [] as number[], after: [] as number[] };
      for (let warmup = 0; warmup < 3; warmup++)
        for (const revision of [before, after])
          kernel(revision, fixture(32, 50, kind));
      for (let iteration = 0; iteration < repeats; iteration++) {
        for (const revision of iteration % 2
          ? [after, before]
          : [before, after]) {
          const result = kernel(revision, data);
          samples[revision.label].push(result.ms);
          prep[revision.label].push(result.preparationMs);
        }
        console.log(
          JSON.stringify({
            progress: 'matching',
            kind,
            channels,
            streams,
            iteration: iteration + 1,
          })
        );
      }
      emit({
        phase: 'matching',
        kind,
        channels,
        streams,
        pairs: channels * streams,
        before: stats(samples.before),
        after: stats(samples.after),
        ratio: median(samples.after) / median(samples.before),
        preparationBeforeMs: median(prep.before),
        preparationAfterMs: median(prep.after),
      });
    }
  const routes = {
    before: await setupRoute(before),
    after: await setupRoute(after),
  };
  try {
    for (const scenario of [
      {
        name: 'scan-pages-25',
        channels: 1287,
        streams: 0,
        pageSize: 25,
        delayMs: 10,
        autoMatch: false,
      },
      {
        name: 'scan-pages-100',
        channels: 1287,
        streams: 0,
        pageSize: 100,
        delayMs: 10,
        autoMatch: false,
      },
      {
        name: 'scan-rounded-pages',
        channels: 1287,
        streams: 0,
        pageSize: 100,
        delayMs: 10,
        rounded: true,
        autoMatch: false,
      },
      {
        name: 'scan-one-off-events',
        channels: 128,
        streams: 200,
        events: 1800,
        pageSize: 100,
        delayMs: 10,
        autoMatch: true,
      },
      {
        name: 'route-numbered',
        channels: 512,
        streams: 800,
        pageSize: 100,
        delayMs: 0,
        autoMatch: true,
      },
      {
        name: 'route-unnumbered',
        channels: 512,
        streams: 800,
        pageSize: 100,
        delayMs: 0,
        autoMatch: true,
        kind: 'unnumbered',
      },
    ]) {
      const samples = { before: [] as number[], after: [] as number[] };
      const details: Record<string, unknown> = {};
      for (let iteration = -1; iteration < repeats; iteration++)
        for (const revision of iteration % 2
          ? [after, before]
          : [before, after]) {
          const result = await scan(routes[revision.label], scenario);
          if (iteration >= 0) samples[revision.label].push(result.ms);
          details[revision.label] = result;
        }
      emit({
        phase: 'http-route',
        ...scenario,
        before: stats(samples.before),
        after: stats(samples.after),
        ratio: median(samples.after) / median(samples.before),
        details,
      });
    }
  } finally {
    for (const route of Object.values(routes))
      await new Promise<void>((resolve, reject) =>
        route.server.close((error) => (error ? reject(error) : resolve()))
      );
  }
  const fetchers = {
    before: await setupFetcher(before),
    after: await setupFetcher(after),
  };
  for (const count of [1, 3, 20]) {
    const samples = { before: [] as number[], after: [] as number[] };
    const details: Record<string, unknown> = {};
    for (let iteration = -1; iteration < repeats; iteration++)
      for (const revision of iteration % 2
        ? [after, before]
        : [before, after]) {
        const { Fetcher, state } = fetchers[revision.label];
        Object.assign(state, { calls: 0, active: 0, peak: 0 });
        const addon = {
          instanceId: 'addon',
          name: 'Addon',
          preset: { id: 'addon' },
          manifestUrl: 'https://example.invalid/manifest.json',
        };
        const fetcher = new Fetcher(
          {},
          { filter: async (streams) => streams },
          {
            precomputeSeaDexOnly: async () => {},
            precomputePreferred: async () => {},
          }
        );
        const ids = Array.from(
          { length: count },
          (_, index) => 'channel:' + index
        );
        const started = performance.now();
        const result = await fetcher.fetch(
          [addon],
          {
            type: 'tv',
            id: 'canonical',
            queryType: 'tv',
            startAllFetches() {},
          },
          new Map([['addon', revision.label === 'before' ? ids[0] : ids]])
        );
        const ms = performance.now() - started;
        assert.equal(
          result.streams.length,
          revision.label === 'before' ? 1 : count
        );
        if (iteration >= 0) samples[revision.label].push(ms);
        details[revision.label] = {
          calls: state.calls,
          peakConcurrency: state.peak,
          streams: result.streams.length,
        };
      }
    emit({
      phase: 'playback-fetch',
      linkedIds: count,
      providerDelayMs: 10,
      before: stats(samples.before),
      after: stats(samples.after),
      details,
    });
  }
  const output = resolve(
    process.env.BENCH_OUTPUT ?? 'testing/fork-performance.json'
  );
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ output }));
} finally {
  assert.equal(dirname(scratch), tmpdir());
  await rm(scratch, { recursive: true, force: true });
}
