import { gunzipSync } from 'node:zlib';
import {
  createLogger,
  makeRequest,
  makeUrlLogSafe,
} from '../../utils/index.js';
import { parseM3u, type M3uEntry } from '../m3u-reader/parser.js';
import { parseXmltvData, type XmltvData } from '../xmltv-reader/parser.js';
import {
  MAX_LIVE_TV_SOURCE_BYTES,
  trimSourceCache,
} from '../live-tv/shared.js';
import type { PlutoTvConfig } from './config.js';
import { assertPlutoTvEnabled } from './policy.js';
import {
  plutoTvM3uUrl,
  plutoTvRegionLabel,
  plutoTvXmltvUrl,
  type PlutoTvRegionCode,
} from './regions.js';

const logger = createLogger('plutotv');

export const M3U_CACHE_TTL_MS = 300_000;
export const XMLTV_CACHE_TTL_MS = 600_000;
/** Minimum gap between forced refreshes after a stream miss. */
export const FORCE_REFRESH_COOLDOWN_MS = 60_000;

type CacheEntry<T> = {
  data: T;
  expiresAt: number;
  sourceBytes: number;
};

const m3uSources = new Map<string, CacheEntry<CachedM3u>>();
const xmltvSources = new Map<string, CacheEntry<CachedXmltv>>();
const inflightM3u = new Map<string, Promise<CachedM3u>>();
const inflightXmltv = new Map<string, Promise<CachedXmltv>>();
const lastForceRefresh = new Map<string, number>();

export type PlutoChannel = {
  /** Original tvg-id / Pluto channel id from the M3U. */
  originalId: string;
  region: PlutoTvRegionCode;
  name: string;
  logo?: string;
  group?: string;
  url: string;
  hasEpg: boolean;
};

export type CachedM3u = {
  region: PlutoTvRegionCode;
  channels: PlutoChannel[];
  byOriginalId: Map<string, PlutoChannel>;
  etag?: string;
  fetchedAt: number;
  sourceUrl: string;
};

export type CachedXmltv = {
  region: PlutoTvRegionCode;
  data: XmltvData;
  etag?: string;
  fetchedAt: number;
  sourceUrl: string;
  coverageStart?: string;
  coverageEnd?: string;
};

export function clearPlutoTvSourceCache() {
  m3uSources.clear();
  xmltvSources.clear();
  inflightM3u.clear();
  inflightXmltv.clear();
  lastForceRefresh.clear();
}

export function channelIdentity(region: string, originalId: string): string {
  return `pluto:${region.toLowerCase()}:${originalId}`;
}

export function parseChannelIdentity(
  raw: string
): { region: string; originalId: string } | undefined {
  const match = /^pluto:([a-z0-9_-]+):(.+)$/i.exec(raw.trim());
  if (!match) return undefined;
  return { region: match[1]!.toLowerCase(), originalId: match[2]! };
}

export function assertAllowedSourceUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid Pluto TV source URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Pluto TV source URLs must use HTTPS');
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;
  const allowed =
    (host === 'raw.githubusercontent.com' &&
      (path.startsWith('/OwnerPlugins/pluto-tv-m3u/') ||
        path.startsWith('/matthuisman/i.mjh.nz/'))) ||
    (host === 'i.mjh.nz' && path.startsWith('/PlutoTV/'));
  if (!allowed) {
    throw new Error(`Unexpected Pluto TV source host/path: ${host}${path}`);
  }
  return parsed;
}

export function assertPlutoStreamUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid Pluto TV stream URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Pluto TV stream URLs must use HTTPS');
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== 'pluto.tv' && !host.endsWith('.pluto.tv')) {
    throw new Error(`Unexpected Pluto TV stream host: ${host}`);
  }
  return parsed;
}

function decodeSourceBytes(buf: Buffer): string {
  const gzipMagic = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  if (gzipMagic) {
    return gunzipSync(buf, {
      maxOutputLength: MAX_LIVE_TV_SOURCE_BYTES,
    }).toString('utf8');
  }
  return buf.toString('utf8');
}

async function fetchSourceBytes(
  url: string,
  timeout: number,
  etag?: string
): Promise<
  | { notModified: true }
  | { notModified: false; buf: Buffer; etag?: string; status: number }
