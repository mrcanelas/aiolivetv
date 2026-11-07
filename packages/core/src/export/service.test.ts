import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserData } from '../db/schemas.js';
import { parseM3u } from '../builtins/m3u-reader/parser.js';
import { buildM3uForUser, getCachedM3u, getCachedXmltv } from './service.js';
import { resolveExportStream } from './playback.js';

const fixture = vi.hoisted(() => ({
  proxy: false,
  meta: vi.fn(),
  streams: vi.fn(),
  caches: new Map<string, Map<string, string>>(),
}));
vi.mock('../config/index.js', () => ({
  config: {
    bootstrap: { baseUrl: 'https://app.test', allowPrivateUrls: false },
    builtins: {
      export: {
        enabled: true,
        disabledReason: '',
        get proxyEnabled() {
          return fixture.proxy;
        },
        epgWindowHours: 48,
      },
    },
  },
}));
vi.mock('../main/index.js', () => ({
  AIOStreams: class {
    async initialise() {
      return this;
    }
    getMeta = fixture.meta;
    getStreams = fixture.streams;
  },
}));
vi.mock('../db/db.js', () => ({ getDb: vi.fn() }));
vi.mock('../utils/index.js', () => ({
  createLogger: () => ({ warn: vi.fn(), debug: vi.fn() }),
  Cache: {
    getInstance: (name: string) => {
      const cache = new Map<string, string>();
      fixture.caches.set(name, cache);
      return {
        get: async (key: string) => cache.get(key),
        set: async (key: string, body: string) => {
          cache.set(key, body);
        },
      };
    },
  },
}));

function user(): UserData {
  return {
    uuid: 'user',
    presets: [],
    channelMappings: [
      {
        id: 'aiolivetv:one',
        streams: [
          {
            addonId: 'manual',
            channelId: 'one',
            url: 'https://provider.test/live.m3u8',
          },
        ],
      },
    ],
  } as unknown as UserData;
}
beforeEach(() => {
  vi.clearAllMocks();
  for (const cache of fixture.caches.values()) cache.clear();
  fixture.proxy = false;
  fixture.meta.mockResolvedValue({
    data: {
      name: 'One',
      poster: 'https://provider.test/logo.png',
      genres: ['News'],
      videos: [],
    },
  });
  fixture.streams.mockResolvedValue({
    data: { streams: [{ url: 'https://provider.test/live.m3u8' }] },
  });
});

describe('export saved configuration', () => {
  it('reads current numbers and preserves manual order when the M3U is reimported', async () => {
    const saved = user();
    const first = saved.channelMappings![0];
    const second = { ...first, id: 'aiolivetv:two' };
    saved.channelMappings!.push(second);
    fixture.meta.mockImplementation(async (_type, id) => ({
      data: { name: id, channelNumber: id === first.id ? 20 : 10 },
    }));

    const original = await buildM3uForUser('token', saved);
    expect(
      parseM3u(original.body).map(({ channelId, channelNumber }) => [
        channelId,
        channelNumber,
      ])
    ).toEqual([
      [second.id, 10],
      [first.id, 20],
    ]);

    saved.channelOrder = [first.id, second.id];
    const reordered = await buildM3uForUser('token', saved);
    expect(
      parseM3u(reordered.body).map(({ channelId, channelNumber }) => [
        channelId,
        channelNumber,
      ])
    ).toEqual([
      [first.id, 1],
      [second.id, 2],
    ]);
  });

  it('loads default metadata and preserves saved customizations', async () => {
    const first = await buildM3uForUser('token', user());
    expect(first.body).toContain('tvg-name="One"');
    expect(first.body).toContain('group-title="News"');
    const customized = user();
    Object.assign(customized.channelMappings![0], {
      name: 'Custom',
      group: 'Sports',
      poster: 'https://custom.test/logo.png',
    });
    const second = await buildM3uForUser('token', customized);
    expect(second.body).toContain('tvg-name="Custom"');
    expect(second.body).toContain('group-title="Sports"');
    expect(second.body).toContain('tvg-logo="https://custom.test/logo.png"');
  });

  it('refreshes playlists and guides after a save instead of reusing old mappings', async () => {
    const saved = user();
    expect(await getCachedM3u('token', saved)).toContain('tvg-name="One"');
    expect(await getCachedXmltv('token', saved)).toContain(
      '<display-name>One</display-name>'
    );
    saved.channelMappings![0].name = 'Renamed';
    expect(await getCachedM3u('token', saved)).toContain('tvg-name="Renamed"');
    expect(await getCachedXmltv('token', saved)).toContain(
      '<display-name>Renamed</display-name>'
    );
    saved.channelMappings![0].enabled = false;
    expect(await getCachedM3u('token', saved)).not.toContain('#EXTINF');
    expect(await getCachedXmltv('token', saved)).not.toContain('<channel');
  });

  it('exports real EPG events and keeps channels when no EPG exists', async () => {
    const start = new Date(Date.now() - 60_000).toISOString();
    const end = new Date(Date.now() + 60_000).toISOString();
    fixture.meta.mockResolvedValueOnce({
      data: {
        name: 'One',
        videos: [{ title: 'Live News', startTime: start, endTime: end }],
      },
    });
    expect(await getCachedXmltv('epg', user())).toContain(
      '<title>Live News</title>'
    );
    const withoutEpg = await getCachedXmltv('no-epg', user());
    expect(withoutEpg).toContain('<channel id="aiolivetv:one">');
    expect(withoutEpg).not.toContain('<programme');
  });

  it('does not resolve disabled or unexported channels', async () => {
    const saved = user();
    saved.channelMappings![0].enabled = false;
    await expect(
      resolveExportStream(saved, 'aiolivetv:one')
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      resolveExportStream(user(), 'aiolivetv:unknown')
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(fixture.streams).not.toHaveBeenCalled();
  });

  it('requires proxy for header authentication and preserves headers there', async () => {
    fixture.streams.mockResolvedValue({
      data: {
        streams: [
          {
            url: 'https://provider.test/live.m3u8',
            requestHeaders: { Authorization: 'Bearer test' },
          },
        ],
      },
    });
    await expect(
      resolveExportStream(user(), 'aiolivetv:one')
    ).rejects.toMatchObject({ code: 'proxy_required' });
    fixture.proxy = true;
    await expect(
      resolveExportStream(user(), 'aiolivetv:one')
    ).resolves.toMatchObject({
      mode: 'proxy',
      headers: { Authorization: 'Bearer test' },
    });
  });
});
