import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Addon, Manifest } from '../db/schemas.js';

const stores = new Map<string, Map<string, unknown>>();
vi.mock('../config/index.js', () => ({ config: {} }));
vi.mock('../presets/index.js', () => ({
  Preset: class {},
  PresetManager: { fromId: () => ({ getCacheKey: () => undefined }) },
}));
vi.mock('../analytics/index.js', () => ({
  track: vi.fn(),
  classifyAddonError: vi.fn(),
  hmac: vi.fn(),
}));
vi.mock('../utils/index.js', () => ({
  Cache: {
    getInstance: (name: string) => ({
      get: async (key: string) => stores.get(name)?.get(key),
      set: async (key: string, value: unknown) => {
        if (!stores.has(name)) stores.set(name, new Map());
        stores.get(name)!.set(key, value);
      },
    }),
  },
  appConfig: {
    resources: {
      timeouts: { manifest: 3000 },
      background: { enabled: true, timeout: 15000 },
      cache: { manifest: { ttl: { '*': 21600 } } },
    },
  },
  makeRequest: vi.fn(),
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn() }),
  makeUrlLogSafe: (url: string) => url,
  isEphemeralRuntime: () => false,
  PossibleRecursiveRequestError: class extends Error {},
}));

const { Wrapper } = await import('./wrapper.js');
const { makeRequest } = await import('../utils/index.js');
const manifest: Manifest = {
  id: 'org.aiolivetv.orange-tv',
  name: 'Orange TV',
  version: '1.0.0',
  types: ['tv'],
  resources: ['catalog', 'meta'],
  catalogs: [
    { id: 'channels', name: 'Channels', type: 'tv', extra: [{ name: 'date' }] },
  ],
  behaviorHints: { epgProvider: true },
};
function addon(type = 'orange-tv'): Addon {
  return {
    name: type,
    enabled: true,
    manifestUrl: `http://localhost/${type}/manifest.json`,
    timeout: 7000,
    preset: { id: '', type, options: {} },
  } as Addon;
}
function response(data: Manifest) {
  return new Response(JSON.stringify(data)) as unknown as Awaited<
    ReturnType<typeof makeRequest>
  >;
}

beforeEach(() => {
  stores.clear();
  vi.mocked(makeRequest).mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('EPG manifest requests', () => {
  it('normalizes RTVE TV catalogs without importing radio or on-demand catalogs, including cached responses', async () => {
    const upstream = {
      ...manifest,
      types: ['tv', 'movie', 'series'],
      idPrefixes: ['tve:', 'rne:', 'rtvep:'],
      catalogs: [
        {
          id: 'tv',
          type: 'TV',
          name: 'Live channels',
          extra: [{ name: 'date' }],
        },
        { id: 'radio', type: 'Radio', name: 'Live radio' },
        { id: 'search', type: 'search results', name: 'RTVE Play' },
      ],
    };
    vi.mocked(makeRequest).mockResolvedValue(response(upstream));
    const wrapper = new Wrapper(addon('rtve'));
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await wrapper.getManifest();
      expect(result.types).toEqual(['tv']);
      expect(result.idPrefixes).toEqual(['tve:']);
      expect(result.catalogs).toEqual([
        { ...upstream.catalogs[0], type: 'tv' },
      ]);
      expect(result.behaviorHints?.epgProvider).toBe(true);
    }
    expect(makeRequest).toHaveBeenCalledOnce();
    expect(upstream.catalogs[0].type).toBe('TV');
  });
  it.each(['orange-tv', 'movistar-plus', 'tdtchannels', 'xtream'])(
    'waits beyond the global 3s timeout for a verified guide: %s',
    async (type) => {
      vi.mocked(makeRequest).mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 3500));
        return response(manifest);
      });
      const result = new Wrapper(addon(type)).getManifest();
      await vi.advanceTimersByTimeAsync(3500);
      expect((await result).behaviorHints?.epgProvider).toBe(true);
    }
  );

  it('revalidates an old cached manifest without EPG and caches the successful result', async () => {
    const source = addon();
    const negative = { ...manifest, behaviorHints: undefined };
    stores.set('manifest', new Map([[source.manifestUrl, negative]]));
    vi.mocked(makeRequest).mockResolvedValue(response(manifest));
    const wrapper = new Wrapper(source);
    expect((await wrapper.getManifest()).behaviorHints?.epgProvider).toBe(true);
    expect((await wrapper.getManifest()).behaviorHints?.epgProvider).toBe(true);
    expect(makeRequest).toHaveBeenCalledOnce();
  });

  it.each(['orange-tv', 'xtream'])(
    'retries a temporary no-EPG response without claiming EPG prematurely: %s',
    async (type) => {
      vi.mocked(makeRequest)
        .mockResolvedValueOnce(
          response({ ...manifest, behaviorHints: undefined })
        )
        .mockResolvedValueOnce(response(manifest));
      const wrapper = new Wrapper(addon(type));
      expect(
        (await wrapper.getManifest()).behaviorHints?.epgProvider
      ).toBeUndefined();
      expect((await wrapper.getManifest()).behaviorHints?.epgProvider).toBe(
        true
      );
      expect(makeRequest).toHaveBeenCalledTimes(2);
    }
  );

  it('keeps the normal timeout for external addons', async () => {
    vi.mocked(makeRequest).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3500));
      return response(manifest);
    });
    const result = expect(
      new Wrapper(addon('custom')).getManifest()
    ).rejects.toThrow('timed out after 3000ms');
    await vi.advanceTimersByTimeAsync(3000);
    await result;
    await vi.advanceTimersByTimeAsync(500);
  });
});