> {
  assertAllowedSourceUrl(url);
  const headers: Record<string, string> = {
    Accept: '*/*',
    'User-Agent': 'AIOLiveTV',
  };
  if (etag) headers['If-None-Match'] = etag;

  const response = await makeRequest(url, { timeout, headers });
  if (response.status === 304 && etag) {
    return { notModified: true };
  }
  if (!response.ok) {
    throw new Error(`Pluto TV source HTTP ${response.status}`);
  }
  const contentLength = Number(response.headers.get('content-length'));
  if (contentLength > MAX_LIVE_TV_SOURCE_BYTES) {
    await response.body?.cancel();
    throw new Error('Pluto TV source exceeds maximum size');
  }
  let buf: Buffer;
  if (response.body) {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > MAX_LIVE_TV_SOURCE_BYTES)
        throw new Error('Pluto TV source exceeds maximum size');
      chunks.push(Buffer.from(chunk));
    }
    buf = Buffer.concat(chunks);
  } else {
    buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > MAX_LIVE_TV_SOURCE_BYTES)
      throw new Error('Pluto TV source exceeds maximum size');
  }
  return {
    notModified: false,
    buf,
    etag: response.headers.get('etag') || undefined,
    status: response.status,
  };
}

function coverageFromXmltv(data: XmltvData): {
  coverageStart?: string;
  coverageEnd?: string;
} {
  let min: string | undefined;
  let max: string | undefined;
  for (const program of data.programs) {
    if (!min || program.startTime < min) min = program.startTime;
    if (!max || program.endTime > max) max = program.endTime;
  }
  return { coverageStart: min, coverageEnd: max };
}

function buildM3uCache(
  region: PlutoTvRegionCode,
  entries: M3uEntry[],
  epgIds: Set<string>,
  meta: { etag?: string; sourceUrl: string; fetchedAt: number }
): CachedM3u {
  const channels: PlutoChannel[] = [];
  const byOriginalId = new Map<string, PlutoChannel>();

  for (const entry of entries) {
    const originalId = entry.channelId.trim();
    if (!originalId || !entry.name?.trim() || !entry.url?.trim()) continue;
    try {
      assertPlutoStreamUrl(entry.url);
    } catch {
      logger.debug(
        { url: makeUrlLogSafe(entry.url) },
        'skipping playlist entry with non-Pluto stream host'
      );
      continue;
    }
    const key = originalId.toLowerCase();
    if (byOriginalId.has(key)) continue;
    const channel: PlutoChannel = {
      originalId,
      region,
      name: entry.name.trim(),
      logo: entry.logo,
      group: entry.group,
      url: entry.url,
      hasEpg: epgIds.has(key),
    };
    channels.push(channel);
    byOriginalId.set(key, channel);
  }

  channels.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );

  return {
    region,
    channels,
    byOriginalId,
    etag: meta.etag,
    fetchedAt: meta.fetchedAt,
    sourceUrl: meta.sourceUrl,
  };
}

function getFresh<T>(
  map: Map<string, CacheEntry<T>>,
  key: string
): T | undefined {
  const entry = map.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) return undefined;
  return entry.data;
}

function getStale<T>(
  map: Map<string, CacheEntry<T>>,
  key: string
): T | undefined {
  return map.get(key)?.data;
}

function setCache<T>(
  map: Map<string, CacheEntry<T>>,
  key: string,
  data: T,
  ttlMs: number,
  sourceBytes: number
) {
  map.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
    sourceBytes,
  });
  trimSourceCache(map);
}

async function loadXmltvCached(
  config: PlutoTvConfig,
  options?: { force?: boolean }
): Promise<CachedXmltv> {
  assertPlutoTvEnabled();
  const region = config.region;
  const sourceUrl = plutoTvXmltvUrl(region);
  const cacheKey = region;

  if (!options?.force) {
    const fresh = getFresh(xmltvSources, cacheKey);
    if (fresh) return fresh;
  }

  const pending = inflightXmltv.get(cacheKey);
  if (pending) return pending;

  const load = (async () => {
    const previous = getStale(xmltvSources, cacheKey);
    try {
      const result = await fetchSourceBytes(
        sourceUrl,
        config.timeout,
        previous?.etag
      );
      if (result.notModified && previous) {
        setCache(
          xmltvSources,
          cacheKey,
          previous,
          XMLTV_CACHE_TTL_MS,
          xmltvSources.get(cacheKey)?.sourceBytes ?? MAX_LIVE_TV_SOURCE_BYTES
        );
        return previous;
      }
      if (result.notModified) {
        throw new Error('Pluto TV XMLTV not modified but no cache');
      }
      const text = decodeSourceBytes(result.buf);
      const data = await parseXmltvData(text);
      const coverage = coverageFromXmltv(data);
      const cached: CachedXmltv = {
        region,
        data,
        etag: result.etag,
        fetchedAt: Date.now(),
        sourceUrl,
        ...coverage,
      };
      setCache(
        xmltvSources,
        cacheKey,
        cached,
        XMLTV_CACHE_TTL_MS,
        Buffer.byteLength(text, 'utf8')
      );
      return cached;
    } catch (error) {
      if (previous) {
        logger.warn(
          {
            region,
            err: error instanceof Error ? error.message : String(error),
          },
          'pluto xmltv refresh failed; keeping last good guide'
        );
        return previous;
      }
      throw error;
    }
  })();

  inflightXmltv.set(cacheKey, load);
  try {
    return await load;
  } finally {
    inflightXmltv.delete(cacheKey);
  }
}

