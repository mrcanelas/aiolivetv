if (!process.env.BASE_URL || process.env.BASE_URL === '/') {
  process.env.BASE_URL = 'http://127.0.0.1:3000';
}
if (!process.env.SECRET_KEY || process.env.SECRET_KEY.length < 64) {
  process.env.SECRET_KEY = '0'.repeat(64);
}

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
  enabled: true,
  disabledReason: 'Disabled by this instance administrator',
};

vi.mock('../../config/index.js', () => ({
  config: {
    builtins: {
      plutotv: {
        get enabled() {
          return state.enabled;
        },
        get disabledReason() {
          return state.disabledReason;
        },
      },
    },
    bootstrap: {
      baseUrl: 'https://example.test',
      allowPrivateUrls: false,
    },
  },
}));

vi.mock('../../utils/index.js', () => ({
  Cache: {
    getInstance: () => ({
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
    }),
  },
  makeRequest: vi.fn(),
  makeUrlLogSafe: (url: string) => url,
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  }),
  toUrlSafeBase64: (value: string) => Buffer.from(value).toString('base64url'),
  fromUrlSafeBase64: (value: string) =>
    Buffer.from(value, 'base64url').toString(),
  decodeHtmlEntities: (value: string) => value,
}));

const loadCatalog = vi.fn();
const resolveStream = vi.fn();

vi.mock('./client.js', async () => {
  const actual =
    await vi.importActual<typeof import('./client.js')>('./client.js');
  return {
    ...actual,
    loadPlutoCatalog: (...args: unknown[]) => loadCatalog(...args),
    resolvePlutoStreamUrlWithRetry: (...args: unknown[]) =>
      resolveStream(...args),
  };
});

vi.mock('../../streams/web-readiness.js', () => ({
  resolveNotWebReady: vi.fn(async () => false),
}));

const { encodeChannelId } = await import('../live-tv/shared.js');
const { PlutoTvAddon } = await import('./addon.js');
const { channelIdentity } = await import('./client.js');

describe('PlutoTvAddon (regional M3U + XMLTV)', () => {
  beforeEach(() => {
    state.enabled = true;
    loadCatalog.mockReset();
    resolveStream.mockReset();

    const channel = {
      originalId: '5f120e94a5714d00074576a1',
      region: 'br' as const,
      name: 'Pluto TV Cine Sucessos',
      logo: 'https://images.pluto.tv/x.png',
      group: 'Movies',
      url: 'https://cfd-v4-service-channel-stitcher-use1-1.prd.pluto.tv/v2/x?jwt=fresh',
      hasEpg: true,
    };
    loadCatalog.mockResolvedValue({
      m3u: {
        region: 'br',
        channels: [channel],
        byOriginalId: new Map([[channel.originalId, channel]]),
        fetchedAt: Date.now(),
        sourceUrl: 'https://example/m3u',
      },
      xmltv: {
        region: 'br',
        data: {
          channels: [{ id: channel.originalId, name: channel.name }],
          programs: [],
          programsByChannelId: new Map(),
        },
        fetchedAt: Date.now(),
        sourceUrl: 'https://example/xml',
      },
    });
    resolveStream.mockResolvedValue({
      url: channel.url,
      refreshed: false,
    });
  });

  it('encodes stable channel ids with region namespace', async () => {
    const addon = new PlutoTvAddon({ region: 'br', timeout: 5000 });
    const catalog = await addon.getCatalog();
    expect(catalog[0]!.id).toBe(
      encodeChannelId(channelIdentity('br', '5f120e94a5714d00074576a1'))
    );
    expect(catalog[0]!.tvgId).toBe('5f120e94a5714d00074576a1');
  });

  it('resolves streams from the latest playlist URL', async () => {
    const addon = new PlutoTvAddon({ region: 'br', timeout: 5000 });
    const id = encodeChannelId(
      channelIdentity('br', '5f120e94a5714d00074576a1')
    );
    const streams = await addon.getStreams(id);
    expect(streams[0]!.url).toContain('pluto.tv');
    expect(resolveStream).toHaveBeenCalledOnce();
  });

  it('advertises native EPG only when a listed channel has programmes', async () => {
    const addon = new PlutoTvAddon({ region: 'br', timeout: 5000 });
    expect(
      (await addon.getManifest()).behaviorHints?.epgProvider
    ).toBeUndefined();
    const catalog = await loadCatalog();
    catalog.xmltv.data.programsByChannelId.set('5f120e94a5714d00074576a1', [
      {
        title: 'Show',
        startTime: '2026-10-11T12:00:00Z',
        endTime: '2026-10-11T13:00:00Z',
      },
    ]);
    expect((await addon.getManifest()).behaviorHints?.epgProvider).toBe(true);
    loadCatalog.mockRejectedValueOnce(new Error('Sources unavailable'));
    expect(
      (await addon.getManifest()).behaviorHints?.epgProvider
    ).toBeUndefined();
  });

  it('does not resolve a channel from another regional catalog', async () => {
    const addon = new PlutoTvAddon({ region: 'br', timeout: 5000 });
    const id = encodeChannelId(
      channelIdentity('us', '5f120e94a5714d00074576a1')
    );
    expect(await addon.getStreams(id)).toEqual([]);
    expect(resolveStream).not.toHaveBeenCalled();
  });
});
