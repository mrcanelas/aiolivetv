import { describe, expect, it, vi } from 'vitest';
import type { UserData } from '../db/index.js';

vi.mock('../utils/index.js', () => ({
  Cache: { getInstance: () => ({ get: vi.fn(), set: vi.fn() }) },
  fromUrlSafeBase64: (value: string) =>
    Buffer.from(value, 'base64url').toString(),
  makeRequest: vi.fn(),
  toUrlSafeBase64: (value: string) => Buffer.from(value).toString('base64url'),
}));

const { encodeChannelId, parseM3u, parseXmltv } = await import('./live-tv.js');
const { getChannelMapping, isChannelAddonEnabled } =
  await import('../main/channelMappings.js');

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
});
