import type { ParsedFile, ParsedStream, UserData } from '../db/schemas.js';
import { Cache, createLogger } from '../utils/index.js';
import { parseDeclaredStreamInfo } from './declared.js';
import { runFfprobe } from './ffprobe-runner.js';
import {
  mergeDeclaredAndProbed,
  parseFfprobeJson,
  probedStreamToParsedFile,
} from './probed.js';
import { probeWebPlayable } from './web-readiness.js';

const logger = createLogger('stream-probe');
const PROBE_CACHE_PREFIX = 'spb:';
const DEFAULT_PROBE_TIMEOUT_MS = 15_000;
const MAX_CONCURRENT_PROBES = 4;
const PROBE_CACHE_TTL_SECONDS = 60 * 60 * 6;

const probeCache = Cache.getInstance<string, Partial<ParsedFile>>(
  PROBE_CACHE_PREFIX
);

function isProbeableUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function shouldProbeStream(stream: ParsedStream) {
  return (
    (stream.type === 'live' || stream.type === 'http') &&
    !!stream.url &&
    isProbeableUrl(stream.url)
  );
}

function getDeclaredParsedFile(stream: ParsedStream): ParsedFile | undefined {
  if (stream.parsedFile) return stream.parsedFile;
  return parseDeclaredStreamInfo({
    name: stream.filename ?? stream.message ?? stream.originalName,
    description: stream.originalDescription,
  })?.parsedFile;
}

async function probeStreamUrl(
  url: string,
  timeoutMs: number
): Promise<Partial<ParsedFile>> {
  const cached = await probeCache.get(url);
  if (cached) return cached;

  const raw = await runFfprobe(url, { timeoutMs });
  const probed = parseFfprobeJson(url, raw);
  const parsedFile = probedStreamToParsedFile(probed);
  await probeCache.set(url, parsedFile, PROBE_CACHE_TTL_SECONDS);
  return parsedFile;
}

export async function enrichStreamWithProbe(
  stream: ParsedStream,
  timeoutMs: number
): Promise<ParsedStream> {
  if (!shouldProbeStream(stream) || !stream.url) return stream;

  const declared = getDeclaredParsedFile(stream);
  try {
    const probed = await probeStreamUrl(stream.url, timeoutMs);
    stream.parsedFile = mergeDeclaredAndProbed(declared, probed);
    const playable = await probeWebPlayable(stream.url, timeoutMs);
    if (!playable) stream.notWebReady = true;
  } catch (error) {
    logger.debug(
      {
        url: stream.url,
        err: error instanceof Error ? error.message : String(error),
      },
      'stream probe failed'
    );
    if (declared && !stream.parsedFile) {
      stream.parsedFile = declared;
    }
  }
  return stream;
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<T>
): Promise<T[]> {
  if (items.length === 0) return [];
  const results = new Array<T>(items.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const current = nextIndex++;
        results[current] = await mapper(items[current]);
      }
    }
  );

  await Promise.all(workers);
  return results;
}

export async function enrichStreamsWithProbe(
  streams: ParsedStream[],
  userData: UserData
): Promise<ParsedStream[]> {
  if (!userData.streamProbe?.enabled) return streams;

  const timeoutMs =
    userData.streamProbe.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const probeTargets = streams.filter(shouldProbeStream);
  if (probeTargets.length === 0) return streams;

  const probedById = new Map<string, ParsedStream>();
  const probed = await mapWithConcurrency(
    probeTargets,
    MAX_CONCURRENT_PROBES,
    (stream) => enrichStreamWithProbe(structuredClone(stream), timeoutMs)
  );
  for (const stream of probed) {
    probedById.set(stream.id, stream);
  }

  return streams.map((stream) => probedById.get(stream.id) ?? stream);
}
