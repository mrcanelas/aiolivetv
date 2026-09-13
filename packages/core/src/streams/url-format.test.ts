import { describe, expect, it } from 'vitest';
import { inferStreamUrlFormat } from './url-format.js';

describe('inferStreamUrlFormat', () => {
  it('detects HLS from a playlist path', () => {
    expect(
      inferStreamUrlFormat('https://example.com/live/axn/index.m3u8')
    ).toMatchObject({
      protocol: 'https',
      extension: 'm3u8',
      format: 'hls',
      label: 'HLS',
      isAdaptive: true,
    });
  });

  it('detects MPEG-TS from a .ts path', () => {
    expect(
      inferStreamUrlFormat('http://provider.com/live/user/pass/301.ts')
    ).toMatchObject({
      format: 'mpegts',
      label: 'MPEG-TS',
      isAdaptive: false,
    });
  });

  it('detects DASH from a .mpd path', () => {
    expect(
      inferStreamUrlFormat('https://cdn.example.com/manifest.mpd')
    ).toMatchObject({
      format: 'dash',
      label: 'DASH',
      isAdaptive: true,
    });
  });

  it('detects RTMP from the protocol', () => {
    expect(inferStreamUrlFormat('rtmp://server/live/channel')).toMatchObject({
      protocol: 'rtmp',
      format: 'rtmp',
      label: 'RTMP',
    });
  });

  it('returns unknown when the URL has no format hint', () => {
    expect(
      inferStreamUrlFormat('https://provider.com/live/12345')
    ).toMatchObject({
      protocol: 'https',
      format: 'unknown',
      label: 'Unknown',
      isAdaptive: false,
    });
  });

  it('returns unknown for missing or invalid URLs', () => {
    expect(inferStreamUrlFormat(undefined).format).toBe('unknown');
    expect(inferStreamUrlFormat('not a url').format).toBe('unknown');
  });
});
