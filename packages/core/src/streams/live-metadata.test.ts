import { describe, expect, it } from 'vitest';
import { attachLiveMetadata, providerTypeFromPreset } from './live-metadata.js';
import { MANUAL_STREAM_ADDON_ID } from '../main/channelMappings.js';
import type { ParsedStream } from '../db/index.js';

const manualAddon: ParsedStream['addon'] = {
  instanceId: MANUAL_STREAM_ADDON_ID,
  name: 'Manual HLS',
  manifestUrl: 'https://aiolivetv.local/manual',
  enabled: true,
  timeout: 10_000,
  preset: { id: '', type: 'manual', options: {} },
};

function stream(partial: Partial<ParsedStream> = {}): ParsedStream {
  return {
    id: 'preview',
    type: 'live',
    url: 'https://example.com/live.m3u8',
    filename: 'Caras TV FHD',
    addon: manualAddon,
    ...partial,
  };
}

describe('attachLiveMetadata', () => {
  it('marks a manual HLS URL as HLS and providerType manual', () => {
    const mapped = attachLiveMetadata(stream(), {
      channelId: 'aiolivetv:caras',
      channelName: 'Caras TV',
      mapping: {
        id: 'aiolivetv:caras',
        name: 'Caras TV',
        streams: [
          {
            addonId: MANUAL_STREAM_ADDON_ID,
            channelId: 'manual:https://example.com/live.m3u8',
            url: 'https://example.com/live.m3u8',
            name: 'Caras TV FHD',
            confidence: 0,
          },
        ],
      },
    });

    expect(mapped.live?.providerType).toBe('manual');
    expect(mapped.live?.matchStatus).toBe('manual');
    expect(mapped.live?.deliveryFormatLabel).toBe('HLS');
    expect(mapped.live?.deliveryFormatKnown).toBe(true);
    expect(mapped.live?.isHls).toBe(true);
    expect(mapped.live?.channelName).toBe('Caras TV');
    expect(mapped.parsedFile?.container).toBe('HLS');
  });

  it('maps an M3U addon preset to providerType m3u', () => {
    const mapped = attachLiveMetadata(
      stream({
        addon: {
          instanceId: 'm3u-1',
          name: 'M3U Brasil',
          manifestUrl: 'http://localhost/manifest.json',
          enabled: true,
          timeout: 10_000,
          preset: { id: 'm3u-1', type: 'm3u', options: {} },
        },
      }),
      { channelName: 'AXN' }
    );
    expect(mapped.live?.providerType).toBe('m3u');
    expect(mapped.live?.providerName).toBe('M3U Brasil');
  });

  it('copies canonical channel fields from context', () => {
    const mapped = attachLiveMetadata(stream(), {
      channelId: 'aiolivetv:axn',
      channelName: 'AXN HD',
      canonicalName: 'AXN',
      tvgId: 'AXN.br',
      country: 'BR',
      language: 'Portuguese (Brazil)',
      group: 'Filmes e Séries',
      logo: 'https://example.com/axn.png',
      epgProvider: true,
      hasSchedule: true,
    });

    expect(mapped.live).toMatchObject({
      channelId: 'aiolivetv:axn',
      channelName: 'AXN HD',
      canonicalName: 'AXN',
      tvgId: 'AXN.br',
      country: 'BR',
      language: 'Portuguese (Brazil)',
      group: 'Filmes e Séries',
      logo: 'https://example.com/axn.png',
      epgProvider: true,
      hasSchedule: true,
    });
  });

  it('keeps Unknown as a label and sets deliveryFormatKnown to false', () => {
    const mapped = attachLiveMetadata(
      stream({ url: 'https://provider.example.com/live/12345' })
    );
    expect(mapped.live?.deliveryFormat).toBe('unknown');
    expect(mapped.live?.deliveryFormatLabel).toBe('Unknown');
    expect(mapped.live?.deliveryFormatKnown).toBe(false);
    expect(mapped.parsedFile?.container).toBeUndefined();
  });

  it('exposes a redacted stream URL instead of credentials', () => {
    const mapped = attachLiveMetadata(
      stream({
        url: 'http://provider.example.com/live/user/pass/301.ts',
      })
    );
    expect(mapped.live?.streamUrl).toBe(
      'http://provider.example.com/live/user/pass/301.ts'
    );
    expect(mapped.live?.streamHost).toBe('provider.example.com');
    expect(mapped.live?.streamPathType).toBe('live');
    expect(mapped.live?.streamUrlSafe).toBe(
      'provider.example.com/live/.../301.ts'
    );
  });
});

describe('providerTypeFromPreset', () => {
  it('maps known presets including future local sources', () => {
    expect(providerTypeFromPreset('m3u')).toBe('m3u');
    expect(providerTypeFromPreset('hdhomerun')).toBe('hdhomerun');
    expect(providerTypeFromPreset('tvheadend')).toBe('tvheadend');
    expect(providerTypeFromPreset('jellyfin')).toBe('jellyfin');
    expect(providerTypeFromPreset('plex')).toBe('plex');
    expect(providerTypeFromPreset('nextpvr')).toBe('nextpvr');
    expect(providerTypeFromPreset('something-custom')).toBe('addon');
  });
});
