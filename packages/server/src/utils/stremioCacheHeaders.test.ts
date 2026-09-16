import { describe, expect, it } from 'vitest';
import { catalogExtrasAreCdnCacheable } from './stremioCacheHeaders.js';

describe('catalogExtrasAreCdnCacheable', () => {
  it('allows the default catalog page', () => {
    expect(catalogExtrasAreCdnCacheable(undefined)).toBe(true);
    expect(catalogExtrasAreCdnCacheable('skip=50')).toBe(true);
    expect(catalogExtrasAreCdnCacheable('genre=News')).toBe(true);
  });

  it('skips search results so dynamic queries are not frozen at the edge', () => {
    expect(catalogExtrasAreCdnCacheable('search=globo')).toBe(false);
    expect(catalogExtrasAreCdnCacheable('skip=0&search=sbt')).toBe(false);
  });
});
