import { describe, expect, it } from 'vitest';
import {
  formatProbedStreamSummary,
  mergeDeclaredAndProbed,
  parseFfprobeJson,
  probedStreamToParsedFile,
} from './probed.js';

const SAMPLE_FFPROBE = JSON.stringify({
  streams: [
    {
      codec_type: 'video',
      codec_name: 'hevc',
      width: 1920,
      height: 1080,
      bit_rate: '4500000',
    },
    {
      codec_type: 'audio',
      codec_name: 'aac',
      channels: 2,
      channel_layout: 'stereo',
    },
  ],
  format: {
    format_name: 'hls',
    duration: '0.000000',
  },
});

describe('parseFfprobeJson', () => {
  it('maps video and audio streams', () => {
    const probed = parseFfprobeJson('https://example.com/live.m3u8', SAMPLE_FFPROBE);
    expect(probed.videoCodec).toBe('hevc');
    expect(probed.height).toBe(1080);
    expect(probed.format).toBe('hls');
    expect(probed.audioChannelLayout).toBe('stereo');
  });
});

describe('probedStreamToParsedFile', () => {
  it('normalizes codec and resolution for formatters', () => {
    const probed = parseFfprobeJson('https://example.com/live.m3u8', SAMPLE_FFPROBE);
    const parsed = probedStreamToParsedFile(probed);
    expect(parsed.resolution).toBe('1080p');
    expect(parsed.encode).toBe('HEVC');
    expect(parsed.audioChannels).toEqual(['2.0']);
    expect(parsed.audioTags).toEqual(['AAC']);
  });
});

describe('mergeDeclaredAndProbed', () => {
  it('prefers probed technical fields over declared labels', () => {
    const merged = mergeDeclaredAndProbed(
      {
        audioChannels: [],
        visualTags: [],
        audioTags: [],
        languages: ['Portuguese'],
        resolution: '720p',
        encode: 'H.264',
      },
      {
        resolution: '1080p',
        encode: 'HEVC',
        audioChannels: ['5.1'],
        audioTags: [],
        visualTags: [],
        languages: [],
      }
    );
    expect(merged?.resolution).toBe('1080p');
    expect(merged?.encode).toBe('HEVC');
    expect(merged?.languages).toEqual(['Portuguese']);
    expect(merged?.audioChannels).toEqual(['5.1']);
  });
});

describe('formatProbedStreamSummary', () => {
  it('builds a compact label', () => {
    const probed = parseFfprobeJson('https://example.com/live.m3u8', SAMPLE_FFPROBE);
    expect(formatProbedStreamSummary(probed)).toContain('1080p');
    expect(formatProbedStreamSummary(probed)).toContain('HEVC');
  });
});
