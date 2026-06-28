import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import {
  fromUrlSafeBase64,
  M3uAddon,
  XmltvAddon,
  type LiveTvSourceConfig,
} from '@aiostreams/core';

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

router.get('/:source/:encodedConfig/manifest.json', (req, res, next) => {
  try {
    const sourceConfig = config(req.params.encodedConfig);
    const addon =
      req.params.source === 'xmltv'
        ? new XmltvAddon(sourceConfig)
        : req.params.source === 'm3u'
          ? new M3uAddon(sourceConfig)
          : undefined;
    if (!addon) throw new Error(`Unsupported source: ${req.params.source}`);
    res.json(addon.getManifest());
  } catch (error) {
    next(error);
  }
});

router.get(
  '/xmltv/:encodedConfig/catalog/:type/:id{/:extras}.json',
  async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
    try {
      const metas = await new XmltvAddon(
        config(req.params.encodedConfig)
      ).getCatalog();
      res.json({ metas });
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
      res.json({ meta });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/m3u/:encodedConfig/catalog/:type/:id{/:extras}.json',
  async (req: Request<ResourceParams>, res: Response, next: NextFunction) => {
    try {
      const metas = await new M3uAddon(
        config(req.params.encodedConfig)
      ).getCatalog();
      res.json({ metas });
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
      res.json({ meta });
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

export default router;
