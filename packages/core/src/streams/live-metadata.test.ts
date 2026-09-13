import { describe, expect, it } from 'vitest';
import { attachLiveMetadata } from './live-metadata.js';
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
});
