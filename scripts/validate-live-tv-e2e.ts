/**
 * Live TV end-to-end validation script.
 * Run from repo root: pnpm validate:live-tv
 */
import { createServer, type Server } from 'node:http';

type CoreModule = typeof import('../packages/core/dist/index.js');
type UserData = import('../packages/core/dist/index.js').UserData;

const XMLTV_FIXTURE = `<tv>
  <channel id="bbc.one"><display-name>BBC One</display-name></channel>
  <channel id="rtp1"><display-name>RTP 1</display-name></channel>
  <programme channel="bbc.one" start="20260628120000 +0000" stop="20260628130000 +0000">
    <title>News</title><desc>Latest news</desc>
  </programme>
</tv>`;

const M3U_FIXTURE = `#EXTM3U
#EXTINF:-1 tvg-id="bbc.one" tvg-name="BBC One",BBC One
https://example.com/bbc.m3u8
#EXTINF:-1 tvg-id="rtp-1" tvg-name="RTP-1",RTP-1
https://example.com/rtp.m3u8`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function liveTvUserData(
  presets: UserData['presets'],
  channelMappings?: UserData['channelMappings']
): UserData {
  return {
    uuid: '00000000-0000-4000-8000-000000000001',
    encryptedPassword: 'test-password',
    presets,
    formatter: { id: 'standard' },
    sortCriteria: { global: [{ key: 'name', direction: 'asc' }] },
    channelMappings,
  };
}

const xmltvPreset = {
  type: 'xmltv',
  instanceId: 'xmltv-1',
  enabled: true,
  options: {
    name: 'Guide',
    sourceUrl: '',
    timeout: 5000,
    resources: ['catalog', 'meta'],
  },
} as const;

const m3uPreset = {
  type: 'm3u',
  instanceId: 'm3u-1',
  enabled: true,
  options: {
    name: 'Playlist',
    sourceUrl: '',
    timeout: 5000,
    resources: ['catalog', 'meta', 'stream'],
  },
} as const;

async function startFixtureServer(): Promise<{
  server: Server;
  sourceBase: string;
}> {
  const server = createServer((req, res) => {
    if (req.url === '/guide.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(XMLTV_FIXTURE);
      return;
    }
    if (req.url === '/list.m3u') {
      res.writeHead(200, { 'content-type': 'audio/x-mpegurl' });
      res.end(M3U_FIXTURE);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve())
  );
  const address = server.address();
  assert(address && typeof address === 'object', 'fixture server failed to bind');
  return { server, sourceBase: `http://127.0.0.1:${address.port}` };
}

function createBuiltinHandler(core: CoreModule) {
  const { fromUrlSafeBase64, M3uAddon, XmltvAddon } = core;
  return async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const manifest = url.pathname.match(
        /^\/builtins\/live-tv\/(xmltv|m3u)\/([^/]+)\/manifest\.json$/
      );
      if (manifest) {
        const [, source, encoded] = manifest;
        const config = JSON.parse(fromUrlSafeBase64(encoded));
        const addon =
          source === 'xmltv' ? new XmltvAddon(config) : new M3uAddon(config);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(addon.getManifest()));
        return;
      }

      const catalog = url.pathname.match(
        /^\/builtins\/live-tv\/(xmltv|m3u)\/([^/]+)\/catalog\/([^/]+)\/([^/]+)(?:\/([^/]+))?\.json$/
      );
      if (catalog) {
        const [, source, encoded, , , extras] = catalog;
        const config = JSON.parse(fromUrlSafeBase64(encoded));
        const skip = Math.max(
          0,
          Number.parseInt(
            new URLSearchParams(extras ?? '').get('skip') ?? '0',
            10
          ) || 0
        );
        const addon =
          source === 'xmltv' ? new XmltvAddon(config) : new M3uAddon(config);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ metas: await addon.getCatalog(skip) }));
        return;
      }

      const meta = url.pathname.match(
        /^\/builtins\/live-tv\/(xmltv|m3u)\/([^/]+)\/meta\/([^/]+)\/([^/]+)\.json$/
      );
      if (meta) {
        const [, source, encoded, , channelIdRaw] = meta;
        const channelId = decodeURIComponent(channelIdRaw);
        const config = JSON.parse(fromUrlSafeBase64(encoded));
        const addon =
          source === 'xmltv' ? new XmltvAddon(config) : new M3uAddon(config);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ meta: await addon.getMeta(channelId) }));
        return;
      }

      const stream = url.pathname.match(
        /^\/builtins\/live-tv\/m3u\/([^/]+)\/stream\/([^/]+)\/([^/]+)\.json$/
      );
      if (stream) {
        const [, encoded, , channelIdRaw] = stream;
        const channelId = decodeURIComponent(channelIdRaw);
        const config = JSON.parse(fromUrlSafeBase64(encoded));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            streams: await new M3uAddon(config).getStreams(channelId),
          })
        );
        return;
      }

      res.writeHead(404);
      res.end('not found');
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end(error instanceof Error ? error.message : String(error));
      } else {
        console.error('builtin handler error:', req.url, error);
      }
    }
  };
}

