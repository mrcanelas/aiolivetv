import type { Stream } from '../db/index.js';
import type { ParsedStream } from '../db/schemas.js';
import { makeRequest } from '../utils/index.js';
import { runFfprobe } from './ffprobe-runner.js';
import { parseFfprobeJson } from './probed.js';

export interface StreamProxyHints {
  requestHeaders?: Record<string, string> | null;
  responseHeaders?: Record<string, string> | null;
  behaviorHints?: Stream['behaviorHints'];
  notWebReady?: boolean | null;
  url?: string | null;
}

export function hasStreamProxyHeaders(stream: StreamProxyHints): boolean {
  return !!(
    stream.requestHeaders ||
    stream.responseHeaders ||
    stream.behaviorHints?.proxyHeaders?.request ||
    stream.behaviorHints?.proxyHeaders?.response
  );
}

export function looksWebPlayableByUrl(url: string): boolean | undefined {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith('.m3u8')) return true;
    if (pathname.endsWith('.mp4') || pathname.endsWith('.webm')) return true;
    if (pathname.endsWith('.ts')) return false;
  } catch {
    return undefined;
  }
  return undefined;
}

export async function probeWebPlayable(
  url: string,
  timeoutMs: number
): Promise<boolean> {
  const byUrl = looksWebPlayableByUrl(url);
  if (byUrl === true) return true;
  if (byUrl === false) return false;

  try {
    const response = await makeRequest(url, {
      method: 'HEAD',
      timeout: Math.min(timeoutMs, 5000),
    });
    const contentType =
      response.headers.get('content-type')?.toLowerCase() ?? '';
    if (
      contentType.includes('mpegurl') ||
      contentType.includes('m3u8') ||
      contentType.includes('application/vnd.apple.mpegurl')
    ) {
      return true;
    }
    if (
      contentType.includes('video/mp4') ||
      contentType.includes('video/webm')
    ) {
      return true;
    }
    if (contentType.includes('mp2t') || contentType.includes('mpegts')) {
      return false;
    }
  } catch {
    // fall through to ffprobe
  }

  try {
    const raw = await runFfprobe(url, {
      timeoutMs: Math.min(timeoutMs, 8000),
    });
    const probed = parseFfprobeJson(url, raw);
    const format = probed.format?.toLowerCase();
    if (format === 'hls') return true;
    if (format === 'mpegts') return false;
    if (format === 'mp4' || format === 'mov') return true;
    return false;
  } catch {
    return false;
  }
}

export async function resolveNotWebReady(
  stream: StreamProxyHints,
  options?: { probe?: boolean; timeoutMs?: number }
): Promise<boolean | undefined> {
  if (stream.notWebReady != null) {
    return stream.notWebReady ? true : undefined;
  }
  if (!stream.url || !options?.probe) return undefined;
  const playable = await probeWebPlayable(
    stream.url,
    options.timeoutMs ?? 8000
  );
  return playable ? undefined : true;
}

function usesProviderWebHints(stream: ParsedStream) {
  return Boolean(stream.addon.resultPassthrough);
}

export async function applyLiveStreamWebHints(
  streams: ParsedStream[],
  options?: { probe?: boolean; timeoutMs?: number }
): Promise<ParsedStream[]> {
  return Promise.all(
    streams.map(async (stream) => {
      if (usesProviderWebHints(stream)) {
        return stream.notWebReady ? { ...stream, notWebReady: true } : stream;
      }
      const notWebReady = await resolveNotWebReady(stream, options);
      if (!notWebReady) return stream;
      return { ...stream, notWebReady: true };
    })
  );
}
