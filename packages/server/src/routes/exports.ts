import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { request as undiciRequest } from 'undici';
import { z } from 'zod';
import {
  APIError,
  UserRepository,
  assertExportEnabled,
  assertExportProxyAllowed,
  assertSafeOutboundUrl,
  config as appConfig,
  constants,
  decryptString,
  encryptString,
  ExportPolicyError,
  getCachedM3u,
  getCachedXmltv,
  isEphemeralRuntime,
  isRedirectStatus,
  MAX_SSRF_REDIRECTS,
  resolveExportStream,
  resolveExportToken,
  rewriteHlsPlaylist,
  SsrfError,
} from '@aiolivetv/core';
import { corsMiddleware } from '../middlewares/cors.js';

const router: Router = Router();
router.use(corsMiddleware);

async function loadUserFromExportToken(token: string) {
  const { uuid, password } = await resolveExportToken(token);
  const userData = await UserRepository.getUser(uuid, password);
  if (!userData) {
    throw Object.assign(new Error('Invalid or revoked export token'), {
      code: 'unauthorized',
    });
  }
  return userData;
}

function handleExportError(error: unknown, next: NextFunction) {
  if (error instanceof ExportPolicyError || error instanceof SsrfError) {
    next(new APIError(constants.ErrorCode.FORBIDDEN, undefined, error.message));
    return;
  }
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: string }).code;
    if (code === 'unauthorized') {
      next(
        new APIError(
          constants.ErrorCode.UNAUTHORIZED,
          undefined,
          'Invalid or revoked export token'
        )
      );
      return;
    }
    if (code === 'not_found' || code === 'proxy_required') {
      next(
        new APIError(
          constants.ErrorCode.BAD_REQUEST,
          undefined,
          error instanceof Error ? error.message : 'Not found'
        )
      );
      return;
    }
  }
  next(error);
}

for (const [path, getBody, contentType] of [
  ['channels.m3u', getCachedM3u, 'application/vnd.apple.mpegurl'],
  ['guide.xml', getCachedXmltv, 'application/xml'],
] as const) {
  router.get(`/:token/${path}`, async (req, res, next) => {
    try {
      assertExportEnabled();
      const token = String(req.params.token);
      const userData = await loadUserFromExportToken(token);
      const body = await getBody(token, userData);
      const etag = `"${createHash('sha256').update(body).digest('hex')}"`;
      res.setHeader('Cache-Control', 'private, max-age=60');
      res.setHeader('CDN-Cache-Control', 'no-store');
      res.setHeader('ETag', etag);
      if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
      }
      res.setHeader('Content-Type', `${contentType}; charset=utf-8`);
      res.setHeader('Content-Disposition', `inline; filename="${path}"`);
      res.send(body);
    } catch (error) {
      handleExportError(error, next);
    }
  });
}

const SegmentSchema = z.object({
  kind: z.literal('export-segment'),
  token: z.string(),
  u: z.string().url(),
  h: z.record(z.string(), z.string()),
});

