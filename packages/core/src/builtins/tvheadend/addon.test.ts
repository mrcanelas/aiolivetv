process.env.BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
process.env.SECRET_KEY = process.env.SECRET_KEY || '0'.repeat(64);

import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockMakeRequest = vi.fn();

vi.mock('../../utils/index.js', () => ({
  Cache: {
    getInstance: () => ({
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
    }),
  },
  makeRequest: (...args: unknown[]) => mockMakeRequest(...args),
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
  encryptString: (data: string) => ({
    success: true,
    data: Buffer.from(data).toString('base64url'),
    error: null,
  }),
  decryptString: (data: string) => ({
    success: true,
    data: Buffer.from(data, 'base64url').toString(),
    error: null,
  }),
}));

vi.mock('../../utils/ssrf.js', () => {
  class SsrfError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'SsrfError';
    }
  }
  return {
    SsrfError,
    assertSafeOutboundUrl: vi.fn(async (input: string | URL) => {
      const url = input instanceof URL ? input : new URL(input);
      if (
        url.hostname.startsWith('192.168.') ||
        url.hostname === '127.0.0.1' ||
        url.hostname === 'localhost'
      ) {
        throw new SsrfError(`Blocked IP address: ${url.hostname}`);
      }
      return url;
    }),
    MAX_SSRF_REDIRECTS: 5,
    isRedirectStatus: () => false,
    isBlockedIpAddress: () => false,
  };
});

vi.mock('../../utils/crypto.js', () => ({
  encryptString: (data: string) => ({
    success: true,
    data: Buffer.from(data).toString('base64url'),
    error: null,
  }),
  decryptString: (data: string) => ({
    success: true,
    data: Buffer.from(data, 'base64url').toString(),
    error: null,
  }),
}));
vi.mock('../../streams/web-readiness.js', () => ({
  resolveNotWebReady: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../config/index.js', () => {
  const config = {
    bootstrap: {
      allowPrivateUrls: false,
      baseUrl: 'https://aio.example.com',
      internalUrl: 'http://127.0.0.1:3000',
      secretKey: '0'.repeat(64),
    },
    builtins: {
      tvheadend: {
        enabled: true,
        disabledReason: 'Disabled by this instance administrator',
        proxyEnabled: true,
      },
    },
    http: { defaultUserAgent: 'AIOLiveTV/test' },
    presets: { defaultTimeout: 5000 },
    userLimits: {
      disabled: {
        addons: {},
        removedAddons: {},
        hosts: {},
        services: {},
        streamTypes: [],
      },
      timeouts: { minTimeout: 1000, maxTimeout: 60000 },
    },
  };
  return { config };
});

const {
  TvheadendAddon,
  canonicalChannelId,
  connectionIdForUrl,
  fetchAllChannels,
  fetchEpgEventsForChannel,
  normalizeTvheadendUrl,
  testTvheadendConnection,
  unixSecondsToIso,
  assertTvheadendUrlAllowed,
  TvheadendPolicyError,
  buildTvheadendProxyUrl,
  decryptTvheadendProxyPayload,
} = await import('./index.js');
const { encodeChannelId } = await import('../live-tv/shared.js');

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

function textResponse(body: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => {
      throw new Error('not json');
    },
  };
}

