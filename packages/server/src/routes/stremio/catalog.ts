import { Router, Request, Response } from 'express';
import {
  AIOStreams,
  CatalogResponse,
  createLogger,
  StremioTransformer,
} from '@aiolivetv/core';
import { stremioCatalogRateLimiter } from '../../middlewares/ratelimit.js';
import { trackResource } from '../../middlewares/analytics.js';
import {
  catalogExtrasAreCdnCacheable,
  setStremioCatalogCacheHeaders,
} from '../../utils/stremioCacheHeaders.js';

const logger = createLogger('server');
const router: Router = Router();

router.use(stremioCatalogRateLimiter);
router.use(trackResource('catalog'));

interface CatalogParams {
  type: string;
  id: string;
  extras?: string; // optional
}

router.get(
  '/:type/:id{/:extras}.json',
  async (req: Request<CatalogParams>, res: Response<CatalogResponse>, next) => {
    const transformer = new StremioTransformer(req.userData);
    if (!req.userData) {
      setStremioCatalogCacheHeaders(res, { cacheable: false });
      res.status(200).json(
        transformer.transformCatalog({
          success: false,
          data: [],
          errors: [{ description: 'Please configure the addon first' }],
        })
      );
      return;
    }

    try {
      const { type, id, extras } = req.params;

      const result = await (
        await new AIOStreams(req.userData).initialise()
      ).getCatalog(type, id, extras);
      const catalog = transformer.transformCatalog(result);
      const itemCount =
        (catalog.metas?.length ?? 0) + (catalog.metasDetailed?.length ?? 0);
      setStremioCatalogCacheHeaders(res, {
        cacheable:
          result.success &&
          itemCount > 0 &&
          catalogExtrasAreCdnCacheable(extras),
      });
      res.status(200).json(
        result.success
          ? {
              ...catalog,
              cacheMaxAge: 300,
              staleRevalidate: 1800,
              staleError: 604800,
            }
          : catalog
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errors = [
        {
          description: errorMsg,
        },
      ];
      if (transformer.showError('catalog', errors)) {
        logger.error(`Unexpected error during catalog retrieval: ${errorMsg}`);
        setStremioCatalogCacheHeaders(res, { cacheable: false });
        res.status(200).json(
          transformer.transformCatalog({
            success: false,
            data: [],
            errors,
          })
        );
        return;
      }
      next(error);
    }
  }
);

export default router;