async function proxyStream(
  req: Request,
  res: Response,
  token: string,
  initialUrl: string,
  initialHeaders: Record<string, string> = {}
) {
  assertExportProxyAllowed();
  if (isEphemeralRuntime()) {
    throw new APIError(
      constants.ErrorCode.FORBIDDEN,
      undefined,
      'Export stream proxy is disabled on ephemeral runtimes'
    );
  }
  const abort = new AbortController();
  const onClose = () => {
    if (!res.writableFinished) abort.abort();
  };
  req.on('aborted', onClose);
  res.on('close', onClose);
  let url = new URL(initialUrl);
  let headers = initialHeaders;
  try {
    for (let redirects = 0; ; redirects++) {
      if (!['http:', 'https:'].includes(url.protocol))
        throw new SsrfError('Invalid stream protocol');
      if (!appConfig.bootstrap.allowPrivateUrls)
        await assertSafeOutboundUrl(url);
      const upstream = await undiciRequest(url, {
        method: 'GET',
        headers: {
          'User-Agent': appConfig.http.defaultUserAgent,
          ...headers,
          ...(req.headers.range ? { Range: req.headers.range } : {}),
        },
        signal: abort.signal,
        bodyTimeout: 0,
        headersTimeout: 30_000,
      });
      if (isRedirectStatus(upstream.statusCode)) {
        upstream.body.destroy();
        const location = upstream.headers.location;
        if (typeof location !== 'string' || redirects >= MAX_SSRF_REDIRECTS)
          throw new Error('Invalid upstream redirect');
        const target = new URL(location, url);
        if (target.origin !== url.origin) headers = {};
        url = target;
        continue;
      }
      if (upstream.statusCode >= 400) {
        upstream.body.destroy();
        res.status(upstream.statusCode).end();
        return;
      }
      const contentType = upstream.headers['content-type'];
      const isHls =
        (typeof contentType === 'string' &&
          /mpegurl|m3u8/i.test(contentType)) ||
        /\.m3u8$/i.test(url.pathname);
      res.setHeader('Cache-Control', 'no-store');
      if (isHls) {
        const chunks: Buffer[] = [];
        let size = 0;
        try {
          for await (const chunk of upstream.body) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += buffer.length;
            if (size > 2 * 1024 * 1024)
              throw new Error('HLS playlist too large');
            chunks.push(buffer);
          }
        } finally {
          upstream.body.destroy();
        }
        const rewritten = rewriteHlsPlaylist(
          Buffer.concat(chunks).toString('utf8'),
          url.toString(),
          (asset) => {
            const encrypted = encryptString(
              JSON.stringify({
                kind: 'export-segment',
                token,
                u: asset.toString(),
                h: asset.origin === url.origin ? headers : {},
              })
            );
            if (!encrypted.success || !encrypted.data)
              throw new Error('Failed to protect HLS URL');
            return `${appConfig.bootstrap.baseUrl.replace(/\/+$/, '')}/exports/${token}/segment/${encrypted.data}`;
          }
        );
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(rewritten);
        return;
      }
      res.status(upstream.statusCode);
      for (const name of [
        'content-type',
        'content-range',
        'accept-ranges',
        'content-length',
      ]) {
        const value = upstream.headers[name];
        if (value !== undefined) res.setHeader(name, value);
      }
      await pipeline(upstream.body, res);
      return;
    }
  } catch (error) {
    if (!abort.signal.aborted && !req.aborted) throw error;
  } finally {
    req.off('aborted', onClose);
    res.off('close', onClose);
  }
}

router.get('/:token/play/:channelId', async (req, res, next) => {
  try {
    assertExportEnabled();
    const token = String(req.params.token);
    const userData = await loadUserFromExportToken(token);
    const resolved = await resolveExportStream(
      userData,
      String(req.params.channelId)
    );
    if (resolved.mode === 'redirect') {
      res.setHeader('Cache-Control', 'no-store');
      res.redirect(302, resolved.url);
      return;
    }
    await proxyStream(req, res, token, resolved.url, resolved.headers);
  } catch (error) {
    handleExportError(error, next);
  }
});

router.get('/:token/segment/:payload', async (req, res, next) => {
  try {
    assertExportEnabled();
    const token = String(req.params.token);
    await loadUserFromExportToken(token);
    const decrypted = decryptString(String(req.params.payload));
    let parsed: z.infer<typeof SegmentSchema>;
    try {
      parsed = SegmentSchema.parse(
        JSON.parse(
          decrypted.success && decrypted.data ? decrypted.data : 'null'
        )
      );
      if (parsed.token !== token) throw new Error('Token mismatch');
    } catch {
      throw new APIError(
        constants.ErrorCode.BAD_REQUEST,
        undefined,
        'Invalid segment'
      );
    }
    await proxyStream(req, res, token, parsed.u, parsed.h);
  } catch (error) {
    handleExportError(error, next);
  }
});

export default router;
