import { Router, type NextFunction, type Request, type Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { request as undiciRequest } from 'undici';
import { z } from 'zod';
import {
  APIError,
  apiBaseUrl,
  appConfig,
  assertTvheadendProxyAllowed,
  assertTvheadendUrlAllowed,
  classifyStreamFailure,
  constants,
  createLogger,
  decryptTvheadendProxyPayload,
  isEphemeralRuntime,
  makeUrlLogSafe,
  normalizeTvheadendUrl,
  openUpstreamStream,
  resolveTvheadendAssetUrl,
  testTvheadendConnection,
  TvheadendPolicyError,
} from '@aiolivetv/core';
import { createResponse } from '../../utils/responses.js';
import { corsMiddleware } from '../../middlewares/cors.js';

const router: Router = Router();
const logger = createLogger('tvheadend');

router.use(corsMiddleware);

const TestBodySchema = z.object({
  url: z.string().min(1),
  username: z.string().optional().default(''),
  password: z.string().optional().default(''),
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
      const result = await testTvheadendConnection({
        url: body.url,
        username: body.username,
        password: body.password,
        timeout: body.timeout,
      });
      // Always success at the HTTP/API envelope level so the SPA can show
      // structured probe outcomes (blocked, unauthorized, …) without treating
      // them as transport failures.
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

router.all(
  '/proxy/:token',
  async (req: Request, res: Response, next: NextFunction) => {
    if (isEphemeralRuntime()) {
      next(
        new APIError(
          constants.ErrorCode.FORBIDDEN,
          undefined,
          'TVHeadend proxy is disabled on ephemeral runtimes (e.g. Vercel)'
        )
      );
      return;
    }

    const abort = new AbortController();
    const onClose = () => abort.abort();
    req.on('close', onClose);
    res.on('close', onClose);

    try {
      assertTvheadendProxyAllowed();
      const token = Array.isArray(req.params.token)
        ? req.params.token[0]
        : req.params.token;
      if (!token) {
        throw new APIError(
          constants.ErrorCode.BAD_REQUEST,
          undefined,
          'Missing proxy token'
        );
      }
      const payload = decryptTvheadendProxyPayload(token);
      const base = apiBaseUrl(payload.config);
      await assertTvheadendUrlAllowed(base);

      if (payload.kind === 'logo') {
        const asset =
          resolveTvheadendAssetUrl(base, payload.assetPath) ||
          resolveTvheadendAssetUrl(
            normalizeTvheadendUrl(payload.config.playbackUrl || base),
            payload.assetPath
          );
        if (!asset) {
          throw new APIError(
            constants.ErrorCode.BAD_REQUEST,
            undefined,
            'Invalid logo asset'
          );
        }
        await assertTvheadendUrlAllowed(asset);
        const auth =
          payload.config.username || payload.config.password
            ? `Basic ${Buffer.from(
                `${payload.config.username ?? ''}:${payload.config.password ?? ''}`,
                'utf8'
              ).toString('base64')}`
            : undefined;
        const upstream = await undiciRequest(asset, {
          method: 'GET',
          headers: {
            ...(auth ? { Authorization: auth } : {}),
            'User-Agent': appConfig.http.defaultUserAgent,
          },
          signal: abort.signal,
        });
        if (upstream.statusCode >= 400) {
          upstream.body.destroy();
          res.status(upstream.statusCode).end();
          return;
        }
        res.status(upstream.statusCode);
        const contentType = upstream.headers['content-type'];
        if (typeof contentType === 'string') {
          res.setHeader('Content-Type', contentType);
        }
        res.setHeader('Cache-Control', 'private, max-age=3600');
        await pipeline(upstream.body, res);
        return;
      }

      if (!payload.channelUuid) {
        throw new APIError(
          constants.ErrorCode.BAD_REQUEST,
          undefined,
          'Missing channel'
        );
      }

      const { response: upstream } = await openUpstreamStream(
        payload.config,
        payload.channelUuid,
        abort.signal
      );

      if (upstream.statusCode >= 400) {
        let hint = '';
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of upstream.body) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            if (Buffer.concat(chunks).length > 2048) break;
          }
          hint = Buffer.concat(chunks).toString('utf8');
        } catch {
          hint = '';
        }
        upstream.body.destroy();
        const message = classifyStreamFailure(upstream.statusCode, hint);
        logger.warn(
          {
            status: upstream.statusCode,
            channelUuid: payload.channelUuid,
          },
          message
        );
        res.status(upstream.statusCode).json(
          createResponse({
            success: false,
            detail: message,
          })
        );
        return;
      }

      res.status(upstream.statusCode);
      for (const [key, value] of Object.entries(upstream.headers)) {
        if (value === undefined) continue;
        const lower = key.toLowerCase();
        if (
          [
            'connection',
            'transfer-encoding',
            'keep-alive',
            'proxy-authenticate',
            'proxy-authorization',
            'host',
            'content-length',
          ].includes(lower)
        ) {
          continue;
        }
        res.setHeader(key, value as string | string[]);
      }
      res.setHeader('Cache-Control', 'no-store');

      await pipeline(upstream.body, res);
    } catch (error) {
      if (abort.signal.aborted || req.aborted) {
        return;
      }
      if (error instanceof TvheadendPolicyError) {
        next(
          new APIError(
            constants.ErrorCode.FORBIDDEN,
            undefined,
            error.message
          )
        );
        return;
      }
      logger.error(
        {
          err: error instanceof Error ? error.message : String(error),
          url: makeUrlLogSafe(String(req.originalUrl || '')),
        },
        'tvheadend proxy failed'
      );
      next(error);
    } finally {
      req.off('close', onClose);
      res.off('close', onClose);
    }
  }
);

export default router;
