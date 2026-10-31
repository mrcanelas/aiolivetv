import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import {
  fromUrlSafeBase64,
  IptvOrgAddon,
  IptvEpgAddon,
  IptvOrgConfigSchema,
  IptvEpgConfigSchema,
  appConfig,
  M3uAddon,
  XmltvAddon,
  VivoTvAddon,
  MovistarTvAddon,
  TvpAddon,
  DirectvAddon,
  ClaroTvAddon,
  MiTvAddon,
  XtreamAddon,
  TvheadendAddon,
  PlutoTvAddon,
  OrangeTvAddon,
  MovistarPlusAddon,
  TdtChannelsAddon,
  SpainTvConfigSchema,
  parseCatalogExtras,
  ExtrasParser,
  type LiveTvSourceConfig,
  type VivoTvConfig,
  type MovistarTvConfig,
  type TvpTvConfig,
  type DirectvConfig,
  type ClaroTvConfig,
  type MiTvConfig,
  type XtreamConfig,
  type TvheadendConfig,
  type PlutoTvConfig,
} from '@aiolivetv/core';
import { getEncodedExtras } from '../../utils/stremioExtras.js';

const router: Router = Router();

interface ResourceParams {
  encodedConfig: string;
  type: string;
  id: string;
  extras?: string;
}

function config(encodedConfig: string): LiveTvSourceConfig {
  return JSON.parse(fromUrlSafeBase64(encodedConfig));
}

function vivoConfig(encodedConfig: string): VivoTvConfig {
  return JSON.parse(fromUrlSafeBase64(encodedConfig));
}

function movistarConfig(encodedConfig: string): MovistarTvConfig {
  return JSON.parse(fromUrlSafeBase64(encodedConfig));
}

function tvpConfig(encodedConfig: string): TvpTvConfig {
  return JSON.parse(fromUrlSafeBase64(encodedConfig));
}

function directvConfig(encodedConfig: string): DirectvConfig {
  return JSON.parse(fromUrlSafeBase64(encodedConfig));
}

function claroConfig(encodedConfig: string): ClaroTvConfig {
  return JSON.parse(fromUrlSafeBase64(encodedConfig));
}

function miTvConfig(encodedConfig: string): MiTvConfig {
  return JSON.parse(fromUrlSafeBase64(encodedConfig));
}

function xtreamConfig(encodedConfig: string): XtreamConfig {
  return JSON.parse(fromUrlSafeBase64(encodedConfig));
}

function tvheadendConfig(encodedConfig: string): TvheadendConfig {
  return JSON.parse(fromUrlSafeBase64(encodedConfig));
}

function plutoTvConfig(encodedConfig: string): PlutoTvConfig {
  return JSON.parse(fromUrlSafeBase64(encodedConfig));
}

// Both providers reuse the readers, but keep their public preset roles separate.
function iptvOrgAddon(encoded: string) {
  return new IptvOrgAddon({
    ...IptvOrgConfigSchema.parse(config(encoded)),
    maxBytes: appConfig.resources.liveTvSourceMaxBytes,
  });
}
function iptvEpgAddon(encoded: string) {
  return new IptvEpgAddon({
    ...IptvEpgConfigSchema.parse(config(encoded)),
    maxBytes: appConfig.resources.iptvEpgSourceMaxBytes,
  });
}

