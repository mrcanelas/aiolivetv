import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import catalogRouter from './catalog.js';

const fixture = vi.hoisted(() => ({ cacheable: true }));
vi.mock('../../middlewares/ratelimit.js', () => ({
  stremioCatalogRateLimiter: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));
vi.mock('../../middlewares/analytics.js', () => ({
  trackResource: () => (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));
vi.mock('@aiolivetv/core', () => ({
  createLogger: () => ({ error: vi.fn() }),
  AIOStreams: class {
    async initialise() {
      return this;
    }
    async getCatalog() {
      return {
        success: true,
        data: [],
        errors: [],
        cacheable: fixture.cacheable,
        metasDetailed: [
          { id: 'channel:1', type: 'tv', name: 'Channel', videos: [] },
        ],
      };
    }
  },
  StremioTransformer: class {
    transformCatalog(result: { metasDetailed: unknown[] }) {
      return { metasDetailed: result.metasDetailed };
    }
  },
}));

let server: Server;
afterEach(() => {
  server?.close();
});

async function requestCatalog(cacheable: boolean) {
  fixture.cacheable = cacheable;
  const app = express();
  app.use((req, _res, next) => {
    req.userData = {} as typeof req.userData;
    next();
  });
  app.use('/catalog', catalogRouter);
  server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Test server did not bind');
  return fetch(
    `http://127.0.0.1:${address.port}/catalog/tv/aiolivetv.merged.live-tv/date=2026-10-07.json`
  );
}

describe('Stremio guide catalog caching', () => {
  it('does not cache schedules missing because a provider timed out', async () => {
    const response = await requestCatalog(false);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const body = await response.json();
    expect(body).toMatchObject({ metasDetailed: [{ id: 'channel:1' }] });
    expect(body).not.toHaveProperty('cacheMaxAge');
    expect(body).not.toHaveProperty('staleRevalidate');
    expect(body).not.toHaveProperty('staleError');
  });

  it('preserves cache hints for complete guide pages', async () => {
    const response = await requestCatalog(true);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('s-maxage=300');
    expect(await response.json()).toMatchObject({ cacheMaxAge: 300 });
  });
});
