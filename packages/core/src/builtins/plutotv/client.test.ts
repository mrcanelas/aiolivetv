if (!process.env.BASE_URL || process.env.BASE_URL === '/') {
  process.env.BASE_URL = 'http://127.0.0.1:3000';
}
if (!process.env.SECRET_KEY || process.env.SECRET_KEY.length < 64) {
  process.env.SECRET_KEY = '0'.repeat(64);
}

import { gzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/index.js', () => ({
  makeRequest: vi.fn(),
  makeUrlLogSafe: (url: string) => url.replace(/jwt=[^&]+/i, 'jwt=***'),
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  }),
}));

vi.mock('../../config/index.js', () => ({
  config: {
    builtins: {
      plutotv: {
        enabled: true,
        disabledReason: 'Disabled by this instance administrator',
      },
    },
  },
}));

const { makeRequest } = await import('../../utils/index.js');
const {
  assertAllowedSourceUrl,
  assertPlutoStreamUrl,
  channelIdentity,
  clearPlutoTvSourceCache,
  loadPlutoCatalog,
  parseChannelIdentity,
  resolvePlutoStreamUrlWithRetry,
} = await import('./client.js');
const { plutoTvM3uUrl, plutoTvXmltvUrl } = await import('./regions.js');

describe('pluto tv regional sources', () => {
  beforeEach(() => {
    clearPlutoTvSourceCache();
    vi.mocked(makeRequest).mockReset();
  });

  it('builds verified BR URLs', () => {
    expect(plutoTvM3uUrl('br')).toBe(
      'https://raw.githubusercontent.com/OwnerPlugins/pluto-tv-m3u/main/pluto-live-BR.m3u'
    );
    expect(plutoTvXmltvUrl('br')).toBe(
      'https://raw.githubusercontent.com/matthuisman/i.mjh.nz/master/PlutoTV/br.xml.gz'
    );
  });

  it('keeps stable identities per region', () => {
    expect(channelIdentity('BR', 'abc')).toBe('pluto:br:abc');
    expect(channelIdentity('US', 'abc')).not.toBe(channelIdentity('BR', 'abc'));
    expect(parseChannelIdentity('pluto:br:abc')).toEqual({
      region: 'br',
      originalId: 'abc',
    });
  });

  it('validates allowlisted source and stream hosts', () => {
    expect(assertAllowedSourceUrl(plutoTvM3uUrl('br')).hostname).toBe(
      'raw.githubusercontent.com'
    );
    expect(() => assertAllowedSourceUrl('https://evil.example/x.m3u')).toThrow(
      /host/
    );
    expect(
      assertPlutoStreamUrl(
        'https://cfd-v4-service-channel-stitcher-use1-1.prd.pluto.tv/v2/stitch/hls/channel/x/master.m3u8?jwt=abc'
      ).hostname
    ).toContain('pluto.tv');
    expect(() =>
      assertPlutoStreamUrl('https://cdn.example/stream.m3u8')
    ).toThrow(/host/);
  });

  it('matches m3u tvg-id to xmltv channel id exactly', async () => {
    const m3u = `#EXTM3U
#EXTINF:-1 group-title="Movies" tvg-id="5f120e94a5714d00074576a1" tvg-name="Cine" tvg-logo="https://images.pluto.tv/x.png",Cine
https://cfd-v4-service-channel-stitcher-use1-1.prd.pluto.tv/v2/stitch/hls/channel/5f120e94a5714d00074576a1/master.m3u8?jwt=token
#EXTINF:-1 group-title="News" tvg-id="deadbeef" tvg-name="NoEpg",NoEpg
https://cfd-v4-service-channel-stitcher-use1-1.prd.pluto.tv/v2/stitch/hls/channel/deadbeef/master.m3u8?jwt=token
`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE tv SYSTEM "xmltv.dtd">
<tv>
  <channel id="5f120e94a5714d00074576a1"><display-name>Cine</display-name></channel>
  <programme start="20260601120000 +0000" stop="20260601130000 +0000" channel="5f120e94a5714d00074576a1">
    <title>Show</title>
  </programme>
</tv>`;
    const xmlGz = gzipSync(Buffer.from(xml, 'utf8'));

    vi.mocked(makeRequest)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () => xmlGz,
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () => Buffer.from(m3u, 'utf8'),
      } as any);

    const { m3u: catalog } = await loadPlutoCatalog({
      region: 'br',
      timeout: 5000,
      timeShiftMinutes: 0,
    });
    expect(catalog.channels).toHaveLength(2);
    expect(catalog.byOriginalId.get('5f120e94a5714d00074576a1')?.hasEpg).toBe(
      true
    );
    expect(catalog.byOriginalId.get('deadbeef')?.hasEpg).toBe(false);
  });

  it('keeps last good m3u when refresh fails', async () => {
    const m3u = `#EXTM3U
#EXTINF:-1 tvg-id="abc" tvg-name="A",A
https://cfd-v4-service-channel-stitcher-use1-1.prd.pluto.tv/v2/stitch/hls/channel/abc/master.m3u8?jwt=token
`;
    const xml = `<?xml version="1.0"?><tv><channel id="abc"><display-name>A</display-name></channel></tv>`;
    const xmlGz = gzipSync(Buffer.from(xml, 'utf8'));

    vi.mocked(makeRequest)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () => xmlGz,
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () => Buffer.from(m3u, 'utf8'),
      } as any);

    const first = await loadPlutoCatalog({
      region: 'br',
      timeout: 5000,
      timeShiftMinutes: 0,
    });
    expect(first.m3u.channels).toHaveLength(1);

    vi.mocked(makeRequest)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () => xmlGz,
      } as any)
      .mockRejectedValueOnce(new Error('network down'));

    const second = await loadPlutoCatalog(
      { region: 'br', timeout: 5000, timeShiftMinutes: 0 },
      { force: true }
    );
    expect(second.m3u.channels).toHaveLength(1);
    expect(second.m3u.channels[0]?.originalId).toBe('abc');
  });

  it('keeps channels and playback available when XMLTV fails', async () => {
    const m3u =
      '#EXTM3U\n#EXTINF:-1 tvg-id="abc",A\nhttps://service.pluto.tv/live.m3u8';
    vi.mocked(makeRequest).mockImplementation(async (url) => {
      if (url.endsWith('.gz')) throw new Error('Guide unavailable');
      return new Response(m3u) as any;
    });
    const config = {
      region: 'br' as const,
      timeout: 5000,
      timeShiftMinutes: 0,
    };
    const catalog = await loadPlutoCatalog(config);
    expect(catalog.m3u.channels).toHaveLength(1);
    expect(catalog.xmltv.data.programs).toEqual([]);
    expect(catalog.m3u.channels[0].hasEpg).toBe(false);
    expect((await resolvePlutoStreamUrlWithRetry(config, 'abc')).url).toBe(
      'https://service.pluto.tv/live.m3u8'
    );
  });

  it('reads XMLTV already decompressed by the HTTP client', async () => {
    vi.mocked(makeRequest).mockImplementation(
      async (url) =>
        new Response(
          url.endsWith('.gz')
            ? '<tv><channel id="abc"><display-name>A</display-name></channel></tv>'
            : '#EXTM3U\n#EXTINF:-1 tvg-id="abc",A\nhttps://service.pluto.tv/live.m3u8'
        ) as any
    );
    const catalog = await loadPlutoCatalog({
      region: 'br',
      timeout: 5000,
      timeShiftMinutes: 0,
    });
    expect(catalog.xmltv.data.channels).toHaveLength(1);
    expect(catalog.m3u.channels[0].hasEpg).toBe(false);
  });

  it('refreshes the playlist once when a channel is absent from cache', async () => {
    let playlistRequests = 0;
    const jwt = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.signature`;
    vi.mocked(makeRequest).mockImplementation(async (url) => {
      if (url.endsWith('.gz')) return new Response('<tv />') as any;
      playlistRequests++;
      return new Response(
        `#EXTM3U\n#EXTINF:-1 tvg-id="${playlistRequests === 1 ? 'old' : 'new'}",A\nhttps://service.pluto.tv/live.m3u8?jwt=${jwt}`
      ) as any;
    });
    const config = {
      region: 'br' as const,
      timeout: 5000,
      timeShiftMinutes: 0,
    };
    await loadPlutoCatalog(config);
    expect((await resolvePlutoStreamUrlWithRetry(config, 'new')).url).toContain(
      'pluto.tv'
    );
    expect(playlistRequests).toBe(2);
  });

  it('rejects oversized sources before reading their bodies', async () => {
    const response = new Response('ignored', {
      headers: { 'content-length': String(51 * 1024 * 1024) },
    });
    vi.mocked(makeRequest).mockResolvedValue(response as any);
    await expect(
      loadPlutoCatalog({ region: 'br', timeout: 5000, timeShiftMinutes: 0 })
    ).rejects.toThrow('maximum size');
  });
});
