import type { Response } from 'express';

const NO_STORE = 'private, no-store, no-cache, must-revalidate';

export function catalogExtrasAreCdnCacheable(extras?: string) {
  if (!extras) return true;
  const params = extras.replace(/^\//, '');
  return !/(?:^|[?&])search=/.test(params);
}

function applyCdnCache(res: Response, value: string) {
  res.setHeader('Cache-Control', value);
  res.setHeader('CDN-Cache-Control', value);
  res.setHeader('Vercel-CDN-Cache-Control', value);
}

export function setStremioStreamCacheHeaders(res: Response) {
  applyCdnCache(res, NO_STORE);
}

export function setStremioCatalogCacheHeaders(
  res: Response,
  options: { cacheable: boolean; maxAge?: number; staleRevalidate?: number }
) {
  if (!options.cacheable) {
    applyCdnCache(res, NO_STORE);
    return;
  }
  const maxAge = options.maxAge ?? 300;
  const staleRevalidate = options.staleRevalidate ?? 1800;
  applyCdnCache(
    res,
    `public, s-maxage=${maxAge}, stale-while-revalidate=${staleRevalidate}, stale-if-error=86400`
  );
}

export function setStremioMetaCacheHeaders(
  res: Response,
  options: { cacheable: boolean; maxAge?: number; staleRevalidate?: number }
) {
  if (!options.cacheable) {
    applyCdnCache(res, NO_STORE);
    return;
  }
  const maxAge = options.maxAge ?? 900;
  const staleRevalidate = options.staleRevalidate ?? 3600;
  applyCdnCache(
    res,
    `public, s-maxage=${maxAge}, stale-while-revalidate=${staleRevalidate}, stale-if-error=86400`
  );
}
