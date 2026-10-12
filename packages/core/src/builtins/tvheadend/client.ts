import { createHash } from 'node:crypto';
import { request as undiciRequest, type Dispatcher } from 'undici';
import { config as appConfig } from '../../config/index.js';
import {
  createLogger,
  makeRequest,
  makeUrlLogSafe,
} from '../../utils/index.js';
import {
  assertTvheadendEnabled,
  assertTvheadendProxyAllowed,
  assertTvheadendUrlAllowed,
  TvheadendPolicyError,
} from './policy.js';
import {
  parseTagIds,
  type TvheadendConfig,
  type TvheadendPlaybackMode,
} from './config.js';

const logger = createLogger('tvheadend');

export const CHANNEL_PAGE_SIZE = 200;
export const EPG_PAGE_SIZE = 250;
export const EPG_WINDOW_HOURS = 48;
export const CHANNELS_CACHE_TTL = 300;
export const EPG_CACHE_TTL = 300;
export const TICKET_CACHE_TTL = 240; // tickets last 5 minutes; refresh earlier

export type TvheadendChannel = {
  uuid: string;
  name: string;
  number?: number | string;
  enabled: boolean;
  icon?: string;
  tags: string[];
};

export type TvheadendChannelTag = {
  uuid: string;
  name: string;
  enabled: boolean;
};

export type TvheadendEpgEvent = {
  eventId: number;
  channelUuid: string;
  channelName?: string;
  title: string;
  subtitle?: string;
  summary?: string;
  description?: string;
  start: number; // unix seconds
  stop: number; // unix seconds
};

export type TvheadendTestResultCode =
  | 'ok'
  | 'unreachable'
  | 'unauthorized'
  | 'forbidden'
  | 'blocked'
  | 'disabled'
  | 'no_channels'
  | 'invalid_url'
  | 'error';

export type TvheadendTestResult = {
  code: TvheadendTestResultCode;
  message: string;
  channelCount?: number;
  serverReachable?: boolean;
};

type GridResponse<T> = {
  entries?: T[];
  total?: number;
  totalCount?: number;
};

function trimBase(url: string): string {
  return url.replace(/\/+$/, '');
}

export function normalizeTvheadendUrl(url: string): string {
  const parsed = new URL(url.includes('://') ? url : `http://${url}`);
  parsed.hash = '';
  parsed.search = '';
  // Drop accidental API suffixes so users can paste either form.
  parsed.pathname = parsed.pathname
    .replace(/\/api\/?$/i, '')
    .replace(/\/+$/, '');
  return trimBase(parsed.toString());
}

export function connectionIdForUrl(apiUrl: string): string {
  return createHash('sha256')
    .update(normalizeTvheadendUrl(apiUrl))
    .digest('hex')
    .slice(0, 16);
}

export function canonicalChannelId(
  apiUrl: string,
  channelUuid: string
): string {
  return `tvh:${connectionIdForUrl(apiUrl)}:${channelUuid}`;
}

