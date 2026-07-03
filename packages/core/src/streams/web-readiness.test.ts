import { describe, expect, it, vi } from 'vitest';

vi.mock('../utils/index.js', () => ({
  makeRequest: vi.fn(),
}));

import type { ParsedStream } from '../db/schemas.js';
import {
  applyLiveStreamWebHints,
  hasStreamProxyHeaders,
  resolveNotWebReady,
} from './web-readiness.js';

const passthroughStream = {
  addon: {
    name: 'FrostView TV',
    manifestUrl: 'https://example.com/manifest.json',
    enabled: true,
    timeout: 10_000,
    resultPassthrough: true,
    preset: { id: '', type: 'frost-view', options: {} },
  },
  id: 'stream-1',
  type: 'live',
  url: 'https://frostview.example/proxy/hls/stream.m3u8',
  requestHeaders: { referer: 'https://example.com' },
} satisfies ParsedStream;

describe('web-readiness', () => {
  it('does not infer notWebReady from provider proxy headers alone', async () => {
    expect(
      hasStreamProxyHeaders({
        behaviorHints: { proxyHeaders: { request: { Referer: 'https://x' } } },
      })
    ).toBe(true);
    await expect(
      resolveNotWebReady(
        {
          url: 'https://example.com/stream.m3u8',
          behaviorHints: {
            proxyHeaders: { request: { Referer: 'https://x' } },
          },
        },
        { probe: false }
      )
    ).resolves.toBeUndefined();
  });

  it('honors explicit provider notWebReady hints', async () => {
    await expect(
      resolveNotWebReady({ notWebReady: true }, { probe: false })
    ).resolves.toBe(true);
    await expect(
      resolveNotWebReady({ notWebReady: false }, { probe: false })
    ).resolves.toBeUndefined();
  });

  it('skips inference for resultPassthrough live providers', async () => {
    const [stream] = await applyLiveStreamWebHints([passthroughStream], {
      probe: false,
    });
    expect(stream.notWebReady).toBeUndefined();
  });

  it('keeps explicit notWebReady from resultPassthrough providers', async () => {
    const [stream] = await applyLiveStreamWebHints(
      [{ ...passthroughStream, notWebReady: true }],
      { probe: false }
    );
    expect(stream.notWebReady).toBe(true);
  });
});