async function loadM3uCached(
  config: PlutoTvConfig,
  options?: { force?: boolean; epgIds?: Set<string> }
): Promise<CachedM3u> {
  assertPlutoTvEnabled();
  const region = config.region;
  const sourceUrl = plutoTvM3uUrl(region);
  const cacheKey = region;

  if (!options?.force) {
    const fresh = getFresh(m3uSources, cacheKey);
    if (fresh) return fresh;
  }

  const pending = inflightM3u.get(cacheKey);
  if (pending) return pending;

  const load = (async () => {
    const previous = getStale(m3uSources, cacheKey);
    let epgIds = options?.epgIds;
    if (!epgIds) {
      try {
        const guide = await loadXmltvCached(config);
        epgIds = new Set(
          guide.data.channels.map((channel) => channel.id.trim().toLowerCase())
        );
      } catch {
        epgIds = new Set(
          [...(previous?.byOriginalId.keys() ?? [])].filter(
            (id) => previous?.byOriginalId.get(id)?.hasEpg
          )
        );
      }
    }

    try {
      const result = await fetchSourceBytes(
        sourceUrl,
        config.timeout,
        previous?.etag
      );
      if (result.notModified && previous) {
        const refreshed = buildM3uCache(
          region,
          [...previous.byOriginalId.values()].map((channel) => ({
            channelId: channel.originalId,
            name: channel.name,
            url: channel.url,
            logo: channel.logo,
            group: channel.group,
          })),
          epgIds,
          {
            etag: previous.etag,
            sourceUrl: previous.sourceUrl,
            fetchedAt: previous.fetchedAt,
          }
        );
        setCache(
          m3uSources,
          cacheKey,
          refreshed,
          M3U_CACHE_TTL_MS,
          m3uSources.get(cacheKey)?.sourceBytes ?? MAX_LIVE_TV_SOURCE_BYTES
        );
        return refreshed;
      }
      if (result.notModified) {
        throw new Error('Pluto TV M3U not modified but no cache');
      }
      const text = decodeSourceBytes(result.buf);
      const entries = parseM3u(text);
      const cached = buildM3uCache(region, entries, epgIds, {
        etag: result.etag,
        sourceUrl,
        fetchedAt: Date.now(),
      });
      setCache(
        m3uSources,
        cacheKey,
        cached,
        M3U_CACHE_TTL_MS,
        Buffer.byteLength(text, 'utf8')
      );
      return cached;
    } catch (error) {
      if (previous) {
        logger.warn(
          {
            region,
            err: error instanceof Error ? error.message : String(error),
          },
          'pluto m3u refresh failed; keeping last good playlist'
        );
        return previous;
      }
      throw error;
    }
  })();

  inflightM3u.set(cacheKey, load);
  try {
    return await load;
  } finally {
    inflightM3u.delete(cacheKey);
  }
}

export async function loadPlutoCatalog(
  config: PlutoTvConfig,
  options?: { force?: boolean }
): Promise<{ m3u: CachedM3u; xmltv: CachedXmltv }> {
  assertPlutoTvEnabled();
  const xmltv = await loadXmltvCached(config, options).catch(
    (error): CachedXmltv => {
      logger.warn(
        {
          region: config.region,
          err: error instanceof Error ? error.message : String(error),
        },
        'pluto guide unavailable; using playlist without EPG'
      );
      return {
        region: config.region,
        data: { channels: [], programs: [], programsByChannelId: new Map() },
        fetchedAt: 0,
        sourceUrl: plutoTvXmltvUrl(config.region),
      };
    }
  );
  const epgIds = new Set(
    [...xmltv.data.programsByChannelId]
      .filter(([, programs]) => programs.length > 0)
      .map(([id]) => id)
  );
  const m3u = await loadM3uCached(config, { ...options, epgIds });
  for (const channel of m3u.channels)
    channel.hasEpg = epgIds.has(channel.originalId.toLowerCase());
  return { m3u, xmltv };
}

export async function forceRefreshPlutoM3u(
  config: PlutoTvConfig
): Promise<CachedM3u> {
  const key = config.region;
  const last = lastForceRefresh.get(key) ?? 0;
  if (Date.now() - last < FORCE_REFRESH_COOLDOWN_MS) {
    const cached = getStale(m3uSources, key);
    if (cached) return cached;
  }
  lastForceRefresh.set(key, Date.now());
  return loadM3uCached(config, { force: true });
}

