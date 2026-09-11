/**
 * Live TV end-to-end validation script.
 * Run from repo root: pnpm validate:live-tv
 */
import { createServer, type Server } from 'node:http';

process.env.HTTP_ALLOW_PRIVATE_URLS ??= 'true';

type CoreModule = typeof import('../packages/core/dist/index.js');
type UserData = import('../packages/core/dist/index.js').UserData;

function xmltvTimestamp(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())} +0000`;
}

const EPG_START = new Date();
EPG_START.setUTCHours(12, 0, 0, 0);
const EPG_STOP = new Date(EPG_START.getTime() + 60 * 60 * 1000);
const EPG_START_ISO = EPG_START.toISOString();

const XMLTV_FIXTURE = `<tv>
  <channel id="bbc.one"><display-name>BBC One</display-name></channel>
  <channel id="rtp1"><display-name>RTP 1</display-name></channel>
  <programme channel="bbc.one" start="${xmltvTimestamp(EPG_START)}" stop="${xmltvTimestamp(EPG_STOP)}">
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
    mergedCatalogId: string;
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

  const catalog = liveTvCatalog(aio, constants.TV_TYPE, deps.mergedCatalogId);
  const channels = (await aio.getCatalog(constants.TV_TYPE, catalog.id)).data;
  assert(
    channels.map((item) => item.name).sort().join(',') === 'BBC One,RTP 1',
    `unexpected merged catalog: ${channels.map((item) => item.name).join(', ')}`
  );

  const bbcXmltv = channels.find((item) => item.name === 'BBC One');
  assert(bbcXmltv, `missing BBC One in merged catalog: ${channels.map((c) => c.name).join(', ')}`);
  const bbcId = bbcXmltv.id;

  const epgMeta = (await aio.getMeta(constants.TV_TYPE, bbcId)).data;
  assert(epgMeta?.videos?.[0]?.title === 'News', 'expected EPG program in meta');
  assert(
    epgMeta?.videos?.[0]?.startTime === EPG_START_ISO,
    'unexpected EPG start time'
  );

  const streams = (await aio.getStreams(bbcId, constants.TV_TYPE)).data?.streams ?? [];
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
    mergedCatalogId: string;
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

  const catalog = liveTvCatalog(aio, constants.TV_TYPE, deps.mergedCatalogId);
  const channels = (await aio.getCatalog(constants.TV_TYPE, catalog.id)).data;
  assert(channels.length === 2, 'expected two M3U channels');

  const bbcId = channels.find((item) => item.name === 'BBC One')!.id;
  const meta = (await aio.getMeta(constants.TV_TYPE, bbcId)).data;
  assert(meta?.name === 'BBC One', 'expected M3U channel meta');
  assert(meta?.videos === undefined, 'M3U-only meta must not include EPG videos');

  const streams = (await aio.getStreams(bbcId, constants.TV_TYPE)).data?.streams ?? [];
  assert(streams.length >= 1, 'expected stream for M3U channel');

  console.log('  [ok] sem EPG: catalog, meta e stream apenas via M3U');
}

function liveTvCatalog(
  aio: InstanceType<CoreModule['AIOStreams']>,
  tvType: string,
  mergedCatalogId: string
) {
  const catalogs = aio
    .getCatalogs()
    .filter((catalog) => catalog.type === tvType);
  const catalog =
    catalogs.find((item) => item.id === mergedCatalogId) ?? catalogs[0];
  assert(
    catalog,
    `missing live TV catalog, got ${aio
      .getCatalogs()
      .map((item) => `${item.type}:${item.id}`)
      .join(', ')}`
  );
  return catalog;
}

function addonInstanceId(
  aio: InstanceType<CoreModule['AIOStreams']>,
  presetInstanceId: string
) {
  const addon = aio
    .getAddons()
    .find((item) => item.instanceId?.startsWith(presetInstanceId));
  assert(
    addon?.instanceId,
    `missing addon for preset ${presetInstanceId}: ${aio
      .getAddons()
      .map((item) => item.instanceId)
      .join(', ')}`
  );
  return addon.instanceId;
}

async function validateChannelMappings(
  sourceBase: string,
  deps: {
    AIOStreams: CoreModule['AIOStreams'];
    constants: typeof import('../packages/core/dist/index.js').constants;
    mergedCatalogId: string;
  }
) {
  const { AIOStreams, constants } = deps;
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
  const catalog = liveTvCatalog(
    preview,
    constants.TV_TYPE,
    deps.mergedCatalogId
  );
  const m3uChannels = (await preview.getCatalog(constants.TV_TYPE, catalog.id))
    .data;
  const rtp = m3uChannels.find(
    (item) => item.name === 'RTP-1' || item.name === 'RTP 1'
  );
  const bbc = m3uChannels.find((item) => item.name === 'BBC One');
  assert(rtp, `missing RTP in merged catalog: ${m3uChannels.map((item) => item.name).join(', ')}`);
  assert(bbc, `missing BBC One in merged catalog: ${m3uChannels.map((item) => item.name).join(', ')}`);
  const rtpId = rtp.id;
  const bbcId = bbc.id;

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
  const disabledStreams = (await aio.getStreams(rtpId, constants.TV_TYPE)).data?.streams;
  assert(
    (disabledStreams?.length ?? 0) === 0,
    'disabled channel must not return streams'
  );

  const visible = (
    await aio.getCatalog(
      constants.TV_TYPE,
      liveTvCatalog(aio, constants.TV_TYPE, deps.mergedCatalogId).id
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
      mergedCatalogId: core.LIVE_TV_MERGED_CATALOG_ID,
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
