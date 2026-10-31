import { describe, expect, it } from 'vitest';
import { isDashboardSettingsKeyVisible, tabFor } from '../tabs.config';

describe('TMDB instance settings', () => {
  it('exposes the existing secret fields under Metadata', () => {
    expect(isDashboardSettingsKeyVisible('metadata.tmdb.apiKey')).toBe(true);
    expect(isDashboardSettingsKeyVisible('metadata.tmdb.accessToken')).toBe(
      true
    );
    expect(tabFor('metadata').label).toBe('Metadata');
  });

  it('keeps unrelated metadata and service settings hidden', () => {
    expect(isDashboardSettingsKeyVisible('metadata.tvdb.apiKey')).toBe(false);
    expect(
      isDashboardSettingsKeyVisible('metadata.animeDb.levelOfDetail')
    ).toBe(false);
    expect(isDashboardSettingsKeyVisible('services.realDebrid')).toBe(false);
    expect(isDashboardSettingsKeyVisible('api.port')).toBe(true);
  });
});
