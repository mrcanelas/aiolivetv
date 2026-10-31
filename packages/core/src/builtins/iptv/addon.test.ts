import { gzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/index.js', () => ({
  fromUrlSafeBase64: (value: string) =>
    Buffer.from(value, 'base64url').toString(),
  toUrlSafeBase64: (value: string) => Buffer.from(value).toString('base64url'),
  makeRequest: vi.fn(),
}));
vi.mock('../../streams/web-readiness.js', () => ({
  resolveNotWebReady: vi.fn().mockResolvedValue(false),
}));

const { makeRequest } = await import('../../utils/index.js');
const { IptvOrgAddon, IptvEpgAddon } = await import('./addon.js');
const { iptvOrgSourceUrl, iptvEpgSourceUrl } = await import('./config.js');
const { clearM3uSourceCache } = await import('../m3u-reader/addon.js');
const { XmltvAddon, clearXmltvSourceCache } =
  await import('../xmltv-reader/addon.js');
const { encodeChannelId } = await import('../live-tv/shared.js');
const { getChannelMatchConfidence, isHighConfidenceChannelMatch } =
  await import('../../main/channelMappings.js');

const programme = (
  title: string,
  start = '20261031120000',
  stop = '20261031130000'
) =>
  `<programme channel="BBCOne.uk" start="${start} +0000" stop="${stop} +0000"><title>${title}</title><desc>Details</desc><icon src="https://example.com/show.jpg"/></programme>`;
const guide = `<tv><channel id="BBCOne.uk"><display-name>UK - BBC One</display-name><icon src="https://example.com/bbc.png"/></channel>${programme('News')}${programme('No Data')}${programme('No Game Today')}${programme('No EVENT Today')}${programme('Bad interval', '20261031120000', '20261031110000')}</tv>`;
function respond(body: string | Buffer) {
  vi.mocked(makeRequest).mockResolvedValue(
    new Response(body) as Awaited<ReturnType<typeof makeRequest>>
  );
}

beforeEach(() => {
  clearM3uSourceCache();
  clearXmltvSourceCache();
  vi.mocked(makeRequest).mockReset();
});

