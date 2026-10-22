import express from 'express';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import proxyApi from './proxy.js';

const fixture = vi.hoisted(() => ({ allowed: true, upstreamCalls: 0 }));

vi.mock('@aiolivetv/core', async () => {
  const constants = await import('../../../../core/src/utils/constants.js');
  return {
    constants,
    APIError: constants.APIError,
    appConfig: {
      bootstrap: { auth: new Map([['viewer', 'secret']]) },
      http: {},
    },
    Env: {},
    createLogger: () => ({ debug() {}, warn() {}, error() {}, silly() {} }),
    fromUrlSafeBase64: (value: string) =>
      Buffer.from(value, 'base64url').toString(),
    decryptString: () => ({ data: undefined }),
    isEphemeralRuntime: () => false,
    canUseProxy: () => fixture.allowed,
    shouldProxy: () => ({ useProxy: false }),
    domainHasUserAgent: () => undefined,
    getProxyAgent: () => undefined,
    getTimeTakenSincePoint: () => '0ms',
    sameOrigin: () => false,
    createProxy: vi.fn(),
    BuiltinProxy: class {},
    BuiltinProxyStats: class {
      async addConnection() {}
      async endConnection() {}
    },
  };
});
vi.mock('../../middlewares/auth.js', () => ({
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../../middlewares/cors.js', () => ({
  corsMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../../app.js', () => ({ StaticFiles: {} }));

const servers: Server[] = [];
function serve(app: express.Express): string {
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  return `http://127.0.0.1:${address.port}`;
}

beforeEach(() => {
  fixture.allowed = true;
  fixture.upstreamCalls = 0;
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

async function proxyRequest(
  username: string,
  password: string,
  type = 'stream'
) {
  const upstream = express();
  upstream.get('/live', (req, res) => {
    fixture.upstreamCalls++;
    res.set('Content-Type', 'video/mp2t');
    res.send(req.get('X-Provider') ?? 'missing-header');
  });
  const url = `${serve(upstream)}/live`;
  const app = express();
  app.use(proxyApi);
  app.use(
    (
      error: { statusCode?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      res.status(error.statusCode ?? 500).end();
    }
  );
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return fetch(
    `${serve(app)}/u.${encode({ username, password })}.${encode({
      url,
      type,
      requestHeaders: { 'X-Provider': 'live-stream' },
    })}`
  );
}

describe('authenticated Live TV media proxy', () => {
  it('forwards streams and provider headers for an authorised user', async () => {
    const response = await proxyRequest('viewer', 'secret');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('live-stream');
    expect(response.headers.get('Content-Type')).toContain('video/mp2t');
    expect(fixture.upstreamCalls).toBe(1);
  });

  it.each([
    ['viewer', 'wrong-password'],
    ['public_nzb_proxy_user', 'any-password'],
  ])(
    'rejects invalid credentials for %s before contacting the source',
    async (username, password) => {
      const response = await proxyRequest(username, password);
      expect(response.status).toBe(401);
      expect(fixture.upstreamCalls).toBe(0);
    }
  );

  it('requires proxy permission even with valid credentials', async () => {
    fixture.allowed = false;
    expect((await proxyRequest('viewer', 'secret')).status).toBe(403);
    expect(fixture.upstreamCalls).toBe(0);
  });

  it('rejects retired NZB payloads before contacting the source', async () => {
    expect((await proxyRequest('viewer', 'secret', 'nzb')).ok).toBe(false);
    expect(fixture.upstreamCalls).toBe(0);
  });
});