async function reservePort(): Promise<{ server: Server; base: string }> {
  const server = createServer();
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve())
  );
  const address = server.address();
  assert(address && typeof address === 'object', 'failed to reserve port');
  return { server, base: `http://127.0.0.1:${address.port}` };
}

async function validateWithEpg(
  sourceBase: string,
  deps: {
    AIOStreams: (typeof import('../packages/core/dist/index.js'))['AIOStreams'];
    constants: typeof import('../packages/core/dist/index.js').constants;
    getChannelMatchConfidence: (typeof import('../packages/core/dist/index.js'))['getChannelMatchConfidence'];
    isHighConfidenceChannelMatch: (typeof import('../packages/core/dist/index.js'))['isHighConfidenceChannelMatch'];
  }
) {
  const { AIOStreams, constants, getChannelMatchConfidence, isHighConfidenceChannelMatch } =
    deps;
  const userData = liveTvUserData([
    {
      ...xmltvPreset,
      options: {
        ...xmltvPreset.options,
        sourceUrl: `${sourceBase}/guide.xml`,
      },
    },
    {
      ...m3uPreset,
      options: {
        ...m3uPreset.options,
        sourceUrl: `${sourceBase}/list.m3u`,
      },
    },
  ]);

  const aio = await new AIOStreams(userData).initialise();
  assert(aio.hasEpgProvider(), 'expected epgProvider with XMLTV enabled');

  const catalogs = aio
    .getCatalogs()
    .filter((catalog) => catalog.type === constants.CHANNEL_TYPE);
  assert(catalogs.length === 2, `expected 2 channel catalogs, got ${catalogs.length}: ${catalogs.map((c) => c.id).join(', ')}`);

  const xmltvCatalog = catalogs.find((catalog) =>
    catalog.id.startsWith('xmltv-1')
  );
  const m3uCatalog = catalogs.find((catalog) => catalog.id.startsWith('m3u-1'));
  assert(xmltvCatalog, `missing XMLTV catalog in ${catalogs.map((c) => c.id).join(', ')}`);
  assert(m3uCatalog, `missing M3U catalog in ${catalogs.map((c) => c.id).join(', ')}`);

  const xmltvChannels = (await aio.getCatalog('channel', xmltvCatalog.id)).data;
  const m3uChannels = (await aio.getCatalog('channel', m3uCatalog.id)).data;
  assert(
    xmltvChannels.map((item) => item.name).join(',') === 'BBC One,RTP 1',
    'unexpected XMLTV catalog'
  );
  assert(
    m3uChannels.map((item) => item.name).join(',') === 'BBC One,RTP-1',
    'unexpected M3U catalog'
  );

  const bbcXmltv = xmltvChannels.find((item) => item.name === 'BBC One');
  const bbcM3u = m3uChannels.find((item) => item.name === 'BBC One');
  assert(bbcXmltv, `missing BBC One in XMLTV catalog: ${xmltvChannels.map((c) => c.name).join(', ')}`);
  assert(bbcM3u, `missing BBC One in M3U catalog: ${m3uChannels.map((c) => c.name).join(', ')}`);
  const bbcId = bbcXmltv.id;
  const m3uBbcId = bbcM3u.id;
  assert(bbcId === m3uBbcId, 'XMLTV and M3U must expose the same encoded channel id');

  const epgMeta = (await aio.getMeta('channel', bbcId)).data;
  assert(epgMeta?.videos?.[0]?.title === 'News', 'expected EPG program in meta');
  assert(
    epgMeta?.videos?.[0]?.startTime === '2026-06-28T12:00:00.000Z',
    'unexpected EPG start time'
  );

  const streams = (await aio.getStreams(bbcId, 'channel')).data?.streams ?? [];
  assert(
    streams.some((stream) => stream.url === 'https://example.com/bbc.m3u8'),
    'expected M3U stream for BBC One'
  );

  const lowConfidence = getChannelMatchConfidence(
    { id: 'one', name: 'BBC One', country: 'UK' },
    { id: 'two', name: 'CNN International', country: 'US' }
  );
  assert(
    !isHighConfidenceChannelMatch(lowConfidence),
    'unrelated channels should not auto-match'
  );

  console.log('  [ok] com EPG: manifest, catalog, meta, stream');
}

async function validateWithoutEpg(
  sourceBase: string,
  deps: {
    AIOStreams: (typeof import('../packages/core/dist/index.js'))['AIOStreams'];
    constants: typeof import('../packages/core/dist/index.js').constants;
  }
) {
  const { AIOStreams, constants } = deps;
  const userData = liveTvUserData([
    {
      ...m3uPreset,
      options: {
        ...m3uPreset.options,
        sourceUrl: `${sourceBase}/list.m3u`,
      },
    },
  ]);

  const aio = await new AIOStreams(userData).initialise();
  assert(!aio.hasEpgProvider(), 'M3U-only config must not expose epgProvider');

  const catalogs = aio
    .getCatalogs()
    .filter((catalog) => catalog.type === constants.CHANNEL_TYPE);
  assert(catalogs.length === 1, 'expected a single M3U channel catalog');

  const channels = (await aio.getCatalog('channel', catalogs[0]!.id)).data;
  assert(channels.length === 2, 'expected two M3U channels');

  const bbcId = channels.find((item) => item.name === 'BBC One')!.id;
  const meta = (await aio.getMeta('channel', bbcId)).data;
  assert(meta?.name === 'BBC One', 'expected M3U channel meta');
  assert(meta?.videos === undefined, 'M3U-only meta must not include EPG videos');

  const streams = (await aio.getStreams(bbcId, 'channel')).data?.streams ?? [];
  assert(streams.length >= 1, 'expected stream for M3U channel');

  console.log('  [ok] sem EPG: catalog, meta e stream apenas via M3U');
}

