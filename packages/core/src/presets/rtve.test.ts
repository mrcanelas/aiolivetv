import { describe, expect, it, vi } from 'vitest';
import type { UserData } from '../db/schemas.js';

const { config } = vi.hoisted(() => ({
  config: {
    presets: {
      defaultTimeout: 7000,
      rtve: {
        url: ['https://rtve-stremio-addon.vercel.app'],
        defaultTimeout: null,
        defaultUserAgent: null,
      },
    },
    http: { defaultUserAgent: 'AIOLiveTV/test' },
    userLimits: { timeouts: { minTimeout: 1000, maxTimeout: 60000 } },
  },
}));
vi.mock('../config/index.js', () => ({ config }));
vi.mock('../utils/index.js', async () => ({
  constants: await import('../utils/constants.js'),
  RESOURCES: (await import('../utils/constants.js')).RESOURCES,
  appConfig: config,
  Cache: { getInstance: () => ({}) },
  createLogger: () => ({}),
}));
vi.mock('../parser/index.js', () => ({ StreamParser: class {} }));
vi.mock('../parser/streams.js', () => ({
  default: class {
    parse() {
      return { type: (this as any).getStreamType() };
    }
  },
}));
vi.mock('../builtins/mitv/index.js', () => ({ MI_TV_COUNTRIES: [] }));
vi.mock('../builtins/movistartv/index.js', () => ({ MOVISTAR_COUNTRIES: [] }));
vi.mock('../builtins/spain/addon.js', () => ({ SpainTvConfigSchema: {} }));
vi.mock('../builtins/tvheadend/index.js', () => ({}));
vi.mock('../builtins/plutotv/index.js', () => ({}));

const { RtvePreset } = await import('./liveTv.js');
const { CustomPreset } = await import('./custom.js');

describe('custom Live TV addon preset', () => {
  it('keeps the standard addon options without VOD media or library controls', async () => {
    const optionIds = CustomPreset.METADATA.OPTIONS.map((option) => option.id);
    expect(optionIds).not.toContain('mediaTypes');
    expect(optionIds).not.toContain('libraryAddon');
    const [addon] = await CustomPreset.generateAddons({} as UserData, {
      name: 'Live source',
      manifestUrl: 'https://example.com/manifest.json',
      resources: ['stream'],
      libraryAddon: true,
      mediaTypes: ['movie'],
      resultPassthrough: true,
    });
    expect(addon.mediaTypes).toEqual(['tv', 'channel']);
    expect(addon.library).toBeUndefined();
    expect(addon.resources).toEqual(['stream']);
    expect(addon.resultPassthrough).toBe(true);
  });
});

describe('RTVE external addon preset', () => {
  it('uses the existing external-addon options and live parser without claiming to be a builtin', () => {
    expect(RtvePreset.METADATA).not.toHaveProperty('BUILTIN');
    expect(RtvePreset.METADATA.SUPPORTED_RESOURCES).toEqual([
      'catalog',
      'meta',
      'stream',
    ]);
    expect(RtvePreset.METADATA.OPTIONS.map((option) => option.id)).toEqual([
      'name',
      'timeout',
      'resources',
      'url',
    ]);
    expect(
      RtvePreset.METADATA.OPTIONS.find((option) => option.id === 'resources')
        ?.showInSimpleMode
    ).toBe(true);
    const Parser = RtvePreset.getParser();
    expect(
      new Parser({} as any).parse({ url: 'https://example.com/live.m3u8' })
    ).toMatchObject({ type: 'live' });
  });

  it('generates the public manifest without modifying the UserData draft', async () => {
    const draft = { presets: [] } as unknown as UserData;
    const before = structuredClone(draft);
    const [addon] = await RtvePreset.generateAddons(draft, {});
    expect(addon).toMatchObject({
      manifestUrl: 'https://rtve-stremio-addon.vercel.app/manifest.json',
      resources: ['catalog', 'meta', 'stream'],
      timeout: 7000,
      resultPassthrough: true,
      preset: { type: 'rtve' },
    });
    expect(draft).toEqual(before);
  });

  it.each([
    'https://example.com/custom',
    'https://example.com/custom/manifest.json',
  ])(
    'preserves a custom installation path and resource selection: %s',
    async (url) => {
      const [addon] = await RtvePreset.generateAddons({} as UserData, {
        url,
        resources: ['stream'],
        name: 'My RTVE',
        timeout: 15000,
      });
      expect(addon.manifestUrl).toBe(
        'https://example.com/custom/manifest.json'
      );
      expect(addon.resources).toEqual(['stream']);
      expect(addon.name).toBe('My RTVE');
      expect(addon.timeout).toBe(15000);
    }
  );
});