for (const [source, createAddon] of [
  ['iptv-org', iptvOrgAddon],
  ['iptv-epg', iptvEpgAddon],
] as const) {
  router.get(
    `/${source}/:encodedConfig/manifest.json`,
    async (req, res, next) => {
      try {
        res.json(await createAddon(req.params.encodedConfig).getManifest());
      } catch (error) {
        next(error);
      }
    }
  );
  router.get(
    `/${source}/:encodedConfig/catalog/:type/:id{/:extras}.json`,
    async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
      try {
        const { skip, date, genre } = parseCatalogExtras(getEncodedExtras(req));
        const addon = createAddon(req.params.encodedConfig);
        res.json(
          addon instanceof IptvEpgAddon
            ? await addon.getCatalogResponse(skip, date)
            : {
                metas: await addon.getCatalog(skip, genre),
                cacheMaxAge: 300,
                staleRevalidate: 1800,
                staleError: 604800,
              }
        );
      } catch (error) {
        next(error);
      }
    }
  );
  router.get(
    `/${source}/:encodedConfig/meta/:type/:id.json`,
    async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
      try {
        res.json({
          meta: await createAddon(req.params.encodedConfig).getMeta(
            req.params.id
          ),
          cacheMaxAge: 900,
          staleRevalidate: 3600,
          staleError: 604800,
        });
      } catch (error) {
        next(error);
      }
    }
  );
}
router.get(
  '/iptv-org/:encodedConfig/stream/:type/:id.json',
  async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
    try {
      res.json({
        streams: await iptvOrgAddon(req.params.encodedConfig).getStreams(
          req.params.id
        ),
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get('/:source/:encodedConfig/manifest.json', async (req, res, next) => {
  try {
    const addon =
      req.params.source === 'xmltv'
        ? new XmltvAddon(config(req.params.encodedConfig))
        : req.params.source === 'm3u'
          ? new M3uAddon(config(req.params.encodedConfig))
          : req.params.source === 'xtream'
            ? new XtreamAddon(xtreamConfig(req.params.encodedConfig))
            : req.params.source === 'tvheadend'
              ? new TvheadendAddon(tvheadendConfig(req.params.encodedConfig))
              : req.params.source === 'pluto-tv'
                ? new PlutoTvAddon(plutoTvConfig(req.params.encodedConfig))
                : req.params.source === 'vivo-tv'
                  ? new VivoTvAddon(vivoConfig(req.params.encodedConfig))
                  : req.params.source === 'orange-tv'
                    ? new OrangeTvAddon(
                        SpainTvConfigSchema.parse(
                          config(req.params.encodedConfig)
                        )
                      )
                    : req.params.source === 'movistar-plus'
                      ? new MovistarPlusAddon(
                          SpainTvConfigSchema.parse(
                            config(req.params.encodedConfig)
                          )
                        )
                      : req.params.source === 'tdtchannels'
                        ? new TdtChannelsAddon(
                            SpainTvConfigSchema.parse(
                              config(req.params.encodedConfig)
                            )
                          )
                        : req.params.source === 'movistar-tv'
                          ? new MovistarTvAddon(
                              movistarConfig(req.params.encodedConfig)
                            )
                          : req.params.source === 'tvp'
                            ? new TvpAddon(tvpConfig(req.params.encodedConfig))
                            : req.params.source === 'directv'
                              ? new DirectvAddon(
                                  directvConfig(req.params.encodedConfig)
                                )
                              : req.params.source === 'claro-tv'
                                ? new ClaroTvAddon(
                                    claroConfig(req.params.encodedConfig)
                                  )
                                : req.params.source === 'mi-tv'
                                  ? new MiTvAddon(
                                      miTvConfig(req.params.encodedConfig)
                                    )
                                  : undefined;
    if (!addon) throw new Error(`Unsupported source: ${req.params.source}`);
    res.json(await Promise.resolve(addon.getManifest()));
  } catch (error) {
    next(error);
  }
});

router.get(
  '/xmltv/:encodedConfig/catalog/:type/:id{/:extras}.json',
  async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
    try {
      const { skip, date } = parseCatalogExtras(getEncodedExtras(req));
      const response = await new XmltvAddon(
        config(req.params.encodedConfig)
      ).getCatalogResponse(skip, date);
      res.json(response);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/xmltv/:encodedConfig/meta/:type/:id.json',
  async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
    try {
      const meta = await new XmltvAddon(
        config(req.params.encodedConfig)
      ).getMeta(req.params.id);
      res.json({
        meta,
        cacheMaxAge: 900,
        staleRevalidate: 3600,
        staleError: 604800,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/m3u/:encodedConfig/catalog/:type/:id{/:extras}.json',
  async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
    try {
      const extras = parseCatalogExtras(getEncodedExtras(req));
      const metas = await new M3uAddon(
        config(req.params.encodedConfig)
      ).getCatalog(extras.skip, extras.genre);
      res.json({
        metas,
        cacheMaxAge: 300,
        staleRevalidate: 1800,
        staleError: 604800,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/m3u/:encodedConfig/meta/:type/:id.json',
  async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
    try {
      const meta = await new M3uAddon(config(req.params.encodedConfig)).getMeta(
        req.params.id
      );
      res.json({
        meta,
        cacheMaxAge: 900,
        staleRevalidate: 3600,
        staleError: 604800,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/m3u/:encodedConfig/stream/:type/:id.json',
  async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
    try {
      const streams = await new M3uAddon(
        config(req.params.encodedConfig)
      ).getStreams(req.params.id);
      res.json({ streams });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/xtream/:encodedConfig/stream/:type/:id.json',
  async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
    try {
      const streams = await new XtreamAddon(
        xtreamConfig(req.params.encodedConfig)
      ).getStreams(req.params.id);
      res.json({ streams });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/xtream/:encodedConfig/catalog/:type/:id{/:extras}.json',
  async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
    try {
      const extras = getEncodedExtras(req);
      const { skip, date, genre } = parseCatalogExtras(extras);
      const { limit } = new ExtrasParser(extras);
      const response = await new XtreamAddon(
        xtreamConfig(req.params.encodedConfig)
      ).getCatalogResponse(skip, date, genre, limit);
      res.json(response);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/xtream/:encodedConfig/meta/:type/:id.json',
  async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
    try {
      const meta = await new XtreamAddon(
        xtreamConfig(req.params.encodedConfig)
      ).getMeta(req.params.id);
      res.json({
        meta,
        cacheMaxAge: 900,
        staleRevalidate: 3600,
        staleError: 604800,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/tvheadend/:encodedConfig/stream/:type/:id.json',
  async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
    try {
      const streams = await new TvheadendAddon(
        tvheadendConfig(req.params.encodedConfig)
      ).getStreams(req.params.id);
      res.json({ streams });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/tvheadend/:encodedConfig/catalog/:type/:id{/:extras}.json',
  async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
    try {
      const { skip, date, genre } = parseCatalogExtras(getEncodedExtras(req));
      const response = await new TvheadendAddon(
        tvheadendConfig(req.params.encodedConfig)
      ).getCatalogResponse(skip, date, genre);
      res.json(response);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/tvheadend/:encodedConfig/meta/:type/:id.json',
  async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
    try {
      const meta = await new TvheadendAddon(
        tvheadendConfig(req.params.encodedConfig)
      ).getMeta(req.params.id);
      res.json({
        meta,
        cacheMaxAge: 900,
        staleRevalidate: 3600,
        staleError: 604800,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/pluto-tv/:encodedConfig/stream/:type/:id.json',
  async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
    try {
      const streams = await new PlutoTvAddon(
        plutoTvConfig(req.params.encodedConfig)
      ).getStreams(req.params.id);
      res.json({ streams });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/pluto-tv/:encodedConfig/catalog/:type/:id{/:extras}.json',
  async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
    try {
      const { skip, date, genre } = parseCatalogExtras(getEncodedExtras(req));
      const response = await new PlutoTvAddon(
        plutoTvConfig(req.params.encodedConfig)
      ).getCatalogResponse(skip, date, genre);
      res.json(response);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/pluto-tv/:encodedConfig/meta/:type/:id.json',
  async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
    try {
      const meta = await new PlutoTvAddon(
        plutoTvConfig(req.params.encodedConfig)
      ).getMeta(req.params.id);
      res.json({
        meta,
        cacheMaxAge: 900,
        staleRevalidate: 3600,
        staleError: 604800,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/vivo-tv/:encodedConfig/catalog/:type/:id{/:extras}.json',
  async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
    try {
      const { skip, date } = parseCatalogExtras(getEncodedExtras(req));
      const response = await new VivoTvAddon(
        vivoConfig(req.params.encodedConfig)
      ).getCatalogResponse(skip, date);
      res.json(response);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/vivo-tv/:encodedConfig/meta/:type/:id.json',
  async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
    try {
      const meta = await new VivoTvAddon(
        vivoConfig(req.params.encodedConfig)
      ).getMeta(req.params.id);
      res.json({
        meta,
        cacheMaxAge: 900,
        staleRevalidate: 3600,
        staleError: 604800,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/movistar-tv/:encodedConfig/catalog/:type/:id{/:extras}.json',
  async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
    try {
      const { skip, date } = parseCatalogExtras(getEncodedExtras(req));
      const response = await new MovistarTvAddon(
        movistarConfig(req.params.encodedConfig)
      ).getCatalogResponse(skip, date);
      res.json(response);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/movistar-tv/:encodedConfig/meta/:type/:id.json',
  async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
    try {
      const meta = await new MovistarTvAddon(
        movistarConfig(req.params.encodedConfig)
      ).getMeta(req.params.id);
      res.json({
        meta,
        cacheMaxAge: 900,
        staleRevalidate: 3600,
        staleError: 604800,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/tvp/:encodedConfig/catalog/:type/:id{/:extras}.json',
  async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
    try {
      const { skip, date } = parseCatalogExtras(getEncodedExtras(req));
      const response = await new TvpAddon(
        tvpConfig(req.params.encodedConfig)
      ).getCatalogResponse(skip, date);
      res.json(response);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/tvp/:encodedConfig/meta/:type/:id.json',
  async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
    try {
      const meta = await new TvpAddon(
        tvpConfig(req.params.encodedConfig)
      ).getMeta(req.params.id);
      res.json({
        meta,
        cacheMaxAge: 900,
        staleRevalidate: 3600,
        staleError: 604800,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/directv/:encodedConfig/catalog/:type/:id{/:extras}.json',
  async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
    try {
      const { skip, date } = parseCatalogExtras(getEncodedExtras(req));
      const response = await new DirectvAddon(
        directvConfig(req.params.encodedConfig)
      ).getCatalogResponse(skip, date);
      res.json(response);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/directv/:encodedConfig/meta/:type/:id.json',
  async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
    try {
      const meta = await new DirectvAddon(
        directvConfig(req.params.encodedConfig)
      ).getMeta(req.params.id);
      res.json({
        meta,
        cacheMaxAge: 900,
        staleRevalidate: 3600,
        staleError: 604800,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/claro-tv/:encodedConfig/catalog/:type/:id{/:extras}.json',
  async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
    try {
      const { skip, date, genre } = parseCatalogExtras(getEncodedExtras(req));
      const response = await new ClaroTvAddon(
        claroConfig(req.params.encodedConfig)
      ).getCatalogResponse(skip, date, genre);
      res.json(response);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/claro-tv/:encodedConfig/meta/:type/:id.json',
  async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
    try {
      const meta = await new ClaroTvAddon(
        claroConfig(req.params.encodedConfig)
      ).getMeta(req.params.id);
      res.json({
        meta,
        cacheMaxAge: 900,
        staleRevalidate: 3600,
        staleError: 604800,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/mi-tv/:encodedConfig/catalog/:type/:id{/:extras}.json',
  async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
    try {
      const { skip, date } = parseCatalogExtras(getEncodedExtras(req));
      const response = await new MiTvAddon(
        miTvConfig(req.params.encodedConfig)
      ).getCatalogResponse(skip, date);
      res.json(response);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/mi-tv/:encodedConfig/meta/:type/:id.json',
  async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
    try {
      const meta = await new MiTvAddon(
        miTvConfig(req.params.encodedConfig)
      ).getMeta(req.params.id);
      res.json({
        meta,
        cacheMaxAge: 900,
        staleRevalidate: 3600,
        staleError: 604800,
      });
    } catch (error) {
      next(error);
    }
  }
);

for (const [source, Addon] of [
  ['orange-tv', OrangeTvAddon],
  ['movistar-plus', MovistarPlusAddon],
  ['tdtchannels', TdtChannelsAddon],
] as const) {
  router.get(
    `/${source}/:encodedConfig/catalog/:type/:id{/:extras}.json`,
    async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
      try {
        const { skip, date } = parseCatalogExtras(getEncodedExtras(req));
        const addon = new Addon(
          SpainTvConfigSchema.parse(config(req.params.encodedConfig))
        );
        res.json(await addon.getCatalogResponse(skip, date));
      } catch (error) {
        next(error);
      }
    }
  );
  router.get(
    `/${source}/:encodedConfig/meta/:type/:id.json`,
    async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
      try {
        const addon = new Addon(
          SpainTvConfigSchema.parse(config(req.params.encodedConfig))
        );
        res.json({
          meta: await addon.getMeta(req.params.id),
          cacheMaxAge: 300,
          staleRevalidate: 1800,
          staleError: 604800,
        });
      } catch (error) {
        next(error);
      }
    }
  );
}

router.get(
  '/tdtchannels/:encodedConfig/stream/:type/:id.json',
  async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
    try {
      const addon = new TdtChannelsAddon(
        SpainTvConfigSchema.parse(config(req.params.encodedConfig))
      );
      res.json({ streams: await addon.getStreams(req.params.id) });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