describe('TVHeadend client helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalises API URLs and keeps connection identity stable', () => {
    expect(normalizeTvheadendUrl('http://tvh.example:9981/api/')).toBe(
      'http://tvh.example:9981'
    );
    const a = connectionIdForUrl('http://tvh.example:9981/');
    const b = connectionIdForUrl('http://tvh.example:9981/api');
    expect(a).toBe(b);
    expect(canonicalChannelId('http://tvh.example:9981', 'abc')).toBe(
      `tvh:${a}:abc`
    );
    expect(canonicalChannelId('http://other:9981', 'abc')).not.toBe(
      canonicalChannelId('http://tvh.example:9981', 'abc')
    );
  });

  it('converts unix seconds to ISO preserving the instant', () => {
    expect(unixSecondsToIso(1747148400)).toBe('2025-05-13T15:00:00.000Z');
  });

  it('paginates channel grid imports with start/limit', async () => {
    const all = [
      { uuid: 'u1', name: 'One', enabled: true, number: 1, tags: [] },
      { uuid: 'u2', name: 'Two', enabled: true, number: 2, tags: ['t1'] },
      { uuid: 'u3', name: 'Three', enabled: true, number: 3, tags: [] },
    ];
    mockMakeRequest.mockImplementation(async (_url: string, opts: any) => {
      const body = new URLSearchParams(opts.body);
      const start = Number(body.get('start') || 0);
      const limit = Number(body.get('limit') || 200);
      return jsonResponse({
        total: all.length,
        entries: all.slice(start, start + limit),
      });
    });

    const channels = await fetchAllChannels(
      {
        url: 'https://tvh.example:9981',
        username: 'user',
        password: 'secret',
        playbackUrl: '',
        playbackMode: 'direct',
        profile: 'pass',
        tagIds: '',
        timeout: 5000,
        timeShiftMinutes: 0,
      },
      { pageSize: 2 }
    );

    expect(channels.map((c) => c.uuid)).toEqual(['u1', 'u2', 'u3']);
    expect(mockMakeRequest).toHaveBeenCalledTimes(2);
    const firstCall = mockMakeRequest.mock.calls[0];
    expect(String(firstCall[0])).toContain('/api/channel/grid');
    expect(String(firstCall[0])).not.toContain('secret');
    expect(String(firstCall[1]?.headers?.Authorization || '')).toMatch(
      /^Basic /
    );
  });

  it('imports EPG within the future window and converts timestamps', async () => {
    const now = Math.floor(Date.now() / 1000);
    mockMakeRequest.mockResolvedValueOnce(
      jsonResponse({
        totalCount: 2,
        entries: [
          {
            eventId: 1,
            channelUuid: 'ch1',
            title: 'Past',
            start: now - 7200,
            stop: now - 3600,
          },
          {
            eventId: 2,
            channelUuid: 'ch1',
            title: 'Now Show',
            summary: 'Desc',
            start: now - 60,
            stop: now + 3600,
          },
        ],
      })
    );

    const events = await fetchEpgEventsForChannel(
      {
        url: 'https://tvh.example:9981',
        username: '',
        password: '',
        playbackUrl: '',
        playbackMode: 'direct',
        profile: 'pass',
        tagIds: '',
        timeout: 5000,
        timeShiftMinutes: 0,
      },
      'ch1',
      now
    );

    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Now Show');
    expect(unixSecondsToIso(events[0].start)).toMatch(/Z$/);
  });

  it('blocks private URLs when instance policy forbids them', async () => {
    await expect(
      assertTvheadendUrlAllowed('http://192.168.0.10:9981')
    ).rejects.toBeInstanceOf(TvheadendPolicyError);
  });

  it('keeps credentials out of encrypted proxy payloads round-trip surface', () => {
    const config = {
      url: 'https://tvh.example:9981',
      username: 'user',
      password: 'super-secret',
      playbackUrl: '',
      playbackMode: 'proxy' as const,
      profile: 'pass',
      tagIds: '',
      timeout: 5000,
      timeShiftMinutes: 0,
    };
    const url = buildTvheadendProxyUrl(config, 'channel-uuid');
    expect(url).toContain('/api/v1/tvheadend/proxy/');
    expect(url).not.toContain('super-secret');
    const token = url.split('/').pop()!;
    const payload = decryptTvheadendProxyPayload(token);
    expect(payload.channelUuid).toBe('channel-uuid');
    expect(payload.config.password).toBe('super-secret');
  });

  it('distinguishes test connection outcomes', async () => {
    mockMakeRequest.mockResolvedValueOnce(
      jsonResponse({ total: 0, entries: [] })
    );
    await expect(
      testTvheadendConnection({
        url: 'https://tvh.example:9981',
        username: 'u',
        password: 'p',
        timeout: 5000,
      })
    ).resolves.toMatchObject({ code: 'no_channels' });

    mockMakeRequest.mockResolvedValueOnce(jsonResponse({}, 401));
    await expect(
      testTvheadendConnection({
        url: 'https://tvh.example:9981',
        username: 'u',
        password: 'p',
        timeout: 5000,
      })
    ).resolves.toMatchObject({ code: 'unauthorized' });
  });
});

