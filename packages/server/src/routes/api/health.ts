import { Router, Request, Response, NextFunction } from 'express';
import { createResponse } from '../../utils/responses.js';
import {
  APIError,
  constants,
  createLogger,
  UserRepository,
} from '@aiolivetv/core';
const router: Router = Router();
const logger = createLogger('server');

const HEALTH_CACHE_CONTROL = 'no-store, no-cache, must-revalidate';

function setHealthCacheHeaders(res: Response) {
  res.setHeader('Cache-Control', HEALTH_CACHE_CONTROL);
  res.setHeader('CDN-Cache-Control', HEALTH_CACHE_CONTROL);
  res.setHeader('Vercel-CDN-Cache-Control', HEALTH_CACHE_CONTROL);
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  setHealthCacheHeaders(res);

  try {
    await UserRepository.getUserCount();
    res.status(200).json(createResponse({ success: true, detail: 'OK' }));
  } catch (error: any) {
    logger.error(`Health check failed: ${error.message}`);
    next(
      new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR, error.message)
    );
  }
});

export default router;
