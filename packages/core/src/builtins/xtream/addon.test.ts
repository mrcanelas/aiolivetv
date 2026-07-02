import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockGetChannels = vi.fn();
const mockGetFullEpg = vi.fn();
const mockGenerateStreamUrl = vi.fn();

vi.mock('@iptv/xtream-api', () => ({
  Xtream: vi.fn().mockImplementation(() => ({
    getChannels: mockGetChannels,
    getFullEPG: mockGetFullEpg,
    generateStreamUrl: mockGenerateStreamUrl,
  })),
}));

vi.mock('@iptv/xtream-api/standardized', () => ({
  standardizedSerializer: { type: 'standardized', serializers: {} },
}));

vi.mock('../../utils/index.js', () => ({
  Cache: {
    getInstance: () => ({
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
    }),
  },
  toUrlSafeBase64: (value: string) => Buffer.from(value).toString('base64url'),
  fromUrlSafeBase64: (value: string) =>
    Buffer.from(value, 'base64url').toString(),
}));

vi.mock('../../streams/web-readiness.js', () => ({
  resolveNotWebReady: vi.fn().mockResolvedValue(undefined),
}));

const { XtreamAddon } = await import('./addon.js');
const { encodeChannelId } = await import('../live-tv/shared.js');

describe('XtreamAddon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetChannels.mockResolvedValue([
      {
        id: '101',
        name: 'News 24',
        epgId: 'news24',
        number: 1,
        tvArchive: false,
        tvArchiveDuration: 0,
        logo: 'https://example.com/news.png',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        url: 'https://example.com/live/news.m3u8',
      },
    ]);
    mockGetFullEpg.mockResolvedValue([
      {
        id: '1',
        epgId: '1',
        title: 'Morning News',
        language: 'en',
        start: new Date('2026-06-28T12:00:00.000Z'),
        end: new Date('2026-06-28T13:00:00.000Z'),
        description: 'Latest headlines',
        channelId: '101',
        nowPlaying: false,
        hasArchive: false,
      },
    ]);
    mockGenerateStreamUrl.mockReturnValue('https://example.com/live/generated.m3u8');
  });

  it('exposes tv catalog, meta, stream and epgProvider manifest', () => {
    const addon = new XtreamAddon({
      url: 'http://example.com:8080',
      username: 'user',
      password: 'pass',
      timeout: 5000,
    });
    const manifest = addon.getManifest();
    expect(manifest.behaviorHints?.epgProvider).toBe(true);
    expect(manifest.catalogs[0]).toMatchObject({
      type: 'tv',
      extra: [{ name: 'skip' }, { name: 'date' }],
    });
    expect(manifest.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'catalog' }),
        expect.objectContaining({ name: 'meta' }),
        expect.objectContaining({ name: 'stream' }),
      ])
    );
  });

  it('returns channel catalog previews', async () => {
    const addon = new XtreamAddon({
      url: 'http://example.com:8080',
      username: 'user',
      password: 'pass',
      timeout: 5000,
    });
    const [channel] = await addon.getCatalog();
    expect(channel).toMatchObject({
      id: encodeChannelId('101'),
      type: 'tv',
      name: 'News 24',
      poster: 'https://example.com/news.png',
      tvgId: 'news24',
    });
  });

  it('returns meta with programs for the current UTC day', async () => {
    const addon = new XtreamAddon({
      url: 'http://example.com:8080',
      username: 'user',
      password: 'pass',
      timeout: 5000,
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-28T12:00:00.000Z'));
    const meta = await addon.getMeta(encodeChannelId('101'));
    vi.useRealTimers();
    expect(meta.videos?.[0]).toMatchObject({
      title: 'Morning News',
      overview: 'Latest headlines',
      startTime: '2026-06-28T12:00:00.000Z',
      endTime: '2026-06-28T13:00:00.000Z',
    });
    expect(mockGetFullEpg).toHaveBeenCalledWith({ channelId: '101' });
  });

  it('returns live streams for a channel', async () => {
    const addon = new XtreamAddon({
      url: 'http://example.com:8080',
      username: 'user',
      password: 'pass',
      timeout: 5000,
      preferredFormat: 'm3u8',
    });
    const [stream] = await addon.getStreams(encodeChannelId('101'));
    expect(stream).toMatchObject({
      url: 'https://example.com/live/news.m3u8',
      name: 'News 24',
    });
  });
});
