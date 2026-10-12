import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  appConfig,
  PLUTO_TV_REGION_CODES,
  testPlutoTvImport,
} from '@aiolivetv/core';
import { createResponse } from '../../utils/responses.js';
import { corsMiddleware } from '../../middlewares/cors.js';

const router: Router = Router();

router.use(corsMiddleware);

const TestBodySchema = z.object({
  region: z.enum(PLUTO_TV_REGION_CODES).optional().default('br'),
  timeout: z
    .number()
    .int()
    .positive()
    .optional()
    .default(() => appConfig.presets.defaultTimeout),
});

router.post(
  '/test',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = TestBodySchema.parse(req.body ?? {});
      const result = await testPlutoTvImport({
        region: body.region,
        timeout: body.timeout,
        timeShiftMinutes: 0,
      });
      res.json(
        createResponse({
          success: true,
          data: result,
          detail: result.message,
        })
      );
    } catch (error) {
      next(error);
    }
  }
);

export default router;
