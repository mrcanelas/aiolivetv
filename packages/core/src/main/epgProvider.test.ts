import { describe, expect, it } from 'vitest';
import type { Manifest } from '../db/index.js';
import {
  addonProvidesNativeEpg,
  configurationProvidesNativeEpg,
} from './epgProvider.js';

const xmltvManifest: Manifest = {
  id: 'org.aiolivetv.xmltv',
  name: 'XMLTV',
  version: '1.0.0',
  types: ['tv'],
  resources: [
    { name: 'catalog', types: ['tv'], idPrefixes: ['aiolivetv:'] },
    { name: 'meta', types: ['tv'], idPrefixes: ['aiolivetv:'] },
  ],
  catalogs: [
    {
      id: 'aiolivetv-channels',
      type: 'tv',
      name: 'Channels',
      extra: [{ name: 'skip' }, { name: 'date' }],
    },
  ],
  behaviorHints: { epgProvider: true },
};

const m3uManifest: Manifest = {
  id: 'org.aiolivetv.m3u',
  name: 'M3U',
  version: '1.0.0',
  types: ['tv'],
  resources: [
    { name: 'catalog', types: ['tv'], idPrefixes: ['aiolivetv:'] },
    { name: 'meta', types: ['tv'], idPrefixes: ['aiolivetv:'] },
    { name: 'stream', types: ['tv'], idPrefixes: ['aiolivetv:'] },
  ],
  catalogs: [{ id: 'aiolivetv-channels', type: 'tv', name: 'Channels' }],
};

describe('addonProvidesNativeEpg', () => {
  it('is true for an XMLTV guide with epgProvider and date extra', () => {
    expect(addonProvidesNativeEpg(xmltvManifest)).toBe(true);
  });

  it('is false for an M3U playlist without EPG', () => {
    expect(addonProvidesNativeEpg(m3uManifest)).toBe(false);
  });

  it('is false when epgProvider is claimed without a date extra', () => {
    expect(
      addonProvidesNativeEpg({
        ...xmltvManifest,
        catalogs: [{ id: 'channels', type: 'tv', name: 'Channels' }],
      })
    ).toBe(false);
  });

  it('is false when the catalog resource is disabled', () => {
    expect(addonProvidesNativeEpg(xmltvManifest, ['meta'])).toBe(false);
  });
});

describe('configurationProvidesNativeEpg', () => {
  it('is true when any enabled source provides a real guide', () => {
    expect(
      configurationProvidesNativeEpg(
        [
          { instanceId: 'xmltv-1', resources: ['catalog', 'meta'] },
          { instanceId: 'm3u-1', resources: ['catalog', 'meta', 'stream'] },
        ],
        { 'xmltv-1': xmltvManifest, 'm3u-1': m3uManifest }
      )
    ).toBe(true);
  });

  it('is false for M3U-only configurations', () => {
    expect(
      configurationProvidesNativeEpg(
        [{ instanceId: 'm3u-1', resources: ['catalog', 'meta', 'stream'] }],
        { 'm3u-1': m3uManifest }
      )
    ).toBe(false);
  });

  it('is false when XMLTV is present but catalog is turned off', () => {
    expect(
      configurationProvidesNativeEpg(
        [{ instanceId: 'xmltv-1', resources: ['meta'] }],
        { 'xmltv-1': xmltvManifest }
      )
    ).toBe(false);
  });
});
