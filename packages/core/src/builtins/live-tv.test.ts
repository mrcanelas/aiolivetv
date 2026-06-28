import { describe, expect, it, vi } from 'vitest';
import type { UserData } from '../db/index.js';

vi.mock('../utils/index.js', () => ({
  Cache: { getInstance: () => ({ get: vi.fn(), set: vi.fn() }) },
  fromUrlSafeBase64: (value: string) =>
    Buffer.from(value, 'base64url').toString(),
  makeRequest: vi.fn(),
  toUrlSafeBase64: (value: string) => Buffer.from(value).toString('base64url'),
}));

const { encodeChannelId, M3uAddon, parseM3u, parseXmltv, XmltvAddon } =
  await import('./live-tv.js');
const {
  getChannelMapping,
  getChannelMatchConfidence,
  isChannelAddonEnabled,
  isHighConfidenceChannelMatch,
} = await import('../main/channelMappings.js');
const { makeRequest } = await import('../utils/index.js');

describe('live TV sources', () => {
  it('uses the same channel ID for XMLTV and M3U identifiers', async () => {
    const [channel] = await parseXmltv(
      '<tv><channel id="BBC.ONE"><display-name>BBC One</display-name></channel></tv>'
    );
    const [stream] = parseM3u(
      '#EXTM3U\n#EXTINF:-1 tvg-id="bbc.one" tvg-name="BBC One" group-title="News, UK",BBC One\nhttps://example.com/live.m3u8'
    );

    expect(channel.name).toBe('BBC One');
    expect(stream.group).toBe('News, UK');
    expect(encodeChannelId(channel.id)).toBe(encodeChannelId(stream.channelId));
  });

  it('returns XMLTV programs only from channel meta', async () => {
    vi.mocked(makeRequest).mockResolvedValueOnce({
      ok: true,
      text: async () =>
        '<tv><channel id="bbc.one"><display-name>BBC One</display-name></channel><programme channel="bbc.one" start="20260628120000 +0000" stop="20260628130000 +0000"><title>News</title></programme></tv>',
    } as unknown as Awaited<ReturnType<typeof makeRequest>>);
    const addon = new XmltvAddon({
      sourceUrl: 'https://example.com/guide.xml',
      timeout: 1000,
    });

    expect(addon.getManifest().behaviorHints?.epgProvider).toBe(true);
    expect(await addon.getCatalog()).toHaveLength(1);
    vi.mocked(makeRequest).mockResolvedValueOnce({
      ok: true,
      text: async () =>
        '<tv><channel id="bbc.one"><display-name>BBC One</display-name></channel><programme channel="bbc.one" start="20260628120000 +0000" stop="20260628130000 +0000"><title>News</title></programme></tv>',
    } as unknown as Awaited<ReturnType<typeof makeRequest>>);
    const meta = await addon.getMeta(encodeChannelId('bbc.one'));
    expect(meta.videos?.[0]).toMatchObject({
      title: 'News',
      startTime: '2026-06-28T12:00:00.000Z',
      endTime: '2026-06-28T13:00:00.000Z',
    });
  });

  it('uses an M3U as catalog and channel metadata without program videos', async () => {
    vi.mocked(makeRequest).mockResolvedValue({
      ok: true,
      text: async () =>
        '#EXTM3U\n#EXTINF:-1 tvg-name="BBC One",BBC One\nhttps://example.com/live.m3u8',
    } as unknown as Awaited<ReturnType<typeof makeRequest>>);
    const addon = new M3uAddon({
      sourceUrl: 'https://example.com/list.m3u',
      timeout: 1000,
    });
    expect(addon.getManifest().behaviorHints?.epgProvider).toBeUndefined();
    expect(addon.getManifest()).toMatchObject({
      resources: [{ name: 'catalog' }, { name: 'meta' }, { name: 'stream' }],
    });
    const [channel] = await addon.getCatalog();
    const meta = await addon.getMeta(channel.id);

    expect(channel.name).toBe('BBC One');
    expect(meta.name).toBe('BBC One');
    expect(meta.videos).toBeUndefined();
  });
});

describe('channel mappings', () => {
  const userData = {
    channelMappings: [
      {
        id: 'channel-1',
        enabled: false,
        streams: [{ addonId: 'm3u-1', enabled: false }],
      },
    ],
  } as UserData;

  it('defaults unknown mappings to enabled and preserves explicit disables', () => {
    expect(getChannelMapping(userData, 'channel-1')?.enabled).toBe(false);
    expect(isChannelAddonEnabled(userData, 'channel-1', 'm3u-1')).toBe(false);
    expect(isChannelAddonEnabled(userData, 'channel-1', 'm3u-2')).toBe(true);
  });

  it('automatically matches only high-confidence channel metadata', () => {
    const confidence = getChannelMatchConfidence(
      { id: 'one', name: 'RTP 1', country: 'PT' },
      { id: 'two', name: 'RTP-1', country: 'PT' }
    );
    expect(confidence).toBe(0.93);
    expect(isHighConfidenceChannelMatch(confidence)).toBe(true);
    expect(
      isHighConfidenceChannelMatch(
        getChannelMatchConfidence(
          { id: 'one', name: 'News', aliases: ['World News'] },
          { id: 'two', name: 'World News' }
        )
      )
    ).toBe(false);
  });
});
