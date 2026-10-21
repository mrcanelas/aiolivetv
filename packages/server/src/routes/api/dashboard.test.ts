import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import dashboardApi from './dashboard.js';

const fixture = vi.hoisted(() => ({ authorized: true, value: 'before' }));

vi.mock('@aiolivetv/core', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
  settingsStore: {
    metadata: [{ key: 'http.addonProxyConfig', secret: false }],
    getEffectiveValue: () => fixture.value,
  },
  describeSettings: () => ({}),
}));

vi.mock('../../middlewares/auth.js', () => ({
  requireAdmin: (_req: unknown, res: express.Response, next: () => void) => {
    if (fixture.authorized) next();
    else res.status(401).json({ success: false });
  },
}));

let server: Server | undefined;
afterEach(async () => {
  fixture.authorized = true;
  fixture.value = 'before';
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});

async function requestSettings() {
  if (!server) {
    const app = express();
    app.use('/dashboard', dashboardApi);
    server = app.listen(0);
  }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  return fetch(`http://127.0.0.1:${address.port}/dashboard/settings`);
}

function expectNoCache(headers: Headers) {
  expect(headers.get('cache-control')).toBe(
    'private, no-store, no-cache, must-revalidate'
  );
  for (const name of [
    'cdn-cache-control',
    'vercel-cdn-cache-control',
    'surrogate-control',
  ]) {
    expect(headers.get(name)).toBe('no-store');
  }
  expect(headers.get('pragma')).toBe('no-cache');
  expect(headers.get('expires')).toBe('0');
}

describe('dashboard cache headers', () => {
  it('returns updated settings without allowing browser or CDN caching', async () => {
    const before = await requestSettings();
    expect(await before.json()).toMatchObject({
      data: { keys: [{ value: 'before' }] },
    });
    expectNoCache(before.headers);

    fixture.value = 'after';
    const after = await requestSettings();
    expect(await after.json()).toMatchObject({
      data: { keys: [{ value: 'after' }] },
    });
    expectNoCache(after.headers);
  });

  it('also prevents caching authentication failures', async () => {
    fixture.authorized = false;
    const response = await requestSettings();
    expect(response.status).toBe(401);
    expectNoCache(response.headers);
  });
});