describe('IPTV country sources', () => {
  it('maps UK/GB explicitly and rejects unknown countries before requesting a URL', () => {
    expect(iptvOrgSourceUrl('GB')).toBe(
      'https://iptv-org.github.io/iptv/countries/uk.m3u'
    );
    expect(iptvEpgSourceUrl('UK')).toBe(
      'https://iptv-epg.org/files/epg-gb.xml.gz'
    );
    expect(
      () => new IptvOrgAddon({ country: '../us', timeout: 1000 })
    ).toThrow();
    expect(() => new IptvEpgAddon({ country: 'xx', timeout: 1000 })).toThrow();
    expect(makeRequest).not.toHaveBeenCalled();
  });

  it('keeps stream alternatives and feed playback IDs, and only maps generic feeds to a base TVG ID', async () => {
    respond(`#EXTM3U
#EXTINF:-1 tvg-id="BBCOne.uk@HD",BBC One (1080p) [Geo-blocked]
https://example.com/first.m3u8
#EXTINF:-1 tvg-id="BBCOne.uk@HD",BBC One (720p)
https://example.com/second.m3u8
#EXTINF:-1 tvg-id="BBCOne.uk@West",BBC One (360p)
https://example.com/west.m3u8`);
    const addon = new IptvOrgAddon({ country: 'gb', timeout: 1000 });
    const catalog = await addon.getCatalog();
    expect(catalog).toHaveLength(2);
    const hd = catalog.find(
      (item) => item.id === encodeChannelId('BBCOne.uk@HD')
    )!;
    const west = catalog.find(
      (item) => item.id === encodeChannelId('BBCOne.uk@West')
    )!;
    expect(hd).toMatchObject({
      name: 'BBC One',
      tvgId: 'bbcone.uk',
      country: 'GB',
    });
    expect(west).toMatchObject({
      name: 'BBC One (west)',
      tvgId: 'bbcone.uk@west',
    });
    const canonical = {
      id: encodeChannelId('BBCOne.uk'),
      name: 'BBC One',
      tvgId: 'BBCOne.uk',
      country: 'GB',
    };
    expect(
      getChannelMatchConfidence(
        { id: hd.id, name: hd.name!, tvgId: String(hd.tvgId), country: 'GB' },
        canonical
      )
    ).toBe(1);
    expect(
      isHighConfidenceChannelMatch(
        getChannelMatchConfidence(
          {
            id: west.id,
            name: west.name!,
            tvgId: String(west.tvgId),
            country: 'GB',
          },
          canonical
        )
      )
    ).toBe(false);
    expect(await addon.getStreams(hd.id)).toEqual([
      expect.objectContaining({ url: 'https://example.com/first.m3u8' }),
      expect.objectContaining({ url: 'https://example.com/second.m3u8' }),
    ]);
    expect(await addon.getStreams(west.id)).toEqual([
      expect.objectContaining({ url: 'https://example.com/west.m3u8' }),
    ]);
    expect((await addon.getManifest()).behaviorHints?.epgProvider).not.toBe(
      true
    );
    expect(makeRequest).toHaveBeenCalledTimes(1);
  });

  it('serves real schedule metadata, filters placeholders and isolates normalization from generic XMLTV', async () => {
    // Return a fresh response for each distinct reader cache.
    vi.mocked(makeRequest).mockImplementation(
      async () =>
        new Response(gzipSync(guide)) as Awaited<ReturnType<typeof makeRequest>>
    );
    const addon = new IptvEpgAddon({
      country: 'uk',
      timeout: 1000,
      timeShiftMinutes: 60,
    });
    const manifest = await addon.getManifest();
    expect(manifest).toMatchObject({
      id: 'org.aiolivetv.iptv-epg',
      behaviorHints: { epgProvider: true },
    });
    expect(
      manifest.resources.some(
        (r) => (typeof r === 'string' ? r : r.name) === 'stream'
      )
    ).toBe(false);
    expect(await addon.getCatalog()).toEqual([
      expect.objectContaining({
        name: 'BBC One',
        tvgId: 'BBCOne.uk',
        country: 'GB',
      }),
    ]);
    const response = await addon.getCatalogResponse(0, '2026-10-31');
    expect(response.metasDetailed?.[0].videos).toHaveLength(1);
    expect(response.metasDetailed?.[0].videos?.[0]).toMatchObject({
      title: 'News',
      overview: 'Details',
      thumbnail: 'https://example.com/show.jpg',
      startTime: '2026-10-31T13:00:00.000Z',
    });
    expect(makeRequest).toHaveBeenCalledTimes(1);
    const generic = new XmltvAddon({
      sourceUrl: iptvEpgSourceUrl('gb'),
      timeout: 1000,
    });
    expect((await generic.getCatalog())[0].name).toBe('UK - BBC One');
    expect(
      (await generic.getCatalogGuide(0, '2026-10-31'))[0].videos
    ).toHaveLength(4);
    clearXmltvSourceCache(iptvEpgSourceUrl('gb'));
    await addon.getCatalog();
    expect(makeRequest).toHaveBeenCalledTimes(3);
  });

  it('does not advertise native EPG when a guide contains only placeholders', async () => {
    respond(guide.replace(programme('News'), ''));
    expect(
      (await new IptvEpgAddon({ country: 'gb', timeout: 1000 }).getManifest())
        .behaviorHints?.epgProvider
    ).not.toBe(true);
  });

  it('preserves the playback headers required by IPTV-org streams', async () => {
    respond(`#EXTM3U
#EXTINF:-1 tvg-id="Foodxp.uk@SD" http-referrer="https://example.com/",Foodxp
#EXTVLCOPT:http-user-agent=ExamplePlayer/1.0
https://example.com/live.m3u8`);
    const addon = new IptvOrgAddon({ country: 'uk', timeout: 1000 });
    expect(await addon.getStreams(encodeChannelId('Foodxp.uk@SD'))).toEqual([
      expect.objectContaining({
        behaviorHints: {
          proxyHeaders: {
            request: {
              Referer: 'https://example.com/',
              'User-Agent': 'ExamplePlayer/1.0',
            },
          },
        },
      }),
    ]);
  });

  it('enforces the decompressed size limit on gzipped guides', async () => {
    respond(gzipSync(guide));
    await expect(
      new IptvEpgAddon({
        country: 'gb',
        timeout: 1000,
        maxBytes: 400,
      }).getCatalog()
    ).rejects.toThrow(/maximum size/);
  });
});
