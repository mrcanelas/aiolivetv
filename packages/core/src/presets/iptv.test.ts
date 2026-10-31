import { describe, expect, it, vi } from 'vitest';
import type { UserData } from '../db/schemas.js';

vi.mock('../config/index.js', () => ({
  config: {
    bootstrap: { internalUrl: 'http://internal' },
    resources: {
      liveTvSourceMaxBytes: 50 * 1024 * 1024,
      iptvEpgSourceMaxBytes: 100 * 1024 * 1024,
    },
    presets: { defaultTimeout: 7000 },
    http: { defaultUserAgent: 'AIOLiveTV/test' },
    userLimits: { timeouts: { minTimeout: 1000, maxTimeout: 60000 } },
  },
}));
vi.mock('../utils/index.js', async () => ({
  constants: await import('../utils/constants.js'),
  RESOURCES: (await import('../utils/constants.js')).RESOURCES,
  appConfig: (await import('../config/index.js')).config,
  toUrlSafeBase64: (value: string) => Buffer.from(value).toString('base64url'),
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

const { IptvOrgPreset, IptvEpgPreset } = await import('./iptv.js');
function config(addon: { manifestUrl: string }) {
  return JSON.parse(
    Buffer.from(addon.manifestUrl.split('/').at(-2)!, 'base64url').toString()
  );
}

describe('IPTV builtin presets', () => {
  it('keeps the two roles independent and provides country selection', () => {
    expect(IptvOrgPreset.METADATA).toMatchObject({
      BUILTIN: true,
      SUPPORTED_RESOURCES: ['catalog', 'meta', 'stream'],
      CATEGORY: 'streams',
    });
    expect(IptvEpgPreset.METADATA.SUPPORTED_RESOURCES).toEqual([
      'catalog',
      'meta',
    ]);
    expect(
      IptvOrgPreset.METADATA.OPTIONS.find((o) => o.id === 'countries')?.options
    ).toContainEqual({ label: 'United Kingdom', value: 'uk' });
    expect(
      IptvEpgPreset.METADATA.OPTIONS.find((o) => o.id === 'countries')?.options
    ).toContainEqual({ label: 'United Kingdom', value: 'gb' });
    const Parser = IptvOrgPreset.getParser();
    expect(
      new Parser({} as any).parse({ url: 'https://example.com/live.m3u8' })
    ).toMatchObject({ type: 'live' });
  });

  it('generates stable, distinct instances for multiple countries without mutating the draft', async () => {
    const draft = { presets: [] } as unknown as UserData;
    const before = structuredClone(draft);
    const addons = await IptvOrgPreset.generateAddons(draft, {
      countries: ['GB', 'uk', 'br'],
      resources: ['catalog', 'meta', 'stream'],
    });
    expect(addons.map((a) => a.identifier)).toEqual(['uk', 'br']);
    expect(addons.map((a) => a.resources)).toEqual([
      ['catalog', 'meta', 'stream'],
      ['catalog', 'meta', 'stream'],
    ]);
    expect(addons[0].name).toBe('IPTV-org (United Kingdom)');
    expect(config(addons[0])).toMatchObject({
      country: 'uk',
      timeout: 30000,
      maxBytes: 50 * 1024 * 1024,
    });
    expect(draft).toEqual(before);
  });

  it('keeps guide resource selection, time shift, and its own source byte limit', async () => {
    const [addon] = await IptvEpgPreset.generateAddons({} as UserData, {
      countries: ['UK'],
      resources: ['meta'],
      timeShiftMinutes: -60,
    });
    expect(addon.resources).toEqual(['meta']);
    expect(addon.manifestUrl).toContain('/builtins/live-tv/iptv-epg/');
    expect(config(addon)).toMatchObject({
      country: 'gb',
      timeShiftMinutes: -60,
      maxBytes: 100 * 1024 * 1024,
    });
    await expect(
      IptvEpgPreset.generateAddons({} as UserData, { resources: ['stream'] })
    ).rejects.toThrow();
    await expect(
      IptvOrgPreset.generateAddons({} as UserData, { countries: [] })
    ).rejects.toThrow();
  });

  it('defaults to standalone channels and allows stream-only use with a guide', async () => {
    const [standalone] = await IptvOrgPreset.generateAddons({} as UserData, {});
    expect(standalone.resources).toEqual(['catalog', 'meta', 'stream']);
    const [streamOnly] = await IptvOrgPreset.generateAddons({} as UserData, {
      resources: ['stream'],
    });
    expect(streamOnly.resources).toEqual(['stream']);
    await expect(
      IptvOrgPreset.generateAddons({} as UserData, { resources: ['invalid'] })
    ).rejects.toThrow();
  });
});
