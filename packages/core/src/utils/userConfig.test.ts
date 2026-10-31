import { describe, expect, it, vi } from 'vitest';
import { UserDataSchema, type UserData } from '../db/schemas.js';
import { applyMigrations, normalizeUserData } from './userConfig.js';

vi.mock('../config/index.js', () => ({ config: {} }));

function legacyConfig(): UserData & Record<string, unknown> {
  return {
    presets: [
      {
        instanceId: 'playlist',
        type: 'm3u',
        enabled: true,
        options: { sourceUrl: 'https://example.com/list.m3u' },
      },
    ],
    formatter: { id: 'gdrive' },
    sortCriteria: {
      global: [
        { key: 'cached', direction: 'desc' },
        { key: 'resolution', direction: 'asc' },
      ],
    },
    preferredResolutions: ['720p', '1080p'],
    preferredLanguages: ['Portuguese'],
    services: [{ id: 'realdebrid', enabled: false, credentials: {} }],
    excludedQualities: ['CAM'],
    enableSeadex: true,
    checkOwned: true,
    autoPlay: { enabled: true },
    precacheNextEpisode: true,
    precacheSelector: 'streams',
    preloadStreams: { enabled: true },
    cacheAndPlay: { enabled: true },
    deduplicator: {
      enabled: true,
      live: 'disabled',
      http: 'disabled',
      cached: 'single_result',
    },
    proxy: { id: 'builtin', proxiedServices: [] },
    regexOverrides: [],
    tmdbApiKey: 'keep-this-key',
    enrichEpgWithTmdb: true,
    epgMetadataLanguage: 'pt-BR',
    channelMappings: [
      {
        id: 'channel',
        enabled: false,
        hidden: true,
        epgSource: { addonId: 'guide', channelId: 'other' },
        streams: [{ addonId: 'playlist', channelId: 'stream', confidence: 1 }],
      },
    ],
  };
}

