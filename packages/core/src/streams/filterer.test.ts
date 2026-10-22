import { describe, expect, it, vi } from 'vitest';
import type { ParsedStream, UserData } from '../db/schemas.js';
import { StreamContext } from './context.js';
import StreamFilterer from './filterer.js';

vi.mock('../parser/streamExpression.js', () => ({
  StreamSelector: class {},
  extractNamesFromExpression: () => [],
}));

vi.mock('../utils/index.js', async () => ({
  constants: await import('../utils/constants.js'),
  createLogger: () => ({ debug() {}, info() {}, silly() {}, warn() {} }),
  RegexAccess: { isRegexAllowed: async () => true },
  getTimeTakenSincePoint: () => '0ms',
}));

function stream(
  id: string,
  bitrate?: number,
  resolution = '1080p'
): ParsedStream {
  return {
    id,
    type: 'live',
    bitrate,
    addon: {
      name: 'Live source',
      manifestUrl: 'https://example.com/manifest.json',
      enabled: true,
      timeout: 5000,
      preset: { id: 'source', type: 'm3u', options: {} },
    },
    parsedFile: {
      resolution,
      encode: 'HEVC',
      languages: ['Portuguese'],
      visualTags: [],
      audioTags: [],
      audioChannels: [],
    },
  } as ParsedStream;
}

describe('Live TV stream filtering', () => {
  it('uses stream bitrate and retains resolution, language and codec filtering without VOD metadata', async () => {
    const data = {
      requiredResolutions: ['1080p'],
      requiredLanguages: ['Portuguese'],
      requiredEncodes: ['HEVC'],
      bitrate: { global: [1_000_000, 10_000_000] },
    } as UserData;
    const context = StreamContext.create('tv', 'live-channel', data);
    const streams = [
      stream('working', 5_000_000),
      stream('too-low', 500_000),
      stream('too-high', 20_000_000),
      stream('unknown-bitrate'),
      stream('wrong-resolution', 5_000_000, '720p'),
      {
        ...stream('wrong-language', 5_000_000),
        parsedFile: { ...stream('x').parsedFile!, languages: ['English'] },
      },
      {
        ...stream('wrong-codec', 5_000_000),
        parsedFile: { ...stream('x').parsedFile!, encode: 'AVC' },
      },
    ];
    const filterer = new StreamFilterer(data);
    expect(
      (await filterer.filter(streams, context)).map((item) => item.id)
    ).toEqual(['working', 'unknown-bitrate']);
    expect(context.toExpressionContext()).toEqual({
      type: 'tv',
      id: 'live-channel',
      queryType: 'tv',
    });
    expect(filterer.getFilterStatistics().removed.bitrate.total).toBe(2);
  });
});