function addonInstanceId(
  aio: InstanceType<CoreModule['AIOStreams']>,
  presetInstanceId: string
) {
  const catalog = aio
    .getCatalogs()
    .find((item) => item.id.startsWith(presetInstanceId));
  assert(catalog, `missing catalog for preset ${presetInstanceId}`);
  return catalog.id.split('.', 1)[0];
}

async function validateChannelMappings(
  sourceBase: string,
  deps: {
    AIOStreams: CoreModule['AIOStreams'];
  }
) {
  const { AIOStreams } = deps;
  const preview = await new AIOStreams(
    liveTvUserData([
      {
        ...xmltvPreset,
        options: {
          ...xmltvPreset.options,
          sourceUrl: `${sourceBase}/guide.xml`,
        },
      },
      {
        ...m3uPreset,
        options: {
          ...m3uPreset.options,
          sourceUrl: `${sourceBase}/list.m3u`,
        },
      },
    ])
  ).initialise();
  const xmltvId = addonInstanceId(preview, 'xmltv-1');
  const m3uId = addonInstanceId(preview, 'm3u-1');
  const m3uCatalogId = preview
    .getCatalogs()
    .find((catalog) => catalog.id.startsWith('m3u-1'))!.id;
  const m3uChannels = (await preview.getCatalog('channel', m3uCatalogId)).data;
  const rtpId = m3uChannels.find((item) => item.name === 'RTP-1')!.id;
  const bbcId = m3uChannels.find((item) => item.name === 'BBC One')!.id;

  const userData = liveTvUserData(
    [
      {
        ...xmltvPreset,
        options: {
          ...xmltvPreset.options,
          sourceUrl: `${sourceBase}/guide.xml`,
        },
      },
      {
        ...m3uPreset,
        options: {
          ...m3uPreset.options,
          sourceUrl: `${sourceBase}/list.m3u`,
        },
      },
    ],
    [
      {
        id: bbcId,
        canonicalAddonId: xmltvId,
        enabled: true,
        streams: [{ addonId: m3uId, channelId: bbcId, enabled: true }],
      },
      {
        id: rtpId,
        canonicalAddonId: m3uId,
        enabled: false,
        streams: [{ addonId: m3uId, channelId: rtpId, enabled: true }],
      },
    ]
  );

  const aio = await new AIOStreams(userData).initialise();
  const disabledStreams = (await aio.getStreams(rtpId, 'channel')).data?.streams;
  assert(
    (disabledStreams?.length ?? 0) === 0,
    'disabled channel must not return streams'
  );

  const visible = (
    await aio.getCatalog(
      'channel',
      aio.getCatalogs().find((catalog) => catalog.id.startsWith('m3u-1'))!.id
    )
  ).data;
  assert(
    !visible.some((item) => item.id === rtpId),
    'disabled mapped channel must be hidden from catalog'
  );

  console.log('  [ok] channelMappings: disable canal e filtro de catalog');
}

async function main() {
  console.log('Validando Live TV E2E...');
  const { server: fixtureServer, sourceBase } = await startFixtureServer();
  const { server: builtinServer, base: internalBase } = await reservePort();
  process.env.INTERNAL_URL = internalBase;
  process.env.BASE_URL = internalBase;

  try {
    const core = await import('../packages/core/dist/index.js');
    builtinServer.removeAllListeners('request');
    builtinServer.on('request', createBuiltinHandler(core));
    await core.initDb(process.env.DATABASE_URI!);
    await core.initialiseConfig();

    const deps = {
      AIOStreams: core.AIOStreams,
      constants: core.constants,
      getChannelMatchConfidence: core.getChannelMatchConfidence,
      isHighConfidenceChannelMatch: core.isHighConfidenceChannelMatch,
    };

    await validateWithEpg(sourceBase, deps);
    await validateWithoutEpg(sourceBase, deps);
    await validateChannelMappings(sourceBase, deps);
    console.log('Live TV E2E: todos os checks passaram.');
  } finally {
    await Promise.all([
      new Promise<void>((resolve, reject) =>
        fixtureServer.close((error) => (error ? reject(error) : resolve()))
      ),
      new Promise<void>((resolve, reject) =>
        builtinServer.close((error) => (error ? reject(error) : resolve()))
      ),
    ]);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error('Live TV E2E falhou:', error);
  process.exit(1);
});
