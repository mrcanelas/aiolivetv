import { config as appConfig } from '../config/index.js';
import { Cache } from '../utils/index.js';
import type { MetaPreview } from '../db/schemas.js';
import type { AIOStreamsCatalogResponse } from './types.js';

export const shuffleCache = Cache.getInstance<string, MetaPreview[]>('shuffle');

export type MergedCatalogSkipState = {
  sourceSkips: Record<string, number>; // What skip to send to each upstream source
  catalog?: AIOStreamsCatalogResponse;
};
export const mergedCatalogCache = Cache.getInstance<
  string,
  MergedCatalogSkipState
>('merged_catalog');

export const precacheCache = Cache.getInstance<string, boolean>(
  'precache',
  undefined,
  appConfig.bootstrap.redisUri ? 'redis' : 'memory'
);
