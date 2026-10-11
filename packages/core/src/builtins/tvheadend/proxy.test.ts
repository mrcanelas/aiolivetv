process.env.BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
process.env.SECRET_KEY = process.env.SECRET_KEY || '0'.repeat(64);

import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';

const abortHandlers: Array<() => void> = [];

vi.mock('undici', () => ({
  request: vi.fn(async (_url: string, opts: { signal?: AbortSignal }) => {
    const body = new Readable({
      read() {
        this.push(Buffer.from('chunk'));
      },
    });
    if (opts.signal) {
      const onAbort = () => {
        body.destroy();
      };
      abortHandlers.push(onAbort);
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }
    body.on('error', () => undefined);
    return {
      statusCode: 200,
      headers: { 'content-type': 'video/mp2t' },
      body,
    };
  }),
}));

vi.mock('../../utils/index.js', () => ({
  makeRequest: vi.fn(),
  makeUrlLogSafe: (url: string) => url,
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  }),
  Cache: {
    getInstance: () => ({
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock('../../config/index.js', () => {
  const config = {
    bootstrap: {
      allowPrivateUrls: true,
      baseUrl: 'https://aio.example.com',
      secretKey: '0'.repeat(64),
    },
    builtins: {
      tvheadend: {
        enabled: true,
        disabledReason: '',
        proxyEnabled: true,
      },
    },
    http: { defaultUserAgent: 'AIOLiveTV/test' },
    userLimits: {
      disabled: {
        addons: {},
        removedAddons: {},
        hosts: {},
        services: {},
        streamTypes: [],
      },
    },
  };
  return { config };
});

const { openUpstreamStream } = await import('./client.js');

describe('TVHeadend upstream proxy abort', () => {
  it('aborts upstream when the client signal aborts', async () => {
    abortHandlers.length = 0;
    const clientAbort = new AbortController();
    const { response, abort } = await openUpstreamStream(
      {
        url: 'https://tvh.example:9981',
        username: 'u',
        password: 'p',
        playbackUrl: '',
        playbackMode: 'proxy',
        profile: 'pass',
        tagIds: '',
        timeout: 5000,
        timeShiftMinutes: 0,
      },
      'channel-1',
      clientAbort.signal
    );

    expect(response.statusCode).toBe(200);
    expect(abort.signal.aborted).toBe(false);

    clientAbort.abort();
    expect(abort.signal.aborted).toBe(true);
    expect(abortHandlers.length).toBeGreaterThan(0);
  });
});
