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

// Keep the fixture current even when validation crosses an hour boundary.
const EPG_START = new Date(Date.now() - 30 * 60 * 1000);
EPG_START.setUTCMilliseconds(0);
const EPG_STOP = new Date(EPG_START.getTime() + 2 * 60 * 60 * 1000);
const EPG_START_ISO = EPG_START.toISOString();

const sportsLeague = 'International Test Cup';
const sportsApiKey = 'sports-fixture-key';
const sportsEvent = {
  idEvent: '90001',
  strSport: 'Soccer',
  strEvent: 'Zulu FC vs Club A',
  strLeague: sportsLeague,
  strThumb: 'https://example.com/match-thumb.jpg',
  strFanart: 'https://example.com/match-fanart.jpg',
  strTimestamp: new Date().toISOString(),
  strStatus: '1H',
};
const nextSportsEvent = {
  ...sportsEvent,
  idEvent: '90002',
  strEvent: 'Alpha FC vs Club B',
  strThumb: '',
  strTimestamp: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  strStatus: 'NS',
};
const liveOnlySportsEvent = {
  idEvent: '90003',
  strSport: 'Soccer',
  strLeague: 'Spanish La Liga',
  strHomeTeam: 'Valencia',
  strAwayTeam: 'Real Madrid',
  strHomeTeamBadge: 'https://example.com/valencia.png',
  strAwayTeamBadge: 'https://example.com/real-madrid.png',
  strTimestamp: sportsEvent.strTimestamp,
  strStatus: 'HT',
};
const sportsBroadcastArtwork = 'https://example.com/match-broadcast.jpg';
const sportsDetailArtwork = 'https://example.com/match-detail.jpg';
const artworkLookupFixtures = [
  {
    ...liveOnlySportsEvent,
    idEvent: '90004',
    strLeague: 'Artwork Test Cup',
    strHomeTeam: 'Artwork FC',
    strEvent: 'Artwork FC vs Real Madrid',
  },
  {
    ...liveOnlySportsEvent,
    idEvent: '90005',
    strLeague: 'Artwork Test Cup',
    strHomeTeam: 'Badge FC',
    strEvent: 'Badge FC vs Real Madrid',
  },
];
let artworkLookups = 0;

const XMLTV_FIXTURE = `<tv>
  <channel id="bbc.one"><display-name>BBC One</display-name><icon src="https://example.com/bbc-logo.png" /></channel>
  <channel id="rtp1"><display-name>RTP 1</display-name></channel>
  <programme channel="bbc.one" start="${xmltvTimestamp(EPG_START)}" stop="${xmltvTimestamp(EPG_STOP)}">
    <title>News</title><desc>Latest news</desc>
    <icon src="https://example.com/news-small.jpg" />
    <image type="backdrop" orient="L" size="3">https://example.com/news-wide.jpg</image>
  </programme>
</tv>`;

const M3U_FIXTURE = `#EXTM3U
#EXTINF:-1 tvg-id="bbc.one" tvg-chno="20" tvg-name="BBC One" tvg-logo="https://example.com/bbc-logo.png",BBC One
https://example.com/bbc.m3u8
#EXTINF:-1 tvg-id="rtp-1" tvg-chno="10" tvg-name="RTP-1",RTP-1
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
    formatter: { id: 'gdrive' },
    sortCriteria: { global: [] },
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
  const failUpcomingLookupOnce = new Set(['lookupevent.php', 'lookuptv.php']);
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/v1/json/')) {
      if (!url.pathname.startsWith(`/api/v1/json/${sportsApiKey}/`)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ Message: 'Invalid Premium API key' }));
        return;
      }
      if (url.pathname.endsWith('/livescore.php')) {
        const livescore =
          url.searchParams.get('s') === 'Soccer'
            ? [
                {
                  ...liveOnlySportsEvent,
                  idEvent: sportsEvent.idEvent,
                  strStatus: sportsEvent.strStatus,
                },
                liveOnlySportsEvent,
                ...artworkLookupFixtures,
              ]
            : [];
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ livescore }));
        return;
      }
      if (url.pathname.endsWith('/eventstv.php')) {
        const tvevents =
          url.searchParams.get('a') === 'United_Kingdom'
            ? [
                {
                  idEvent: liveOnlySportsEvent.idEvent,
                  strCountry: 'United States',
                  strEventThumb: 'https://example.com/wrong-market.jpg',
                },
                {
                  idEvent: liveOnlySportsEvent.idEvent,
                  strCountry: 'United Kingdom',
                  strEventThumb: sportsBroadcastArtwork,
                },
              ]
            : [];
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ tvevents }));
        return;
      }
      const id = url.searchParams.get('id');
      if (
        url.pathname.endsWith('/lookupevent.php') &&
        artworkLookupFixtures.some((event) => event.idEvent === id)
      )
        artworkLookups++;
      if (
        id === nextSportsEvent.idEvent &&
        failUpcomingLookupOnce.delete(url.pathname.split('/').at(-1) ?? '')
      ) {
        res.writeHead(503, { 'content-type': 'text/plain' });
        res.end('Service unavailable');
        return;
      }
      const events = [sportsEvent, nextSportsEvent];
      const response = url.pathname.endsWith('/eventsday.php')
        ? {
            events: events
              .filter(
                (event) =>
                  event.strSport === url.searchParams.get('s') &&
                  event.strTimestamp.slice(0, 10) === url.searchParams.get('d')
              )
              .map((event) => ({ ...event, strStatus: 'NS' })),
          }
        : url.pathname.endsWith('/lookupevent.php')
          ? {
              events: [
                ...events,
                {
                  ...liveOnlySportsEvent,
                  strEvent: 'Valencia vs Real Madrid',
                  strThumb: sportsDetailArtwork,
                },
                { ...artworkLookupFixtures[0], strThumb: sportsDetailArtwork },
                artworkLookupFixtures[1],
              ].filter((event) => event.idEvent === id),
            }
          : {
              tvevent: [
                {
                  idEvent: id,
                  strChannel: 'BBC One',
                  strCountry: 'United Kingdom',
                },
                {
                  idEvent: id,
                  strChannel: 'ESPN 2',
                  strCountry: 'United States',
                },
              ],
            };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(response));
      return;
    }
    if (
      req.url === '/guide.xml' ||
      req.url === '/guide-enrichment.xml' ||
      req.url === '/files/epg-gb.xml.gz'
    ) {
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(
        req.url === '/guide-enrichment.xml'
          ? XMLTV_FIXTURE.replace(
              '<title>News</title>',
              '<title>The Matrix</title><category>Movie</category><date>1999</date>'
            )
          : XMLTV_FIXTURE
      );
      return;
    }
    if (req.url === '/alternate-guide.xml' || req.url === '/empty-guide.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(
        `<tv><channel id="bbc.alternate"><display-name>BBC Alternate</display-name></channel>${req.url === '/alternate-guide.xml' ? `<programme channel="bbc.alternate" start="${xmltvTimestamp(EPG_START)}" stop="${xmltvTimestamp(EPG_STOP)}"><title>Alternate programme</title></programme>` : ''}</tv>`
      );
      return;
    }
    if (req.url === '/list.m3u' || req.url === '/iptv/countries/uk.m3u') {
      res.writeHead(200, { 'content-type': 'audio/x-mpegurl' });
      res.end(
        M3U_FIXTURE.replace(
          '#EXTM3U',
          `#EXTM3U url-tvg="http://${req.headers.host}/guide.xml"`
        )
      );
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve())
  );
  const address = server.address();
  assert(
    address && typeof address === 'object',
    'fixture server failed to bind'
  );
  return { server, sourceBase: `http://127.0.0.1:${address.port}` };
}

