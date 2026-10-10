import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import catalogRouter from './catalog.js';

const fixture = vi.hoisted(() => ({ cacheable: true, getCatalog: vi.fn() }));
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
    async getCatalog(...args: unknown[]) {
      fixture.getCatalog(...args);
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

async function requestCatalog(cacheable: boolean, extras = 'date=2026-10-07') {
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
    `http://127.0.0.1:${address.port}/catalog/tv/aiolivetv.merged.live-tv${extras ? `/${extras}` : ''}.json`
  );
}

describe('Stremio guide catalog caching', () => {
  it.each([
    'genre=News%20%26%20Sports&skip=0',
    'search=a%3Db%26c',
    'genre=C%2B%2B',
    'genre=%2526',
    'genre=News%2FSports',
    '',
  ])('passes encoded extras to core: %s', async (extras) => {
    const response = await requestCatalog(true, extras);
    expect(response.status).toBe(200);
    expect(fixture.getCatalog).toHaveBeenLastCalledWith(
      'tv',
      'aiolivetv.merged.live-tv',
      extras || undefined
    );
  });

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
