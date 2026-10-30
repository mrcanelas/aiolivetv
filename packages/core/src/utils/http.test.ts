import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('./index.js', () => ({
  Cache: { getInstance: () => ({ get: vi.fn(), set: vi.fn() }) },
  HEADERS_FOR_IP_FORWARDING: [],
  INTERNAL_SECRET_HEADER: 'x-internal',
  maskSensitiveInfo: () => '***',
}));
vi.mock('../config/index.js', () => ({
  config: {
    bootstrap: { internalUrl: 'http://localhost', allowPrivateUrls: true },
    http: {},
    recursion: { thresholdLimit: 10, thresholdWindow: 60 },
  },
}));
vi.mock('../logging/logger.js', () => ({
  createLogger: () => ({ trace: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('undici', async (original) => ({
  ...(await original<typeof import('undici')>()),
  fetch: vi.fn(),
}));

const { makeRequest } = await import('./http.js');
const { fetch } = await import('undici');
beforeEach(() => {
  vi.mocked(fetch).mockReset();
});

it.each([402, 407])(
  'exposes a safe diagnostic for proxy HTTP %i without retrying directly',
  async (status) => {
    const error = new TypeError('fetch failed', {
      cause: new Error('Request was cancelled.', {
        cause: new Error(
          `Proxy response (${status}) !== 200 when HTTP Tunneling`
        ),
      }),
    });
    vi.mocked(fetch).mockRejectedValue(error);
    await expect(
      makeRequest('https://example.com', { timeout: 1000 })
    ).rejects.toMatchObject({
      statusCode: 502,
      message: expect.stringContaining(
        `Outbound proxy refused the connection (HTTP ${status})`
      ),
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  }
);

it('preserves unrelated network errors', async () => {
  const error = new TypeError('fetch failed', {
    cause: new Error('DNS failure'),
  });
  vi.mocked(fetch).mockRejectedValue(error);
  await expect(
    makeRequest('https://example.com', { timeout: 1000 })
  ).rejects.toBe(error);
});
