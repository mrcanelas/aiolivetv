import { describe, expect, it } from 'vitest';
import { inferStreamUrlFormat, sanitiseStreamUrl } from './url-format.js';

describe('inferStreamUrlFormat', () => {
  it('detects HLS from .m3u8', () => {
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

  it('detects MPEG-TS from .ts', () => {
    expect(
      inferStreamUrlFormat('http://provider.com/live/user/pass/301.ts')
    ).toMatchObject({
      format: 'mpegts',
      label: 'MPEG-TS',
      isAdaptive: false,
    });
  });

  it('detects DASH from .mpd', () => {
    expect(
      inferStreamUrlFormat('https://cdn.example.com/manifest.mpd')
    ).toMatchObject({
      format: 'dash',
      label: 'DASH',
      isAdaptive: true,
    });
  });

  it('detects RTMP protocol', () => {
    expect(inferStreamUrlFormat('rtmp://server/live/channel')).toMatchObject({
      protocol: 'rtmp',
      format: 'rtmp',
      label: 'RTMP',
    });
  });

  it('returns unknown for extensionless URLs', () => {
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

describe('sanitiseStreamUrl', () => {
  it('redacts Xtream user and password from the path', () => {
    expect(
      sanitiseStreamUrl('http://provider.example.com/live/user/pass/301.ts')
    ).toEqual({
      streamHost: 'provider.example.com',
      streamPathType: 'live',
      streamUrlSafe: 'provider.example.com/live/.../301.ts',
    });
  });

  it('drops query tokens', () => {
    expect(
      sanitiseStreamUrl(
        'https://cdn.example.com/live/axn/index.m3u8?token=secret'
      )
    ).toEqual({
      streamHost: 'cdn.example.com',
      streamPathType: 'live',
      streamUrlSafe: 'cdn.example.com/live/.../index.m3u8',
    });
  });

  it('returns empty for invalid URLs', () => {
    expect(sanitiseStreamUrl('not a url')).toEqual({});
    expect(sanitiseStreamUrl(undefined)).toEqual({});
  });
});