describe('TvheadendAddon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMakeRequest.mockImplementation(async (url: string) => {
      if (url.includes('/api/channel/grid')) {
        return jsonResponse({
          total: 1,
          entries: [
            {
              uuid: 'ae63d3b40fbfab610f49290abc189472',
              name: 'BBC RB 1',
              enabled: true,
              number: 601,
              tags: ['tag-news'],
              icon_public_url: 'imagecache/12',
            },
          ],
        });
      }
      if (url.includes('/api/channeltag/grid')) {
        return jsonResponse({
          total: 1,
          entries: [
            {
              uuid: 'tag-news',
              name: 'News',
              enabled: true,
            },
          ],
        });
      }
      if (url.includes('/api/epg/events/grid')) {
        const now = Math.floor(Date.now() / 1000);
        return jsonResponse({
          totalCount: 1,
          entries: [
            {
              eventId: 99,
              channelUuid: 'ae63d3b40fbfab610f49290abc189472',
              title: 'Morning',
              description: 'News desk',
              start: now - 100,
              stop: now + 3500,
            },
          ],
        });
      }
      if (url.includes('/playlist/ticket/channel/')) {
        return textResponse(
          `#EXTM3U\n#EXTINF:-1,BBC RB 1\nhttps://tvh.example:9981/stream/channel/ae63d3b40fbfab610f49290abc189472?ticket=abc123&profile=pass\n`
        );
      }
      return jsonResponse({ entries: [] });
    });
  });

  it('exposes catalog, meta, stream and epgProvider', async () => {
    const addon = new TvheadendAddon({
      url: 'https://tvh.example:9981',
      username: 'user',
      password: 'pass',
      timeout: 5000,
    });
    const manifest = await addon.getManifest();
    expect(manifest.behaviorHints?.epgProvider).toBe(true);
    expect(
      manifest.resources.map((r) => (typeof r === 'string' ? r : r.name))
    ).toEqual(expect.arrayContaining(['catalog', 'meta', 'stream']));

    const catalog = await addon.getCatalog();
    expect(catalog).toHaveLength(1);
    expect(catalog[0].name).toBe('BBC RB 1');
    expect(catalog[0].id).toBe(
      encodeChannelId(
        canonicalChannelId(
          'https://tvh.example:9981',
          'ae63d3b40fbfab610f49290abc189472'
        )
      )
    );

    const meta = await addon.getMeta(catalog[0].id);
    expect(meta.videos?.length).toBeGreaterThan(0);

    const streams = await addon.getStreams(catalog[0].id);
    expect(streams[0].url).toContain('ticket=abc123');
    expect(streams[0].url).not.toMatch(/\/\/[^/@]+:[^/@]+@/);
    expect(streams[0].url).not.toContain('password=');
  });

  it('does not advertise native EPG when the server has no guide events', async () => {
    mockMakeRequest.mockImplementation(async (url: string) => {
      if (url.includes('/api/channel/grid')) {
        return jsonResponse({
          total: 1,
          entries: [
            {
              uuid: 'channel-without-guide',
              name: 'No Guide',
              enabled: true,
              number: 1,
              tags: [],
            },
          ],
        });
      }
      if (url.includes('/api/channeltag/grid')) {
        return jsonResponse({ total: 0, entries: [] });
      }
      if (url.includes('/api/epg/events/grid')) {
        return jsonResponse({ totalCount: 0, entries: [] });
      }
      return jsonResponse({ entries: [] });
    });

    const manifest = await new TvheadendAddon({
      url: 'https://tvh.example:9981',
      timeout: 5000,
    }).getManifest();

    expect(manifest.behaviorHints?.epgProvider).toBeUndefined();
  });

  it('does not merge identities across different server URLs', async () => {
    const addonA = new TvheadendAddon({
      url: 'https://tvh-a.example:9981',
      timeout: 5000,
    });
    const addonB = new TvheadendAddon({
      url: 'https://tvh-b.example:9981',
      timeout: 5000,
    });
    const [a] = await addonA.getCatalog();
    const [b] = await addonB.getCatalog();
    expect(a.id).not.toBe(b.id);
  });
});
