import express from 'express';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from 'undici';
import {
  assertSafeOutboundUrl,
  getCachedM3u,
  isEphemeralRuntime,
  resolveExportStream,
  rewriteHlsPlaylist,
} from '@aiolivetv/core';
import exportsRouter from './exports.js';

vi.mock('undici', () => ({ request: vi.fn() }));
vi.mock('../middlewares/cors.js', () => ({
  corsMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('@aiolivetv/core', () => {
  class APIError extends Error {
    constructor(
      public code: string,
      _unused?: unknown,
      message?: string
    ) {
      super(message);
    }
  }
  return {
    APIError,
    ExportPolicyError: class extends Error {},
    SsrfError: class extends Error {},
    constants: {
      ErrorCode: {
        FORBIDDEN: 'forbidden',
        BAD_REQUEST: 'bad_request',
        UNAUTHORIZED: 'unauthorized',
      },
    },
    config: {
      bootstrap: { baseUrl: 'https://app.test', allowPrivateUrls: false },
      http: { defaultUserAgent: 'Test' },
    },
    UserRepository: { getUser: vi.fn(async () => ({ uuid: 'user' })) },
    assertExportEnabled: vi.fn(),
    assertExportProxyAllowed: vi.fn(),
    assertSafeOutboundUrl: vi.fn(async () => undefined),
    getCachedM3u: vi.fn(async () => '#EXTM3U\nfirst'),
    getCachedXmltv: vi.fn(async () => '<tv />'),
    isEphemeralRuntime: vi.fn(() => false),
    isRedirectStatus: (status: number) =>
      [301, 302, 303, 307, 308].includes(status),
    MAX_SSRF_REDIRECTS: 5,
    resolveExportToken: vi.fn(async () => ({
      uuid: 'user',
      password: 'password',
    })),
    resolveExportStream: vi.fn(async () => ({
      url: 'https://provider.test/live.m3u8',
      mode: 'proxy',
      headers: { Authorization: 'secret' },
    })),
    encryptString: (data: string) => ({
      success: true,
      data: Buffer.from(data).toString('base64url'),
    }),
    decryptString: (data: string) => ({
      success: true,
      data: Buffer.from(data, 'base64url').toString(),
    }),
    rewriteHlsPlaylist: vi.fn(
      (_body: string, _base: string, rewrite: (url: URL) => string) =>
        rewrite(new URL('https://provider.test/nested.m3u8'))
    ),
  };
});

const servers: ReturnType<express.Express['listen']>[] = [];
async function get(path: string, headers?: Record<string, string>) {
  const app = express();
  app.use('/exports', exportsRouter);
  app.use(
    (
      error: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      res.status(400).json({ error: error.message });
    }
  );
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  const response = await fetch(
    `http://127.0.0.1:${address.port}/exports/${path}`,
    { headers }
  );
  return { response, body: await response.text() };
}
function upstream(
  body: string,
  contentType: string,
  statusCode = 200,
  headers: Record<string, string> = {}
) {
  return {
    statusCode,
    headers: { 'content-type': contentType, ...headers },
    body: Readable.from([Buffer.from(body)]),
  } as unknown as Awaited<ReturnType<typeof request>>;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertSafeOutboundUrl).mockResolvedValue(
    new URL('https://provider.test')
  );
  vi.mocked(isEphemeralRuntime).mockReturnValue(false);
});
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        })
    )
  );
});

describe('export routes', () => {
  it('changes ETag when content changes after a common prefix', async () => {
    const first = await get('token/channels.m3u');
    const etag = first.response.headers.get('etag')!;
    const unchanged = await get('token/channels.m3u', {
      'If-None-Match': etag,
    });
    expect(unchanged.response.status).toBe(304);
    expect(unchanged.response.headers.get('etag')).toBe(etag);
    vi.mocked(getCachedM3u).mockResolvedValueOnce('#EXTM3U\nsecond');
    const changed = await get('token/channels.m3u', { 'If-None-Match': etag });
    expect(changed.response.status).toBe(200);
    expect(changed.response.headers.get('etag')).not.toBe(etag);
  });

  it('validates destinations and rewrites nested HLS playlists recursively', async () => {
    vi.mocked(request).mockResolvedValueOnce(
      upstream('#EXTM3U\nvariant.m3u8', 'application/vnd.apple.mpegurl')
    );
    const first = await get('token/play/channel%25id');
    expect(first.response.status).toBe(200);
    expect(resolveExportStream).toHaveBeenCalledWith(
      { uuid: 'user' },
      'channel%id'
    );
    expect(assertSafeOutboundUrl).toHaveBeenCalled();
    vi.mocked(request).mockResolvedValueOnce(
      upstream('#EXTM3U\nsegment.ts', 'application/vnd.apple.mpegurl')
    );
    const nested = await get(
      new URL(first.body).pathname.replace('/exports/', '')
    );
    expect(nested.response.status).toBe(200);
    expect(rewriteHlsPlaylist).toHaveBeenCalledTimes(2);
    const options = vi.mocked(request).mock.calls[1][1];
    expect(options?.headers).toMatchObject({ Authorization: 'secret' });
  });

  it('blocks unsafe destinations before contacting the provider', async () => {
    vi.mocked(assertSafeOutboundUrl).mockRejectedValueOnce(
      new Error('Blocked destination')
    );
    expect((await get('token/play/channel')).response.status).toBe(400);
    expect(request).not.toHaveBeenCalled();
  });

  it('binds segment payloads to their export token and enforces runtime policy', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        kind: 'export-segment',
        token: 'other',
        u: 'https://provider.test/segment.ts',
        h: {},
      })
    ).toString('base64url');
    expect((await get('token/segment/' + payload)).response.status).toBe(400);
    vi.mocked(isEphemeralRuntime).mockReturnValue(true);
    expect((await get('token/play/channel')).response.status).toBe(400);
    expect(request).not.toHaveBeenCalled();
  });

  it('validates redirects and strips credentials when the origin changes', async () => {
    vi.mocked(request)
      .mockResolvedValueOnce(
        upstream('', 'text/plain', 302, {
          location: 'https://cdn.test/segment.ts',
        })
      )
      .mockResolvedValueOnce(upstream('video', 'video/mp2t'));
    const result = await get('token/play/channel');
    expect(result.body).toBe('video');
    expect(assertSafeOutboundUrl).toHaveBeenCalledTimes(2);
    expect(vi.mocked(request).mock.calls[1][1]?.headers).not.toHaveProperty(
      'Authorization'
    );
  });
});