function createBuiltinHandler(core: CoreModule) {
  const { fromUrlSafeBase64, M3uAddon, XmltvAddon } = core;
  const createAddon = (source: string, config: any) =>
    source === 'iptv-org'
      ? new core.IptvOrgAddon(config)
      : source === 'iptv-epg'
        ? new core.IptvEpgAddon(config)
        : source === 'xmltv'
          ? new XmltvAddon(config)
          : new M3uAddon(config);
  return async (
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse
  ) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const manifest = url.pathname.match(
        /^\/builtins\/live-tv\/(xmltv|m3u|iptv-org|iptv-epg)\/([^/]+)\/manifest\.json$/
      );
      if (manifest) {
        const [, source, encoded] = manifest;
        const config = JSON.parse(fromUrlSafeBase64(encoded));
        const addon = createAddon(source, config);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(await Promise.resolve(addon.getManifest())));
        return;
      }

      const catalog = url.pathname.match(
        /^\/builtins\/live-tv\/(xmltv|m3u|iptv-org|iptv-epg)\/([^/]+)\/catalog\/([^/]+)\/([^/]+)(?:\/([^/]+))?\.json$/
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
        const addon = createAddon(source, config);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify(
            addon instanceof XmltvAddon
              ? await addon.getCatalogResponse(
                  skip,
                  new URLSearchParams(extras ?? '').get('date') ?? undefined
                )
              : { metas: await addon.getCatalog(skip) }
          )
        );
        return;
      }

      const meta = url.pathname.match(
        /^\/builtins\/live-tv\/(xmltv|m3u|iptv-org|iptv-epg)\/([^/]+)\/meta\/([^/]+)\/([^/]+)\.json$/
      );
      if (meta) {
        const [, source, encoded, , channelIdRaw] = meta;
        const channelId = decodeURIComponent(channelIdRaw);
        const config = JSON.parse(fromUrlSafeBase64(encoded));
        const addon = createAddon(source, config);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ meta: await addon.getMeta(channelId) }));
        return;
      }

      const stream = url.pathname.match(
        /^\/builtins\/live-tv\/(m3u|iptv-org)\/([^/]+)\/stream\/([^/]+)\/([^/]+)\.json$/
      );
      if (stream) {
        const [, source, encoded, , channelIdRaw] = stream;
        const channelId = decodeURIComponent(channelIdRaw);
        const config = JSON.parse(fromUrlSafeBase64(encoded));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            streams: await (
              createAddon(source, config) as InstanceType<
                CoreModule['M3uAddon']
              >
            ).getStreams(channelId),
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
        res.end();
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
  const {
    AIOStreams,
    constants,
    getChannelMatchConfidence,
    isHighConfidenceChannelMatch,
  } = deps;
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
  const catalogNames = channels
    .map((item) => item.name)
    .sort()
    .join(',');
  assert(
    catalogNames === 'BBC One,BBC One,RTP 1,RTP-1',
    `unexpected catalog: ${channels.map((item) => item.name).join(', ')}`
  );

  const bbcXmltv =
    channels.find(
      (item) =>
        item.name === 'BBC One' &&
        Array.isArray(item.videos) &&
        item.videos.length > 0
    ) ?? channels.find((item) => item.name === 'BBC One');
  assert(
    bbcXmltv,
    `missing BBC One in catalog: ${channels.map((c) => c.name).join(', ')}`
  );
  const bbcId = bbcXmltv.id;

  const epgMeta = (await aio.getMeta(constants.TV_TYPE, bbcId)).data;
  assert(
    epgMeta?.videos?.[0]?.thumbnail === 'https://example.com/news-small.jpg' &&
      epgMeta.videos[0].background === 'https://example.com/news-wide.jpg',
    'expected separate XMLTV thumbnail and background in meta'
  );
  assert(
    epgMeta?.videos?.[0]?.title === 'News',
    'expected EPG program in meta'
  );
  assert(
    epgMeta?.videos?.[0]?.startTime === EPG_START_ISO,
    'unexpected EPG start time'
  );

  const streamResponse = await aio.getStreams(bbcId, constants.TV_TYPE);
  const streams = streamResponse.data?.streams ?? [];
  assert(
    streams.some((stream) => stream.url === 'https://example.com/bbc.m3u8'),
    'expected M3U stream for BBC One'
  );
  assert(
    streams.some(
      (stream) =>
        stream.live?.programTitle === 'News' && stream.live.isCurrentProgram
    ),
    'expected real current programme in stream metadata'
  );
  const core = await import('../packages/core/dist/index.js');
  for (const id of constants.FORMATTERS.filter((id) => id !== 'custom')) {
    const formattedUserData = core.UserDataSchema.parse({
      ...userData,
      formatter: { id },
    });
    const formatterContext = {
      ...aio.getStreamContext()!.toFormatterContext(streams),
      userData: formattedUserData,
    };
    const formatter = core.createFormatter(formatterContext);
    const bare = await formatter.format({
      ...streams[0],
      parsedFile: undefined,
      live: undefined,
      filename: undefined,
      message: undefined,
    });
    assert(
      !/undefined|null|Unknown/.test(`${bare.name}\n${bare.description}`),
      `missing metadata must not render placeholders: ${id}`
    );
    assert(
      !/(?:Source|Language|Group|Country|Codec|Video|Audio|Host|Mapping|Progress):\s*$/m.test(
        bare.description
      ),
      `missing metadata must not render empty labels: ${id}`
    );
    const delivered = await new core.StremioTransformer(
      formattedUserData
    ).transformStreams(streamResponse, formatterContext, {
      disableAutoplay: true,
    });
    for (let index = 0; index < streams.length; index++) {
      const expected = await formatter.format(streams[index]);
      assert(
        delivered.streams[index].name === expected.name &&
          delivered.streams[index].description === expected.description,
        `preview/delivery mismatch: ${id}`
      );
      assert(
        delivered.streams[index].url === streams[index].url,
        `formatter changed playback URL: ${id}`
      );
      assert(
        !delivered.streams[index].behaviorHints?.bingeGroup,
        'live streams must not receive VOD autoplay groups'
      );
    }
    if (id === 'torrentio')
      assert(
        delivered.streams.some(
          (stream) =>
            stream.description?.includes('Now: News') &&
            stream.description.includes('Progress:')
        ),
        'EPG formatter must include real programme and progress'
      );
  }
  const diagnostic = await core
    .createFormatter({
      userData: core.UserDataSchema.parse({
        ...userData,
        formatter: { id: 'torbox' },
      }),
    })
    .format({
      ...streams[0],
      live: {
        ...streams[0].live,
        providerType: 'manual',
        sourceChannelId: 'manual:https://user:secret@example.com/live.m3u8',
      },
    });
  assert(
    !diagnostic.description.includes('secret') &&
      !diagnostic.description.includes('Source channel:'),
    'diagnostic formatter must not expose manual source URLs'
  );
  for (const formatter of [
    {
      id: 'custom',
      definitions: { custom: { name: 'My channel', description: 'My layout' } },
    },
    {
      id: 'custom',
      selectedSaved: 'Saved',
      definitions: {
        saved: { Saved: { name: 'My channel', description: 'My layout' } },
      },
    },
    {
      id: 'gdrive',
      definitions: {
        overrides: { gdrive: { name: 'My channel', description: 'My layout' } },
      },
    },
  ]) {
    const data = core.UserDataSchema.parse({ ...userData, formatter });
    const rendered = await core
      .createFormatter({ userData: data })
      .format(streams[0]);
    assert(
      rendered.name === 'My channel' && rendered.description === 'My layout',
      'custom definitions must remain unchanged'
    );
  }
  console.log(
    '  [ok] formatter: seven presets, real EPG, playback URLs and custom definitions'
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

  assert(channels[0].name === 'RTP-1', 'catalog must follow source channel numbers');
  const bbcId = channels[1].id;
  const ordered = await new AIOStreams({
    ...userData,
    channelOrder: [bbcId, channels[0].id],
  }).initialise();
  const reordered = await ordered.getCatalog(constants.TV_TYPE, catalog.id);
  assert(reordered.data[0]?.id === bbcId, 'saved order must win over source channel numbers');
  const meta = (await aio.getMeta(constants.TV_TYPE, bbcId)).data;
  assert(meta?.name === 'BBC One', 'expected M3U channel meta');
  assert(meta.channelNumber === 20, 'meta must keep the playlist channel number');
  assert(
    meta?.videos === undefined,
    'M3U-only meta must not include EPG videos'
  );

  const streams =
    (await aio.getStreams(bbcId, constants.TV_TYPE)).data?.streams ?? [];
  assert(streams.length >= 1, 'expected stream for M3U channel');

  console.log('  [ok] sem EPG: catalog, meta e stream apenas via M3U');
}

async function validateIptvBuiltins(core: CoreModule) {
  for (const epg of [false, true]) {
    const userData = liveTvUserData([
      {
        type: 'iptv-org',
        instanceId: `iptv-streams-${epg}`,
        enabled: true,
        options: epg ? { resources: ['stream'] } : {},
      },
      ...(epg
        ? [
            {
              type: 'iptv-epg',
              instanceId: 'iptv-guide',
              enabled: true,
              options: {},
            },
          ]
        : []),
    ]);
    const draft = structuredClone(userData);
    const aio = await new core.AIOStreams(userData).initialise();
    assert(
      aio.hasEpgProvider() === epg,
      'IPTV EPG support must depend on a real guide'
    );
    const catalog = liveTvCatalog(
      aio,
      core.constants.TV_TYPE,
      core.LIVE_TV_MERGED_CATALOG_ID
    );
    const channels = (await aio.getCatalog(core.constants.TV_TYPE, catalog.id))
      .data;
    assert(
      channels.length === 2,
      'IPTV builtins must expose playlist or guide channels'
    );
    const bbc = channels.find((channel) => channel.name === 'BBC One');
    assert(bbc, 'IPTV catalog must contain BBC One');
    const meta = (await aio.getMeta(core.constants.TV_TYPE, bbc.id)).data;
    assert(meta?.name === 'BBC One', 'IPTV channel metadata must resolve');
    assert(meta.logo === 'https://example.com/bbc-logo.png', 'IPTV channel details must retain the channel logo');
    assert(
      Boolean(meta.videos?.length) === epg,
      'only the guide may supply programme metadata'
    );
    const streams =
      (await aio.getStreams(bbc.id, core.constants.TV_TYPE)).data?.streams ??
      [];
    assert(
      streams.some((stream) => stream.url === 'https://example.com/bbc.m3u8'),
      'IPTV channel must resolve playback'
    );
    assert(
      JSON.stringify(userData.presets) === JSON.stringify(draft.presets),
      'IPTV loading must preserve preset draft settings'
    );
  }
  console.log(
    '  [ok] IPTV-org standalone and IPTV-EPG pairing: catalogs, meta, streams and conditional EPG'
  );
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
  assert(
    rtp,
    `missing RTP in merged catalog: ${m3uChannels.map((item) => item.name).join(', ')}`
  );
  assert(
    bbc,
    `missing BBC One in merged catalog: ${m3uChannels.map((item) => item.name).join(', ')}`
  );
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
  const disabledStreams = (await aio.getStreams(rtpId, constants.TV_TYPE)).data
    ?.streams;
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

async function validateParallelStreamResolution(core: CoreModule) {
  let active = 0;
  let maxActive = 0;
  let catalogRequests = 0;
  const streamIds: string[] = [];
  const metaIds: string[] = [];
  const server = createServer(async (req, res) => {
    const match = req.url?.match(/^\/provider\/(\d+)\/(.*)$/);
    if (!match) {
      res.writeHead(404).end();
      return;
    }
    const [, provider, path] = match;
    res.setHeader('Content-Type', 'application/json');
    if (path === 'manifest.json') {
      res.end(
        JSON.stringify({
          id: 'provider-' + provider,
          name: 'Provider ' + provider,
          version: '1.0.0',
          types: ['tv'],
          resources: [
            {
              name: 'meta',
              types: ['tv'],
              idPrefixes: ['provider-' + provider + ':'],
            },
            {
              name: 'stream',
              types: ['tv'],
              idPrefixes: ['provider-' + provider + ':'],
            },
          ],
          catalogs: [
            {
              id: 'channels',
              name: 'Channels',
              type: 'tv',
              extra: [{ name: 'skip' }],
            },
          ],
        })
      );
    } else if (path.startsWith('catalog/')) {
      if (provider === '6') {
        res.writeHead(502).end();
        return;
      }
      active++;
      catalogRequests++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 30));
      active--;
      res.end(
        JSON.stringify({
          metas: [
            {
              id: 'provider-' + provider + ':bbc',
              type: 'tv',
              name: 'BBC News HD',
            },
          ],
        })
      );
    } else if (path.startsWith('meta/')) {
      const id = decodeURIComponent(path.split('/')[2].replace(/\.json$/, ''));
      metaIds.push(id);
      if (id !== 'provider-' + provider + ':bbc') {
        res.writeHead(404).end();
        return;
      }
      res.end(
        JSON.stringify({ meta: { id, type: 'tv', name: 'BBC News HD' } })
      );
    } else if (path.startsWith('stream/')) {
      streamIds.push(decodeURIComponent(path));
      res.end(
        JSON.stringify({
          streams: [
            {
              name: 'Provider ' + provider,
              url: `https://example.com/parallel-${provider}-${encodeURIComponent(path)}.m3u8`,
              behaviorHints: { notWebReady: true },
            },
          ],
        })
      );
    } else res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(
    address && typeof address === 'object',
    'parallel fixture did not bind'
  );
  try {
    const presets: UserData['presets'] = Array.from(
      { length: 6 },
      (_, index) => ({
        type: 'custom',
        instanceId: 'provider-' + index,
        enabled: true,
        options: {
          name: 'Provider ' + index,
          manifestUrl: `http://127.0.0.1:${address.port}/provider/${index}/manifest.json`,
          resources: ['meta', 'stream'],
          timeout: 1000,
        },
      })
    );
    const data = liveTvUserData(presets, [
      {
        id: 'canonical-bbc',
        name: 'BBC News',
        enabled: true,
      },
    ]);
    const aio = await new core.AIOStreams(data).initialise();
    const response = await aio.getStreams(
      'canonical-bbc',
      core.constants.TV_TYPE
    );
    assert(
      response.data.streams.length === 6,
      `expected streams from all six providers; streams=${response.data.streams.length}, catalogs=${catalogRequests}, maxActive=${maxActive}, ids=${streamIds.join(',')}, errors=${JSON.stringify(response.errors)}`
    );
    assert(
      catalogRequests === 6,
      'expected one catalog lookup per stream-only provider'
    );
    assert(maxActive === 4, 'expected bounded concurrent catalog resolution');
    assert(
      streamIds.every((id) => id.includes(':bbc')),
      'expected resolved provider channel IDs'
    );
    const mapped = await new core.AIOStreams(
      liveTvUserData(presets, [
        {
          id: 'canonical-bbc',
          name: 'BBC News',
          streams: [
            {
              addonId: addonInstanceId(aio, 'provider-0'),
              channelId: 'provider-0:bbc',
              enabled: true,
            },
          ],
        },
      ])
    ).initialise();
    metaIds.length = 0;
    await mapped.getStreams('canonical-bbc', core.constants.TV_TYPE);
    assert(
      metaIds.includes('provider-0:bbc'),
      'stream resolution must use the mapped provider ID for metadata'
    );
    const mappedMeta = await mapped.getMeta(
      core.constants.TV_TYPE,
      'canonical-bbc'
    );
    assert(
      mappedMeta.success && mappedMeta.data?.id === 'canonical-bbc',
      'mapped metadata must retain the canonical ID'
    );
    const fallback = await new core.AIOStreams(
      liveTvUserData(presets, [
        {
          id: 'unavailable-channel',
          name: 'Saved channel',
          enabled: true,
        },
      ])
    ).initialise();
    const fallbackMeta = await fallback.getMeta(
      core.constants.TV_TYPE,
      'unavailable-channel'
    );
    assert(
      fallbackMeta.success &&
        fallbackMeta.data?.name === 'Saved channel' &&
        !fallbackMeta.data?.behaviorHints?.hasScheduledVideos,
      'saved channel metadata must remain available without claiming a schedule'
    );
    const failedMeta = await new core.AIOStreams(
      liveTvUserData(presets, [
        {
          id: 'saved-channel',
          name: 'Saved channel',
          enabled: true,
          streams: [
            {
              addonId: addonInstanceId(aio, 'provider-0'),
              channelId: 'provider-0:missing',
              enabled: true,
            },
          ],
        },
      ])
    ).initialise();
    const recoveredMeta = await failedMeta.getMeta(
      core.constants.TV_TYPE,
      'saved-channel'
    );
    assert(
      recoveredMeta.success &&
        recoveredMeta.data?.name === 'Saved channel' &&
        recoveredMeta.errors.length === 0,
      'a failed provider must not turn saved metadata into an error card'
    );
    for (const includeSecondAddon of [false, true]) {
      const sources = [
        {
          addonId: addonInstanceId(aio, 'provider-0'),
          channelId: 'provider-0:hd',
        },
        ...(includeSecondAddon
          ? [
              {
                addonId: addonInstanceId(aio, 'provider-1'),
                channelId: 'provider-1:other',
              },
            ]
          : []),
        {
          addonId: addonInstanceId(aio, 'provider-0'),
          channelId: 'provider-0:base',
        },
        {
          addonId: addonInstanceId(aio, 'provider-0'),
          channelId: 'provider-0:eng',
        },
        {
          addonId: addonInstanceId(aio, 'provider-0'),
          channelId: 'provider-0:disabled',
          enabled: false,
        },
      ];
      const linked = await new core.AIOStreams(
        liveTvUserData(presets, [
          {
            id: 'linked-bbc',
            name: 'BBC News',
            streams: sources,
          },
        ])
      ).initialise();
      const result = await linked.getStreams(
        'linked-bbc',
        core.constants.TV_TYPE
      );
      const expected = sources
        .filter((source) => source.enabled !== false)
        .map((source) => source.channelId);
      assert(
        JSON.stringify(
          result.data.streams.map((stream) => stream.live?.sourceChannelId)
        ) === JSON.stringify(expected),
        `expected every linked ID in configured order: ${JSON.stringify(result.data.streams.map((stream) => stream.live))}`
      );
      assert(
        result.errors.length === 0,
        'linked playback must not report errors'
      );
    }
    assert(
      !streamIds.some((id) => id.includes(':disabled')),
      'disabled links must not be fetched'
    );
    const hidden = await new core.AIOStreams(
      liveTvUserData(presets, [
        {
          id: 'hidden-bbc',
          name: 'BBC News',
          enabled: false,
        },
      ])
    ).initialise();
    await hidden.getStreams('hidden-bbc', core.constants.TV_TYPE);
    assert(
      catalogRequests === 6,
      'disabled channels must not resolve provider catalogs'
    );
    const unmatched = await new core.AIOStreams(
      liveTvUserData(presets, [
        {
          id: 'unmatched-channel',
          name: 'Completely different station',
          enabled: true,
        },
      ])
    ).initialise();
    const beforeUnmatched = streamIds.length;
    const unmatchedStreams = await unmatched.getStreams(
      'unmatched-channel',
      core.constants.TV_TYPE
    );
    assert(
      unmatchedStreams.data.streams.length === 0 &&
        streamIds.length === beforeUnmatched,
      'an unmatched channel must not be sent to providers that reject its ID prefix'
    );
    const withOffline = await new core.AIOStreams(
      liveTvUserData(
        [
          ...presets,
          {
            ...presets[0],
            instanceId: 'provider-6',
            options: {
              ...presets[0].options,
              name: 'Offline provider',
              manifestUrl: `http://127.0.0.1:${address.port}/provider/6/manifest.json`,
            },
          },
        ],
        [{ id: 'offline-bbc', name: 'BBC News', enabled: true }]
      )
    ).initialise();
    const availableStreams = await withOffline.getStreams(
      'offline-bbc',
      core.constants.TV_TYPE
    );
    assert(
      availableStreams.data.streams.length === 6,
      'one failed catalog must not prevent playback from healthy providers'
    );
    console.log(
      '  [ok] stream resolution: mapped IDs, metadata fallback, unsupported IDs skipped, offline sources isolated, concurrency four'
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

async function validateGuideChoicesAndPersistence(
  sourceBase: string,
  core: CoreModule
) {
  const playlist = new core.M3uAddon({
    sourceUrl: `${sourceBase}/list.m3u`,
    timeout: 5000,
  });
  assert(
    (await playlist.getEpgUrls())[0] === `${sourceBase}/guide.xml`,
    'expected guide discovery from the M3U header'
  );
  const bbcId = (await playlist.getCatalog()).find(
    (channel) => channel.name === 'BBC One'
  )!.id;
  const alternate = new core.XmltvAddon({
    sourceUrl: `${sourceBase}/alternate-guide.xml`,
    timeout: 5000,
  });
  const alternateId = (await alternate.getCatalog())[0].id;
  assert(
    !(
      await new core.XmltvAddon({
        sourceUrl: `${sourceBase}/empty-guide.xml`,
        timeout: 5000,
      }).getManifest()
    ).behaviorHints?.epgProvider,
    'empty guide must not enable Native EPG'
  );
  const draft = core.UserDataSchema.parse({
    ...liveTvUserData(
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
        {
          ...xmltvPreset,
          instanceId: 'alternate',
          options: {
            ...xmltvPreset.options,
            name: 'Alternate guide',
            sourceUrl: `${sourceBase}/alternate-guide.xml`,
          },
        },
      ],
      [
        {
          id: bbcId,
          canonicalAddonId: 'xmltv-1',
          name: 'My BBC',
          epgSource: { addonId: 'alternate', channelId: alternateId },
          streams: [
            {
              addonId: 'm3u-1',
              channelId: bbcId,
              confidence: 0,
              enabled: true,
            },
          ],
        },
      ]
    ),
    epgMetadataLanguage: 'pt-BR',
  });
  const inventory = await new core.AIOStreams({
    ...draft,
    channelMappings: [],
  }).initialise();
  const mapping = draft.channelMappings![0];
  mapping.canonicalAddonId = addonInstanceId(inventory, 'xmltv-1');
  mapping.epgSource!.addonId = addonInstanceId(inventory, 'alternate');
  mapping.streams![0].addonId = addonInstanceId(inventory, 'm3u-1');
  const aio = await new core.AIOStreams(draft).initialise();
  const meta = (await aio.getMeta(core.constants.TV_TYPE, bbcId)).data;
  assert(
    meta?.name === 'My BBC' &&
      meta.videos?.[0]?.title === 'Alternate programme',
    'selected guide must supply the schedule while preserving channel edits'
  );
  assert(
    meta.videos[0].id === `${bbcId}:epg:${EPG_START_ISO}`,
    'selected guide programme id must use the canonical channel'
  );
  const catalog = liveTvCatalog(
    aio,
    core.constants.TV_TYPE,
    core.LIVE_TV_MERGED_CATALOG_ID
  );
  const guide = await aio.getCatalog(
    core.constants.TV_TYPE,
    catalog.id,
    `date=${EPG_START_ISO.slice(0, 10)}`
  );
  assert(
    guide.metasDetailed?.find((channel) => channel.id === bbcId)?.videos?.[0]
      ?.title === 'Alternate programme',
    'catalog and meta must use the same guide'
  );
  const current = await aio.getStreams(
    meta.videos[0].id,
    core.constants.TV_TYPE
  );
  assert(
    current.data.streams.some(
      (stream) => stream.url === 'https://example.com/bbc.m3u8'
    ),
    'guide choice must preserve live playback'
  );
  for (const offset of [-24, 24]) {
    const id = `${bbcId}:epg:${new Date(Date.now() + offset * 3600_000).toISOString()}`;
    assert(
      (await aio.getStreams(id, core.constants.TV_TYPE)).data.streams.length ===
        0,
      'past/future programme ids must not resolve to the current live stream'
    );
  }
  const unavailable = await new core.AIOStreams({
    ...draft,
    channelMappings: draft.channelMappings!.map((mapping) => ({
      ...mapping,
      epgSource: { addonId: 'missing', channelId: alternateId },
    })),
  }).initialise();
  assert(
    (await unavailable.getMeta(core.constants.TV_TYPE, bbcId)).data?.videos
      ?.length === 0,
    'missing preferred guide must not silently switch schedules'
  );
  const password = 'live-tv-validation-only';
  const legacyDraft: UserData = {
    ...draft,
    channelOrder: [mapping.id],
    preferredResolutions: ['720p', '1080p'],
    enableSeadex: true,
    checkOwned: true,
    precacheNextEpisode: true,
    services: [{ id: 'realdebrid', enabled: false, credentials: {} }],
    excludedQualities: ['CAM'],
    sortCriteria: {
      global: [
        { key: 'cached', direction: 'desc' },
        { key: 'resolution', direction: 'asc' },
      ],
    },
  };
  const saved = await core.UserRepository.createUser(legacyDraft, password);
  const assertStoredClean = async (uuid: string) => {
    const row = await core.getDb().one<{
      config: string;
      config_salt: string;
    }>(core.sql`SELECT config, config_salt FROM users WHERE uuid = ${uuid}`);
    const { key } = await core.deriveKey(
      `${password}:${core.config.bootstrap.secretKey}`,
      row.config_salt
    );
    const decrypted = core.decryptString(row.config, key);
    assert(
      decrypted.success && decrypted.data,
      'stored configuration must decrypt'
    );
    const stored = JSON.parse(decrypted.data);
    for (const field of [
      'enableSeadex',
      'checkOwned',
      'precacheNextEpisode',
      'services',
      'excludedQualities',
    ]) {
      assert(!(field in stored), `retired ${field} must not be persisted`);
    }
    assert(
      stored.sortCriteria.global.length === 1 &&
        stored.sortCriteria.global[0].key === 'resolution',
      'storage must keep only supported sorting criteria'
    );
  };
  try {
    await assertStoredClean(saved.uuid);
    const restored = await core.UserRepository.getRawUser(saved.uuid, password);
    assert(
      restored?.channelMappings?.[0].epgSource?.channelId === alternateId,
      'guide choice must survive UserData persistence'
    );
    assert(
      restored.epgMetadataLanguage === 'pt-BR',
      'metadata settings must survive UserData persistence'
    );
    assert(
      restored.presets.length === 3 &&
        restored.channelMappings[0].streams?.[0].addonId ===
          mapping.streams![0].addonId,
      'presets and stream order must survive persistence'
    );
    assert(restored.channelOrder?.[0] === mapping.id, 'channel order must survive UserData persistence');
    await core.UserRepository.updateUser(saved.uuid, password, {
      ...restored,
      enableSeadex: true,
      checkOwned: true,
    });
    await assertStoredClean(saved.uuid);
    const child = await core.UserRepository.createUser(
      {
        ...legacyDraft,
        preferredResolutions: ['1080p', '720p'],
        epgMetadataLanguage: 'en-US',
        parentConfig: { uuid: saved.uuid, password },
      },
      password
    );
    try {
      await assertStoredClean(child.uuid);
      const inherited = await core.UserRepository.getUser(child.uuid, password);
      assert(
        inherited?.channelMappings?.[0].epgSource?.channelId === alternateId,
        'parent configuration must preserve guide choices'
      );
      assert(
        inherited.sortCriteria.global[0].direction === 'asc',
        'parent configuration must preserve sorting direction'
      );
      assert(
        inherited.preferredResolutions?.[0] === '720p',
        'Sorting inheritance must include preferred values'
      );
      assert(
        inherited.epgMetadataLanguage === 'pt-BR',
        'Metadata inheritance must include EPG enrichment settings'
      );
    } finally {
      await core.UserRepository.deleteUser(child.uuid, password);
    }
  } finally {
    await core.UserRepository.deleteUser(saved.uuid, password);
  }
  console.log(
    '  [ok] M3U guide discovery, empty guides, explicit EPG choice, catalog/meta consistency, scheduled stream safety and UserData persistence'
  );
}

async function validateDetailsOnlyEnrichment(sourceBase: string, core: CoreModule) {
  const { TMDBMetadata } = await import('../packages/core/dist/metadata/tmdb.js');
  const original = TMDBMetadata.prototype.getEpgMetadata;
  let lookups = 0;
  TMDBMetadata.prototype.getEpgMetadata = async () => {
    lookups++;
    return { cast: ['Enriched cast'] };
  };
  try {
    const aio = await new core.AIOStreams({
      ...liveTvUserData([{
        ...xmltvPreset,
        options: { ...xmltvPreset.options, sourceUrl: `${sourceBase}/guide-enrichment.xml` },
      }]),
      tmdbApiKey: 'fixture-key',
    }).initialise();
    const catalog = aio.getCatalogs().find((item) => item.type === core.constants.TV_TYPE);
    assert(catalog, 'expected enrichment fixture catalog');
    const guide = await aio.getCatalog(core.constants.TV_TYPE, catalog.id, `date=${EPG_START_ISO.slice(0, 10)}`);
    const channel = guide.metasDetailed?.find((item) => item.videos?.length);
    assert(channel, 'expected scheduled programme in discovery');
    assert(lookups === 0, 'discovery must not query TMDB');
    assert(channel.videos?.[0]?.overview === 'Latest news', 'discovery must preserve provider metadata');
    const meta = await aio.getMeta(core.constants.TV_TYPE, channel.id);
    assert(Number(lookups) === 1, 'details must still query TMDB');
    assert(meta.data?.videos?.[0]?.title === 'The Matrix', 'details must preserve the programme title');
    assert(meta.data?.videos?.[0]?.cast?.[0] === 'Enriched cast', 'details must receive enriched metadata');
  } finally {
    TMDBMetadata.prototype.getEpgMetadata = original;
  }
  console.log('  [ok] TMDB enrichment: discovery skips lookups, channel details enrich on demand');
}

async function validateSports(
  sourceBase: string,
  internalBase: string,
  core: CoreModule
) {
  const draft = liveTvUserData([
    {
      type: 'sports',
      instanceId: 'sports-1',
      enabled: true,
      options: {
        locale: 'pt',
        market: 'GB',
        timeZone: 'UTC',
        theSportsDbApiKey: sportsApiKey,
      },
    },
    {
      ...m3uPreset,
      options: { ...m3uPreset.options, sourceUrl: `${sourceBase}/list.m3u` },
    },
  ]);
  const userUrl = `${internalBase}/api/v${core.constants.API_VERSION}/user`;
  const password = 'sports-fixture-password';
  const json = async <T>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, init);
    assert(
      response.ok,
      `${init?.method ?? 'GET'} returned ${response.status} in sports validation`
    );
    return (await response.json()) as T;
  };
  const saved = (
    await json<{ data: { uuid: string; encryptedPassword: string } }>(userUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ config: draft, password }),
    })
  ).data;
  const auth = {
    authorization: `Basic ${Buffer.from(`${saved.uuid}:${password}`).toString('base64')}`,
  };
  const stremio = `${internalBase}/stremio/${saved.uuid}/${encodeURIComponent(saved.encryptedPassword)}`;
  const catalog = (id: string, extras = '') =>
    json<import('../packages/core/dist/index.js').CatalogResponse>(
      `${stremio}/catalog/tv/${id}${extras ? `/${extras}` : ''}.json`
    );
  const streams = (id: string) =>
    json<import('../packages/core/dist/index.js').AIOStreamResponse>(
      `${stremio}/stream/tv/${encodeURIComponent(id)}.json`
    );
  try {
    const {
      data: { userData: restored },
    } = await json<{ data: { userData: UserData } }>(`${userUrl}?raw=true`, {
      headers: auth,
    });
    assert(
      restored.presets[0]?.options.market === 'GB' &&
        restored.presets[0]?.options.theSportsDbApiKey === sportsApiKey,
      'sports preferences and the supplied key must persist in the preset'
    );
    const manifest = await json<
      import('../packages/core/dist/index.js').Manifest
    >(`${stremio}/manifest.json`);
    assert(
      !JSON.stringify(manifest).includes(sportsApiKey),
      'the Stremio manifest must not expose the API key'
    );
    const invalidDraft = structuredClone(draft);
    invalidDraft.presets[0].options.theSportsDbApiKey = 'invalid-fixture-key';
    const rejected = await fetch(userUrl, {
      method: 'PUT',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ config: invalidDraft }),
    });
    assert(
      !rejected.ok && !(await rejected.text()).includes('invalid-fixture-key'),
      'an invalid key must be rejected without exposing it or using the valid key’s cache'
    );
    assert(
      !manifest.behaviorHints?.epgProvider,
      'sports schedule must not enable Native EPG'
    );
    const football = manifest.catalogs.find(
      (catalog) => catalog.name === 'Futebol'
    );
    assert(
      football?.extra?.some(
        (extra) =>
          extra.name === 'genre' &&
          extra.options?.includes(sportsLeague) &&
          extra.options.includes(liveOnlySportsEvent.strLeague)
      ),
      'manifest must retain localized names and championship options'
    );
    for (const resourceName of ['meta', 'stream']) {
      assert(
        manifest.resources.some(
          (resource) =>
            typeof resource !== 'string' &&
            resource.name === resourceName &&
            resource.idPrefixes?.includes(core.SPORTS_EVENT_PREFIX)
        ),
        `manifest must advertise ${resourceName} for sports IDs`
      );
    }
    // A saved Stremio link can be opened after a restart without loading the catalog.
    await core.Cache.clearPrefix('sports-data');
    const upcomingId = `${core.SPORTS_EVENT_PREFIX}${nextSportsEvent.idEvent}`;
    const { meta: upcomingMeta } = await json<
      import('../packages/core/dist/index.js').MetaResponse
    >(`${stremio}/meta/tv/${encodeURIComponent(upcomingId)}.json`);
    assert(
      upcomingMeta.name === `🕒 ${nextSportsEvent.strEvent}` &&
        upcomingMeta.poster === nextSportsEvent.strFanart &&
        upcomingMeta.description?.includes(
          'Informação de transmissão temporariamente indisponível'
        ),
      `sports details must survive a failed lookup before opening the catalog: ${upcomingMeta.name} (${upcomingMeta.description})`
    );
    const missingId = `${core.SPORTS_EVENT_PREFIX}99999`;
    const missing = await fetch(
      `${stremio}/meta/tv/${encodeURIComponent(missingId)}.json`
    );
    assert(
      missing.headers.get('cache-control')?.includes('no-store') &&
        !(await missing.json()).cacheMaxAge,
      'failed meta responses must not be cached by Stremio or CDNs'
    );
    const matches = await catalog(
      football.id,
      `genre=${encodeURIComponent(sportsLeague)}`
    );
    assert(
      matches.metas?.map((item) => item.name).join(',') ===
        `🔴 ${sportsEvent.strEvent},🕒 ${nextSportsEvent.strEvent}`,
      'sports catalog must show live and upcoming markers in kickoff order'
    );
    const [live, upcoming] = matches.metas;
    const liveOnly = await catalog(
      football.id,
      `genre=${encodeURIComponent(liveOnlySportsEvent.strLeague)}`
    );
    assert(
      liveOnly.metas?.length === 1 &&
        liveOnly.metas[0].id ===
          `${core.SPORTS_EVENT_PREFIX}${liveOnlySportsEvent.idEvent}` &&
        liveOnly.metas[0].name === '🔴 Valencia vs Real Madrid',
      'the catalog must show live games missing from the daily schedule under their league'
    );
    assert(
      liveOnly.metas[0].posterShape === 'landscape' &&
        liveOnly.metas[0].poster === sportsBroadcastArtwork,
      'live games without event artwork must use the matching broadcast thumbnail from the saved market'
    );
    const { meta: liveOnlyMeta } = await json<
      import('../packages/core/dist/index.js').MetaResponse
    >(`${stremio}/meta/tv/${encodeURIComponent(liveOnly.metas[0].id)}.json`);
    assert(
      liveOnlyMeta.poster === sportsDetailArtwork,
      'details must prefer the official match artwork'
    );
    await core.Cache.clearPrefix('catalog');
    const refreshed = await catalog(
      football.id,
      `genre=${encodeURIComponent(liveOnlySportsEvent.strLeague)}`
    );
    assert(
      refreshed.metas?.[0]?.poster === sportsDetailArtwork,
      'the catalog must reuse official artwork from the match details when refreshed'
    );
    const artworkExtras = `genre=${encodeURIComponent(artworkLookupFixtures[0].strLeague)}`;
    const expectedPosters = [
      sportsDetailArtwork,
      artworkLookupFixtures[1].strHomeTeamBadge,
    ].join(',');
    const firstArtworkPage = await catalog(football.id, artworkExtras);
    assert(
      firstArtworkPage.metas?.map((item) => item.poster).join(',') === expectedPosters &&
        artworkLookups === 2,
      'the catalog must fetch missing match artwork and fall back when no artwork exists'
    );
    await core.Cache.clearPrefix('catalog');
    await core.Cache.clearPrefix('sports-data');
    const cachedArtworkPage = await catalog(football.id, artworkExtras);
    assert(
      cachedArtworkPage.metas?.map((item) => item.poster).join(',') === expectedPosters &&
        artworkLookups === 2,
      'rebuilding the catalog must reuse cached hits and misses without looking up matches again'
    );
    assert(
      live.posterShape === 'landscape' &&
        live.poster === sportsEvent.strThumb &&
        upcoming.posterShape === 'landscape' &&
        upcoming.poster === nextSportsEvent.strFanart,
      'sports catalog must use the event thumbnail or fanart in landscape'
    );
    const { meta } = await json<
      import('../packages/core/dist/index.js').MetaResponse
    >(`${stremio}/meta/tv/${encodeURIComponent(live.id)}.json`);
    assert(
      meta.description?.includes('Onde assistir (Reino Unido): BBC One'),
      'meta must use the saved market and locale'
    );
    assert(meta.name === live.name, 'sports details must keep the live marker');
    assert(
      meta.posterShape === 'landscape' &&
        meta.poster === live.poster &&
        meta.background === live.poster &&
        meta.videos?.length === 1 &&
        meta.videos[0].id === live.id &&
        meta.videos[0].thumbnail === live.poster &&
        meta.videos[0].background === live.poster,
      'sports details must reuse the landscape poster as the background and video artwork without changing the playback ID'
    );
    const lineup = await catalog(core.LIVE_TV_MERGED_CATALOG_ID);
    assert(
      lineup.metas?.every(
        (item) => !item.id.startsWith(core.SPORTS_EVENT_PREFIX)
      ),
      'channel catalog must exclude sports matches'
    );
    const bbc = lineup.metas.find((item) => item.name === 'BBC One');
    assert(bbc, 'fixture must expose BBC One');
    assert(
      (await streams(live.id)).streams.some((stream) =>
        stream.url?.includes('/bbc.m3u8')
      ),
      'live fixture must resolve the configured channel stream'
    );
    assert(
      (await streams(upcoming.id)).streams.length === 0,
      'upcoming fixtures must not return streams'
    );
    const guide = {
      ...xmltvPreset,
      options: { ...xmltvPreset.options, sourceUrl: `${sourceBase}/guide.xml` },
    };
    await json(userUrl, {
      method: 'PUT',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        config: {
          ...restored,
          presets: [...restored.presets, guide],
          channelMappings: [{ id: bbc.id, enabled: false }],
        },
      }),
    });
    const withGuide = await json<
      import('../packages/core/dist/index.js').Manifest
    >(`${stremio}/manifest.json`);
    assert(
      withGuide.behaviorHints?.epgProvider,
      'a configured guide must still enable Native EPG'
    );
    assert(
      (await streams(live.id)).streams.length === 0,
      'disabled channels must not play from a sports catalog'
    );
  } finally {
    await json(userUrl, { method: 'DELETE', headers: auth });
  }
  console.log(
    '  [ok] Sports: saved preferences, localized manifest, genre, meta, live streams and EPG isolation'
  );
}

async function main() {
  console.log('Validando Live TV E2E...');
  const { server: fixtureServer, sourceBase } = await startFixtureServer();
  const { server: builtinServer, base: internalBase } = await reservePort();
  process.env.INTERNAL_URL = internalBase;
  process.env.BASE_URL = internalBase;
  process.env.REQUEST_URL_MAPPINGS = JSON.stringify({
    'https://iptv-org.github.io': sourceBase,
    'https://iptv-epg.org': sourceBase,
    'https://www.thesportsdb.com': sourceBase,
  });

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
    await validateIptvBuiltins(core);
    await validateChannelMappings(sourceBase, deps);
    await validateParallelStreamResolution(core);
    await validateGuideChoicesAndPersistence(sourceBase, core);
    await validateDetailsOnlyEnrichment(sourceBase, core);
    const { default: app } = await import('../packages/server/src/app.js');
    builtinServer.removeAllListeners('request');
    builtinServer.on('request', app);
    await validateSports(sourceBase, internalBase, core);
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
