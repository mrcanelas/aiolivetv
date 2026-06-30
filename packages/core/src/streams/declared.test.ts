import { describe, expect, it } from 'vitest';
import {
  buildDeclaredStreamLabel,
  formatDeclaredStreamSummary,
  parseDeclaredStreamInfo,
} from './declared.js';

describe('declared stream metadata', () => {
  it('parses codec and resolution hints from live stream names', () => {
    const declared = parseDeclaredStreamInfo({ name: 'AXN H265 FHD' });
    expect(declared?.parsedFile.encode).toBe('HEVC');
    expect(declared?.parsedFile.resolution).toBe('1080p');
    expect(declared?.label).toBe('AXN H265 FHD');
  });

  it('combines name, description and group for IPTV labels', () => {
    const built = buildDeclaredStreamLabel({
      name: 'Globo SP',
      description: 'FHD H264',
      group: 'Abertos',
    });
    expect(built?.label).toContain('Globo SP');
    expect(built?.label).toContain('FHD H264');
    expect(built?.label).toContain('Abertos');
    expect(built?.source).toBe('combined');
  });

  it('parses language hints from addon stream names', () => {
    const declared = parseDeclaredStreamInfo({
      name: 'CNN International Portuguese 720p',
    });
    expect(declared?.parsedFile.resolution).toBe('720p');
    expect(declared?.parsedFile.languages).toContain('Portuguese');
  });

  it('formats a compact summary for UI badges', () => {
    const declared = parseDeclaredStreamInfo({ name: 'AXN H265 FHD' });
    expect(formatDeclaredStreamSummary(declared?.parsedFile)).toContain('1080p');
    expect(formatDeclaredStreamSummary(declared?.parsedFile)).toContain('HEVC');
  });

  it('returns undefined when no parseable metadata exists', () => {
    expect(parseDeclaredStreamInfo({ name: 'AXN' })).toBeUndefined();
  });

  it('parses IPTV quality suffixes on channel names', () => {
    for (const [name, resolution] of [
      ['A&E UHD', '2160p'],
      ['A&E FHD', '1080p'],
      ['A&E HD', '720p'],
      ['A&E HD²', '720p'],
      ['A&E SD', '480p'],
    ] as const) {
      const declared = parseDeclaredStreamInfo({ name });
      expect(declared?.parsedFile.resolution, name).toBe(resolution);
    }
  });
});