export async function resolvePlutoStreamUrl(
  config: PlutoTvConfig,
  originalId: string,
  options?: { allowRefresh?: boolean }
): Promise<{ url: string; refreshed: boolean }> {
  assertPlutoTvEnabled();
  let m3u = await loadM3uCached(config);
  let channel = m3u.byOriginalId.get(originalId.toLowerCase());
  let refreshed = false;

  if (!channel?.url && options?.allowRefresh !== false) {
    m3u = await forceRefreshPlutoM3u(config);
    channel = m3u.byOriginalId.get(originalId.toLowerCase());
    refreshed = true;
  }
  if (!channel?.url) {
    throw Object.assign(
      new Error('Canal Pluto TV não encontrado na playlist'),
      {
        code: 'not_found' as const,
      }
    );
  }
  assertPlutoStreamUrl(channel.url);
  return { url: channel.url, refreshed };
}

function jwtStillFresh(url: string, skewSeconds = 300): boolean {
  try {
    const jwt = new URL(url).searchParams.get('jwt');
    if (!jwt) return false;
    const payload = jwt.split('.')[1];
    if (!payload) return false;
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const json = JSON.parse(Buffer.from(padded, 'base64url').toString('utf8'));
    return (
      typeof json.exp === 'number' &&
      json.exp * 1000 > Date.now() + skewSeconds * 1000
    );
  } catch {
    return false;
  }
}

/**
 * Return the latest playlist URL. If the embedded JWT looks expired, refresh
 * the M3U once and retry — without looping. Does not mint JWTs itself.
 */
export async function resolvePlutoStreamUrlWithRetry(
  config: PlutoTvConfig,
  originalId: string
): Promise<{ url: string; refreshed: boolean }> {
  const first = await resolvePlutoStreamUrl(config, originalId, {
    allowRefresh: true,
  });
  if (jwtStillFresh(first.url)) {
    return first;
  }

  const refreshed = await forceRefreshPlutoM3u(config);
  const channel = refreshed.byOriginalId.get(originalId.toLowerCase());
  if (!channel?.url) {
    throw Object.assign(
      new Error('Canal Pluto TV não encontrado após atualizar a playlist'),
      { code: 'not_found' as const }
    );
  }
  assertPlutoStreamUrl(channel.url);
  return { url: channel.url, refreshed: true };
}

export type PlutoImportTestResult = {
  code: 'ok' | 'disabled' | 'error' | 'partial';
  message: string;
  region?: string;
  channelCount?: number;
  channelsWithEpg?: number;
  epgMatchPercent?: number;
  m3uUpdatedAt?: string;
  xmltvUpdatedAt?: string;
  coverageStart?: string;
  coverageEnd?: string;
};

export async function testPlutoTvImport(
  config: PlutoTvConfig
): Promise<PlutoImportTestResult> {
  try {
    assertPlutoTvEnabled();
    const { m3u, xmltv } = await loadPlutoCatalog(config, { force: true });
    const withEpg = m3u.channels.filter((channel) => channel.hasEpg).length;
    const percent = m3u.channels.length
      ? Math.round((withEpg / m3u.channels.length) * 100)
      : 0;
    const label = plutoTvRegionLabel(config.region);
    const base = {
      region: config.region,
      channelCount: m3u.channels.length,
      channelsWithEpg: withEpg,
      epgMatchPercent: percent,
      m3uUpdatedAt: new Date(m3u.fetchedAt).toISOString(),
      xmltvUpdatedAt: new Date(xmltv.fetchedAt).toISOString(),
      coverageStart: xmltv.coverageStart,
      coverageEnd: xmltv.coverageEnd,
    };
    if (!m3u.channels.length) {
      return {
        code: 'error',
        message: `Nenhum canal ao vivo em ${label}.`,
        ...base,
      };
    }
    if (withEpg === 0) {
      return {
        code: 'partial',
        message: `Importou ${m3u.channels.length} canal(is) de ${label}, mas nenhum tvg-id bateu com o XMLTV.`,
        ...base,
      };
    }
    return {
      code: 'ok',
      message: `Importação OK · ${label} · ${m3u.channels.length} canais · ${withEpg} (${percent}%) com EPG. Fontes comunitárias (não oficiais).`,
      ...base,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'PlutoTvPolicyError') {
      return { code: 'disabled', message: error.message };
    }
    return {
      code: 'error',
      message:
        error instanceof Error ? error.message : 'Falha ao importar Pluto TV',
    };
  }
}

/** Alias kept for the API route name used by the SPA. */
export const testPlutoTvConnection = testPlutoTvImport;
