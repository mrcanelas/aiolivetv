import { timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response, Router } from 'express';
import {
  config as appConfig,
  createLogger,
  TaskManager,
} from '@aiostreams/core';
import { createResponse } from '../../utils/responses.js';

const logger = createLogger('server');
const router: Router = Router();

function secretsEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function authorizeCron(req: Request, res: Response, next: NextFunction) {
  const secret = appConfig.bootstrap.cronSecret;
  if (!secret) {
    res.status(503).json(
      createResponse({
        success: false,
        detail: 'CRON_SECRET is not configured',
      })
    );
    return;
  }
  const header = req.headers.authorization;
  const token =
    typeof header === 'string' && header.startsWith('Bearer ')
      ? header.slice('Bearer '.length)
      : undefined;
  if (!token || !secretsEqual(token, secret)) {
    res.status(401).json(
      createResponse({
        success: false,
        detail: 'Unauthorized',
      })
    );
    return;
  }
  next();
}

router.use(authorizeCron);

router.get('/:id', async (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!id) {
    res.status(400).json(
      createResponse({
        success: false,
        detail: 'Missing task id',
      })
    );
    return;
  }
  const task = TaskManager.list().find((entry) => entry.id === id);
  if (!task) {
    res.status(404).json(
      createResponse({
        success: false,
        detail: `Unknown task: ${id}`,
      })
    );
    return;
  }

  logger.info({ task: id }, 'running internal cron task');
  const result = await TaskManager.runNow(id);
  res.status(result.ok ? 200 : 500).json(
    createResponse({
      success: result.ok,
      detail: result.message,
    })
  );
});

export default router;
