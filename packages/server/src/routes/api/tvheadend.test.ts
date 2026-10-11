import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testTvheadendConnection } from '@aiolivetv/core';
import tvheadendApi from './tvheadend.js';

const fixture = vi.hoisted(() => ({ initialised: false, timeout: 5000 }));

vi.mock('@aiolivetv/core', () => ({
  appConfig: {
    presets: {
      get defaultTimeout() {
        if (!fixture.initialised)
          throw new Error('Config read before initialisation');
        return fixture.timeout;
      },
    },
  },
  createLogger: () => ({}),
  testTvheadendConnection: vi.fn(async () => ({
    success: true,
    message: 'OK',
  })),
}));
vi.mock('../../middlewares/cors.js', () => ({
  corsMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const servers: ReturnType<express.Express['listen']>[] = [];
async function probe(body: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use('/tvheadend', tvheadendApi);
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  const response = await fetch(
    `http://127.0.0.1:${address.port}/tvheadend/test`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  await response.text();
  return response.status;
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.initialised = true;
  fixture.timeout = 5000;
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

describe('TVHeadend request defaults', () => {
  it('reads the current timeout per request after configuration initialisation', async () => {
    expect(await probe({ url: 'https://tvheadend.test' })).toBe(200);
    expect(testTvheadendConnection).toHaveBeenLastCalledWith(
      expect.objectContaining({ timeout: 5000 })
    );
    fixture.timeout = 9000;
    expect(await probe({ url: 'https://tvheadend.test' })).toBe(200);
    expect(testTvheadendConnection).toHaveBeenLastCalledWith(
      expect.objectContaining({ timeout: 9000 })
    );
  });

  it('preserves an explicitly supplied timeout', async () => {
    fixture.initialised = false;
    expect(await probe({ url: 'https://tvheadend.test', timeout: 1234 })).toBe(
      200
    );
    expect(testTvheadendConnection).toHaveBeenLastCalledWith(
      expect.objectContaining({ timeout: 1234 })
    );
  });
});