describe('shared Live TV user configuration', () => {
  it('keeps bitrate ranges without movie, episode or runtime settings', () => {
    const clean = applyMigrations({
      ...legacyConfig(),
      bitrate: {
        useMetadataRuntime: true,
        global: { movies: [1, 2], series: [1_000_000, 10_000_000] },
        resolution: { '1080p': { series: [2_000_000, 20_000_000] } },
      },
    });
    expect(clean.bitrate).toEqual({
      global: [1_000_000, 10_000_000],
      resolution: { '1080p': [2_000_000, 20_000_000] },
    });
    expect(UserDataSchema.shape.bitrate.parse(clean.bitrate)).toEqual(
      clean.bitrate
    );
  });

  it('does not expose retired VOD fields in the configuration schema', () => {
    for (const key of [
      'excludedQualities',
      'enableSeadex',
      'size',
      'titleMatching',
      'yearMatching',
      'seasonEpisodeMatching',
      'autoPlay',
      'areYouStillThere',
      'precacheNextEpisode',
      'preloadStreams',
      'cacheAndPlay',
      'nzbFailover',
      'serviceWrap',
      'checkOwned',
      'externalDownloads',
      'autoRemoveDownloads',
    ]) {
      expect(UserDataSchema.shape).not.toHaveProperty(key);
    }
    expect(Object.keys(UserDataSchema.shape.sortCriteria.shape)).toEqual([
      'global',
    ]);
  });

  it('removes retired custom addon controls without mutating the draft', () => {
    const data = legacyConfig();
    data.presets[0] = {
      ...data.presets[0],
      type: 'custom',
      options: {
        manifestUrl: 'https://example.com/manifest.json',
        mediaTypes: ['movie'],
        libraryAddon: true,
        resultPassthrough: true,
      },
    };
    const clean = normalizeUserData(data);
    expect(clean.presets[0].options).toEqual({
      manifestUrl: 'https://example.com/manifest.json',
      resultPassthrough: true,
    });
    expect(data.presets[0].options.libraryAddon).toBe(true);
    expect(clean.channelMappings).toBe(data.channelMappings);
  });

  it('removes VOD settings while preserving channel identities, sources, credentials and preferences', () => {
    const original = legacyConfig();
    const snapshot = structuredClone(original);
    const clean = applyMigrations(original);
    expect(original).toEqual(snapshot);
    for (const key of [
      'enrichEpgWithTmdb',
      'services',
      'excludedQualities',
      'enableSeadex',
      'checkOwned',
      'autoPlay',
      'precacheNextEpisode',
      'precacheSelector',
      'preloadStreams',
      'cacheAndPlay',
      'deduplicator',
      'proxy',
      'regexOverrides',
    ]) {
      expect(clean).not.toHaveProperty(key);
    }
    expect(clean.sortCriteria).toEqual({
      global: [{ key: 'resolution', direction: 'asc' }],
    });
    expect(clean.presets).toEqual(original.presets);
    expect(clean.channelMappings).toEqual(original.channelMappings);
    expect(clean.preferredResolutions).toEqual(original.preferredResolutions);
    expect(clean.preferredLanguages).toEqual(original.preferredLanguages);
    expect(clean.tmdbApiKey).toBe(original.tmdbApiKey);
    expect(clean.epgMetadataLanguage).toBe('pt-BR');
    expect(applyMigrations(JSON.parse(JSON.stringify(clean)))).toEqual(clean);
  });

  it('retains configured services and proxies even when they are disabled', () => {
    const data = legacyConfig();
    data.services = [
      {
        id: 'realdebrid',
        enabled: false,
        credentials: { apiKey: 'saved-secret' },
      },
      { id: 'alldebrid', enabled: true, credentials: {} },
      { id: 'premiumize', enabled: false, credentials: { apiKey: '' } },
    ];
    data.proxy = {
      id: 'mediaflow',
      enabled: false,
      url: 'https://example.com/proxy',
      credentials: 'saved-password',
    };
    const clean = applyMigrations(data);
    expect(clean.services).toEqual(data.services.slice(0, 2));
    expect(clean.proxy).toEqual(data.proxy);
  });

  it('keeps deduplication rules that apply to live streams', () => {
    const data = legacyConfig();
    data.deduplicator = {
      enabled: true,
      live: 'single_result',
      http: 'per_addon',
      keys: ['filename'],
    };
    expect(applyMigrations(data).deduplicator).toEqual(data.deduplicator);
  });

  it('does not clone the channel inventory on draft edits or erase shared disabled settings', () => {
    const data = legacyConfig();
    data.statistics = { enabled: false, showFilterStatsOnNoStreams: false };
    data.streamProbe = { enabled: false, timeoutMs: 5000 };
    const clean = normalizeUserData(data);
    expect(clean.channelMappings).toBe(data.channelMappings);
    expect(clean.presets).toBe(data.presets);
    expect(clean.statistics).toEqual(data.statistics);
    expect(clean.streamProbe).toEqual(data.streamProbe);
  });

  it('removes retired parent overrides while preserving authentication and supported overrides', () => {
    const data = legacyConfig();
    data.parentConfig = {
      uuid: '00000000-0000-4000-8000-000000000001',
      password: 'parent-password',
      mergeStrategies: {
        presets: 'inherit',
        services: 'inherit',
        filters: 'inherit',
        sorting: 'inherit',
        formatter: 'inherit',
        proxy: 'inherit',
        metadata: 'inherit',
        misc: 'inherit',
        branding: 'inherit',
        fieldOverrides: {
          enableSeadex: 'override',
          preferredResolutions: 'override',
        },
      },
    };
    const clean = applyMigrations(data);
    expect(clean.parentConfig?.password).toBe('parent-password');
    expect(clean.parentConfig?.mergeStrategies?.fieldOverrides).toEqual({
      preferredResolutions: 'override',
    });
    expect(data.parentConfig.mergeStrategies?.fieldOverrides).toHaveProperty(
      'enableSeadex'
    );
  });

  it('keeps existing migrations for identities, access keys, formatter definitions and addon pins', () => {
    const clean = applyMigrations({
      ...legacyConfig(),
      accessToken: 'legacy-access',
      formatter: {
        id: 'custom',
        definition: { name: 'name', description: 'description' },
      },
      catalogModifications: [{ id: 'aiostreams.merged.live-tv', type: 'tv' }],
      presets: [
        { instanceId: 'playlist', type: 'm3u', options: { forceToTop: true } },
      ],
    });
    expect(clean.accessKey).toBe('legacy-access');
    expect(clean).not.toHaveProperty('accessToken');
    expect(clean.catalogModifications?.[0].id).toBe('aiolivetv.merged.live-tv');
    expect(clean.presets[0].options.pinPosition).toBe('top');
    expect(clean.formatter.definitions?.custom).toEqual({
      name: 'name',
      description: 'description',
    });
  });

  it.each([null, [], 'invalid', 1])(
    'rejects a configuration with a non-object root (%j)',
    (value) => {
      expect(() => applyMigrations(value)).toThrow(
        'Configuration must be a JSON object'
      );
    }
  );
});