export function parseCanonicalChannelId(value: string): {
  connectionId: string;
  channelUuid: string;
} {
  const match = /^tvh:([a-f0-9]{16}):(.+)$/i.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid TVHeadend channel id: ${value}`);
  }
  return { connectionId: match[1], channelUuid: match[2] };
}

export function apiBaseUrl(config: TvheadendConfig): string {
  return normalizeTvheadendUrl(config.url);
}

export function playbackBaseUrl(config: TvheadendConfig): string {
  const playback = config.playbackUrl?.trim();
  if (playback) return normalizeTvheadendUrl(playback);
  return apiBaseUrl(config);
}

export function basicAuthHeader(
  username?: string,
  password?: string
): string | undefined {
  if (!username && !password) return undefined;
  const token = Buffer.from(
    `${username ?? ''}:${password ?? ''}`,
    'utf8'
  ).toString('base64');
  return `Basic ${token}`;
}

function authHeaders(config: TvheadendConfig): Record<string, string> {
  const auth = basicAuthHeader(config.username, config.password);
  return auth ? { Authorization: auth } : {};
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function rewriteOrigin(url: string, newBase: string): string {
  const parsed = new URL(url);
  const base = new URL(newBase);
  parsed.protocol = base.protocol;
  parsed.host = base.host;
  return parsed.toString();
}

export function resolveTvheadendAssetUrl(
  base: string,
  asset?: string
): string | undefined {
  if (!asset?.trim()) return undefined;
  const value = asset.trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('//')) {
    const baseUrl = new URL(base);
    return `${baseUrl.protocol}${value}`;
  }
  return new URL(value.replace(/^\//, ''), `${trimBase(base)}/`).toString();
}

export function unixSecondsToIso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

export function isPrivateHostnameOrIp(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local')
  ) {
    return true;
  }
  // Cheap literal check; DNS-based checks stay in assertTvheadendUrlAllowed.
  if (
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(
      host
    )
  ) {
    return true;
  }
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  if (
    host === '::1' ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('fe80:')
  ) {
    return true;
  }
  return false;
}

async function tvhFetch(
  config: TvheadendConfig,
  path: string,
  init?: { method?: string; body?: URLSearchParams; timeout?: number }
): Promise<Response> {
  assertTvheadendEnabled();
  const base = apiBaseUrl(config);
  await assertTvheadendUrlAllowed(base);
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    ...authHeaders(config),
  };
  if (init?.body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }

  try {
    return await makeRequest(url, {
      method: init?.method ?? (init?.body ? 'POST' : 'GET'),
      headers,
      body: init?.body?.toString(),
      timeout: init?.timeout ?? config.timeout,
    });
  } catch (err) {
    if (err instanceof TvheadendPolicyError) throw err;
    logger.warn(
      {
        url: makeUrlLogSafe(url),
        err: err instanceof Error ? err.message : String(err),
      },
      'tvheadend request failed'
    );
    throw err;
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `TVHeadend returned non-JSON response (HTTP ${response.status})`
    );
  }
}

function mapHttpError(status: number): never {
  if (status === 401) {
    throw Object.assign(new Error('Invalid credentials'), {
      code: 'unauthorized' as const,
      status,
    });
  }
  if (status === 403) {
    throw Object.assign(new Error('Account does not have permission'), {
      code: 'forbidden' as const,
      status,
    });
  }
  throw Object.assign(new Error(`TVHeadend HTTP ${status}`), {
    code: 'error' as const,
    status,
  });
}

export async function fetchChannelTags(
  config: TvheadendConfig
): Promise<TvheadendChannelTag[]> {
  const response = await tvhFetch(config, '/api/channeltag/grid', {
    method: 'POST',
    body: new URLSearchParams({ start: '0', limit: '1000' }),
  });
  if (!response.ok) mapHttpError(response.status);
  const data = await readJson<GridResponse<Record<string, unknown>>>(response);
  return (data.entries ?? []).flatMap((entry) => {
    const uuid = asString(entry.uuid);
    const name = asString(entry.name);
    if (!uuid || !name) return [];
    return [
      {
        uuid,
        name,
        enabled: entry.enabled !== false,
      },
    ];
  });
}

function mapChannel(entry: Record<string, unknown>): TvheadendChannel | null {
  const uuid = asString(entry.uuid);
  const name = asString(entry.name);
  if (!uuid || !name) return null;
  if (entry.enabled === false) return null;
  const tags = Array.isArray(entry.tags)
    ? entry.tags
        .map((tag) => asString(tag))
        .filter((tag): tag is string => !!tag)
    : [];
  const icon =
    asString(entry.icon_public_url) || asString(entry.icon) || undefined;
  return {
    uuid,
    name,
    number: (entry.number as number | string | undefined) ?? undefined,
    enabled: true,
    icon,
    tags,
  };
}

export async function fetchAllChannels(
  config: TvheadendConfig,
  options?: { pageSize?: number }
): Promise<TvheadendChannel[]> {
  const pageSize = options?.pageSize ?? CHANNEL_PAGE_SIZE;
  const tagFilter = parseTagIds(config.tagIds);
  const channels: TvheadendChannel[] = [];
  let start = 0;
  let total = Number.POSITIVE_INFINITY;

  while (start < total) {
    const body = new URLSearchParams({
      start: String(start),
      limit: String(pageSize),
      sort: 'number',
      dir: 'ASC',
    });
    const response = await tvhFetch(config, '/api/channel/grid', {
      method: 'POST',
      body,
    });
    if (!response.ok) mapHttpError(response.status);
    const data =
      await readJson<GridResponse<Record<string, unknown>>>(response);
    const page = (data.entries ?? [])
      .map((entry) => mapChannel(entry))
      .filter((channel): channel is TvheadendChannel => !!channel);
    total = data.total ?? data.totalCount ?? start + page.length;
    channels.push(...page);
    start += pageSize;
    if (!page.length) break;
  }

  if (!tagFilter.length) return channels;
  return channels.filter((channel) =>
    tagFilter.some((tagId) => channel.tags.includes(tagId))
  );
}

export async function fetchEpgEventsForChannel(
  config: TvheadendConfig,
  channelUuid: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<TvheadendEpgEvent[]> {
  const windowEnd = nowSeconds + EPG_WINDOW_HOURS * 3600;
  const events: TvheadendEpgEvent[] = [];
  let start = 0;
  let total = Number.POSITIVE_INFINITY;

  while (start < total) {
    const body = new URLSearchParams({
      start: String(start),
      limit: String(EPG_PAGE_SIZE),
      channel: channelUuid,
      sort: 'start',
      dir: 'ASC',
    });
    const response = await tvhFetch(config, '/api/epg/events/grid', {
      method: 'POST',
      body,
    });
    if (!response.ok) mapHttpError(response.status);
    const data =
      await readJson<GridResponse<Record<string, unknown>>>(response);
    const page = data.entries ?? [];
    total = data.totalCount ?? data.total ?? start + page.length;

    let reachedPastWindow = false;
    for (const entry of page) {
      const eventStart = asNumber(entry.start);
      const eventStop = asNumber(entry.stop);
      const title = asString(entry.title);
      const channel = asString(entry.channelUuid) || channelUuid;
      const eventId = asNumber(entry.eventId);
      if (
        eventStart === undefined ||
        eventStop === undefined ||
        !title ||
        eventId === undefined
      ) {
        continue;
      }
      if (eventStop <= nowSeconds) continue;
      if (eventStart >= windowEnd) {
        reachedPastWindow = true;
        break;
      }
      events.push({
        eventId,
        channelUuid: channel,
        channelName: asString(entry.channelName),
        title,
        subtitle: asString(entry.subtitle),
        summary: asString(entry.summary),
        description: asString(entry.description) || asString(entry.summary),
        start: eventStart,
        stop: eventStop,
      });
    }

    start += EPG_PAGE_SIZE;
    if (!page.length || reachedPastWindow) break;
  }

  return events;
}

function extractStreamUrlFromPlaylist(playlist: string): string | undefined {
  for (const line of playlist.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
  }
  return undefined;
}

/**
 * Builds a player-facing stream URL.
 * Direct mode uses a short-lived TVHeadend ticket (no permanent password in the URL).
 * Proxy mode returns an encrypted URL on this AIOLiveTV instance.
 */
export async function buildPlaybackUrl(
  config: TvheadendConfig,
  channelUuid: string,
  options?: { mode?: TvheadendPlaybackMode }
): Promise<{
  url: string;
  mode: TvheadendPlaybackMode;
  privatePlaybackWarning?: boolean;
}> {
  const mode = options?.mode ?? config.playbackMode;
  if (mode === 'proxy') {
    assertTvheadendProxyAllowed();
    const { buildTvheadendProxyUrl } = await import('./proxyUrl.js');
    return {
      url: buildTvheadendProxyUrl(config, channelUuid, 'stream'),
      mode: 'proxy',
    };
  }

  const ticketUrl = await fetchTicketStreamUrl(config, channelUuid);
  const playback = playbackBaseUrl(config);
  const rewritten = rewriteOrigin(ticketUrl, playback);
  let privatePlaybackWarning = false;
  try {
    privatePlaybackWarning = isPrivateHostnameOrIp(new URL(rewritten).hostname);
  } catch {
    privatePlaybackWarning = false;
  }
  return { url: rewritten, mode: 'direct', privatePlaybackWarning };
}

export async function fetchTicketStreamUrl(
  config: TvheadendConfig,
  channelUuid: string
): Promise<string> {
  const profile = config.profile?.trim() || 'pass';
  const path = `/playlist/ticket/channel/${encodeURIComponent(channelUuid)}?profile=${encodeURIComponent(profile)}`;
  const response = await tvhFetch(config, path);
  if (!response.ok) mapHttpError(response.status);
  const playlist = await response.text();
  const streamUrl = extractStreamUrlFromPlaylist(playlist);
  if (!streamUrl) {
    throw new Error(
      'Could not obtain a TVHeadend playback ticket. Use proxy mode if allowed by the administrator.'
    );
  }
  // Ensure permanent credentials never leak if TVH echoed them.
  const cleaned = new URL(streamUrl);
  cleaned.username = '';
  cleaned.password = '';
  return cleaned.toString();
}

export async function openUpstreamStream(
  config: TvheadendConfig,
  channelUuid: string,
  clientSignal?: AbortSignal
): Promise<{
  response: Dispatcher.ResponseData;
  upstreamUrl: string;
  abort: AbortController;
}> {
  assertTvheadendEnabled();
  assertTvheadendProxyAllowed();
  const base = apiBaseUrl(config);
  await assertTvheadendUrlAllowed(base);

  const profile = config.profile?.trim() || 'pass';
  // Authenticated upstream; credentials stay in headers, never in the client URL.
  const upstreamUrl = `${base}/stream/channel/${encodeURIComponent(channelUuid)}?profile=${encodeURIComponent(profile)}`;
  const abort = new AbortController();
  if (clientSignal) {
    if (clientSignal.aborted) abort.abort();
    else {
      clientSignal.addEventListener('abort', () => abort.abort(), {
        once: true,
      });
    }
  }

  const headers: Record<string, string> = {
    ...authHeaders(config),
    'User-Agent': appConfig.http.defaultUserAgent,
  };

  logger.debug(
    { url: makeUrlLogSafe(upstreamUrl) },
    'opening tvheadend upstream stream'
  );

  const response = await undiciRequest(upstreamUrl, {
    method: 'GET',
    headers,
    signal: abort.signal,
    // undici does not follow redirects by default (maxRedirections = 0).
    bodyTimeout: 0,
    headersTimeout: config.timeout,
  });

  return { response, upstreamUrl, abort };
}

export async function testTvheadendConnection(
  input: Pick<TvheadendConfig, 'url' | 'username' | 'password' | 'timeout'>
): Promise<TvheadendTestResult> {
  try {
    assertTvheadendEnabled();
  } catch (err) {
    if (err instanceof TvheadendPolicyError && err.code === 'disabled') {
      return { code: 'disabled', message: err.message };
    }
    throw err;
  }

  let config: TvheadendConfig;
  try {
    config = {
      url: normalizeTvheadendUrl(input.url),
      username: input.username ?? '',
      password: input.password ?? '',
      playbackUrl: '',
      playbackMode: 'direct',
      profile: 'pass',
      tagIds: '',
      timeout: input.timeout,
      timeShiftMinutes: 0,
    };
  } catch {
    return { code: 'invalid_url', message: 'Invalid URL' };
  }

  try {
    await assertTvheadendUrlAllowed(config.url);
  } catch (err) {
    if (err instanceof TvheadendPolicyError) {
      return {
        code: err.code === 'private_blocked' ? 'blocked' : 'invalid_url',
        message: err.message,
      };
    }
    throw err;
  }

  try {
    // Lightweight probe: channel list page size 1 does not start a tuner.
    const response = await tvhFetch(config, '/api/channel/grid', {
      method: 'POST',
      body: new URLSearchParams({ start: '0', limit: '1' }),
    });
    if (response.status === 401) {
      return {
        code: 'unauthorized',
        message: 'Invalid credentials',
        serverReachable: true,
      };
    }
    if (response.status === 403) {
      return {
        code: 'forbidden',
        message: 'Account does not have permission to list channels',
        serverReachable: true,
      };
    }
    if (!response.ok) {
      return {
        code: 'error',
        message: `Server returned HTTP ${response.status}`,
        serverReachable: true,
      };
    }
    const data =
      await readJson<GridResponse<Record<string, unknown>>>(response);
    const total = data.total ?? data.totalCount ?? data.entries?.length ?? 0;
    if (!total) {
      return {
        code: 'no_channels',
        message: 'Connection successful, but no channels are available',
        channelCount: 0,
        serverReachable: true,
      };
    }
    return {
      code: 'ok',
      message: `Connection successful (${total} channel${total === 1 ? '' : 's'})`,
      channelCount: total,
      serverReachable: true,
    };
  } catch (err) {
    if (err instanceof TvheadendPolicyError) {
      return {
        code: err.code === 'private_blocked' ? 'blocked' : 'error',
        message: err.message,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    const timedOut =
      message.includes('Timeout') ||
      message.includes('timeout') ||
      message.includes('AbortError');
    return {
      code: 'unreachable',
      message: timedOut
        ? 'Server unreachable or request timed out'
        : `Server unreachable: ${message}`,
      serverReachable: false,
    };
  }
}

export function classifyStreamFailure(
  status: number,
  bodyHint?: string
): string {
  const hint = (bodyHint || '').toLowerCase();
  if (
    status === 503 ||
    hint.includes('no free adapter') ||
    (hint.includes('subscription') && hint.includes('denied')) ||
    hint.includes('no free tuner') ||
    hint.includes('tuner busy')
  ) {
    return 'No tuner available on TVHeadend';
  }
  if (status === 404) {
    return 'Channel unavailable at the source';
  }
  if (status === 401 || status === 403) {
    return 'No permission to play this channel';
  }
  return `Source unavailable (HTTP ${status})`;
}
