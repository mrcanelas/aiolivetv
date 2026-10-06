import express from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import healthApi from './health.js';
import { errorMiddleware } from '../../middlewares/errors.js';
import { UserRepository } from '@aiolivetv/core';

vi.mock('@aiolivetv/core', () => {
  class APIError extends Error {
    code: string;
    statusCode: number;

    constructor(code: string, message = 'Internal Server Error') {
      super(message);
      this.code = code;
      this.statusCode = 500;
    }
  }

  return {
    APIError,
    constants: {
      ErrorCode: {
        INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
        BAD_REQUEST: 'BAD_REQUEST',
        RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
      },
    },
    createLogger: () => ({
      error: vi.fn(),
    }),
    StremioTransformer: {
      createDynamicError: vi.fn(),
    },
    UserRepository: {
      getUserCount: vi.fn(),
    },
  };
});

const NO_CACHE_HEADERS = {
  'cache-control': 'no-store, no-cache, must-revalidate',
  'cdn-cache-control': 'no-store, no-cache, must-revalidate',
  'vercel-cdn-cache-control': 'no-store, no-cache, must-revalidate',
  'surrogate-control': 'no-store',
  pragma: 'no-cache',
  expires: '0',
};

function createTestApp() {
  const app = express();
  app.use('/health', healthApi);
  app.use(errorMiddleware);
  return app;
}

function expectNoCacheHeaders(headers: Headers) {
  for (const [name, value] of Object.entries(NO_CACHE_HEADERS)) {
    expect(headers.get(name)).toBe(value);
  }
}

async function requestHealth(app: express.Express) {
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server did not bind to a TCP port');
    }
    return await fetch(`http://127.0.0.1:${address.port}/health`);
  } finally {
    server.close();
  }
}

describe('health API cache headers', () => {
  beforeEach(() => {
    vi.mocked(UserRepository.getUserCount).mockReset();
  });

  it('disables cache on successful health checks', async () => {
    vi.mocked(UserRepository.getUserCount).mockResolvedValue(1);

    const response = await requestHealth(createTestApp());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      detail: 'OK',
    });
    expectNoCacheHeaders(response.headers);
  });

  it('keeps cache disabled when the database check fails', async () => {
    vi.mocked(UserRepository.getUserCount).mockRejectedValue(
      new Error('database unavailable')
    );

    const response = await requestHealth(createTestApp());

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'database unavailable',
      },
    });
    expectNoCacheHeaders(response.headers);
  });
});
