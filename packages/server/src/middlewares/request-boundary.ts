import { NextFunction, Request, Response } from 'express';
import {
  createLogger,
  flushAnalyticsNow,
  isEphemeralRuntime,
  refreshSettingsAtRequestBoundary,
} from '@aiolivetv/core';

const logger = createLogger('server');

export async function requestBoundaryMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    await refreshSettingsAtRequestBoundary();
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'settings refresh at request boundary failed'
    );
  }

  if (isEphemeralRuntime()) {
    res.on('finish', () => {
      void flushAnalyticsNow().catch(() => undefined);
    });
  }

  next();
}
