import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collectExportChannels, toTvgId } from './channels.js';
import {
  generateM3uPlaylist,
  sanitizeM3uText,
  rewriteHlsPlaylist,
} from './m3u.js';
import {
  dedupeProgrammes,
  escapeXml,
  generateXmltvGuide,
  isValidProgramme,
  toXmltvTimestamp,
} from './xmltv.js';
import type { UserData } from '../db/schemas.js';

const state = {
  enabled: true,
  disabledReason: 'Desabilitado pelo administrador desta instância',
  proxyEnabled: false,
  allowPrivateUrls: false,
};

vi.mock('../config/index.js', () => ({
  config: {
    builtins: {
      export: {
        get enabled() {
          return state.enabled;
        },
        get disabledReason() {
          return state.disabledReason;
        },
        get proxyEnabled() {
          return state.proxyEnabled;
        },
        epgWindowHours: 48,
      },
    },
    bootstrap: {
      get allowPrivateUrls() {
        return state.allowPrivateUrls;
      },
      baseUrl: 'https://example.test',
    },
  },
}));

const {
  ExportPolicyError,
  assertExportEnabled,
  assertExportProxyAllowed,
  getExportInstancePolicy,
  resolveExportPlaybackMode,
} = await import('./policy.js');

describe('export channel identity', () => {
  it('keeps stable tvg ids independent of name', () => {
    const id = 'aiolivetv:abc123';
    expect(toTvgId(id)).toBe(id);
    expect(toTvgId(`${id}:epg:2026-01-01`)).toBe(id);
  });

  it('collects only visible mapped channels and flags missing streams', () => {
    const userData = {
      presets: [],
      channelMappings: [
        {
          id: 'aiolivetv:one',
          name: 'One',
          enabled: true,
          group: 'News',
          streams: [{ addonId: 'a', channelId: 'c1', enabled: true }],
        },
        {
          id: 'aiolivetv:two',
          name: 'Two',
          enabled: true,
          streams: [],
        },
        {
          id: 'aiolivetv:hidden',
          name: 'Hidden',
          enabled: false,
          streams: [{ addonId: 'a', channelId: 'c2' }],
        },
      ],
    } as unknown as UserData;

    const channels = collectExportChannels(userData);
    expect(channels.map((c) => c.id)).toEqual([
      'aiolivetv:one',
      'aiolivetv:two',
    ]);
    expect(channels[0].hasStreamSource).toBe(true);
    expect(channels[1].hasStreamSource).toBe(false);
    expect(channels[0].group).toBe('News');
  });
});

describe('M3U generation', () => {
  it('rewrites nested playlists, encryption keys and cross-origin segments', () => {
    const urls: string[] = [];
    const body = rewriteHlsPlaylist(
      '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MAP:URI="init.mp4"\nvariant/index.m3u8\nhttps://cdn.test/segment.ts',
      'https://provider.test/live/master.m3u8',
      (url) => {
        urls.push(url.toString());
        return 'https://proxy.test/' + urls.length;
      }
    );
    expect(urls).toEqual([
      'https://provider.test/live/key.bin',
      'https://provider.test/live/init.mp4',
      'https://provider.test/live/variant/index.m3u8',
      'https://cdn.test/segment.ts',
    ]);
    expect(body).toContain('URI="https://proxy.test/1"');
    expect(body).toContain('URI="https://proxy.test/2"');
    expect(() =>
      rewriteHlsPlaylist(
        '#EXTM3U\nfile:///secret',
        'https://provider.test/',
        () => ''
      )
    ).toThrow();
  });
  it('matches tvg-id to play URLs and escapes line breaks', () => {
    const body = generateM3uPlaylist({
      channels: [
        {
          id: 'aiolivetv:one',
          name: 'Channel\nEvil',
          group: 'News"HD',
          hasStreamSource: true,
        },
        {
          id: 'aiolivetv:two',
          name: 'No Stream',
          hasStreamSource: false,
        },
      ],
      xmltvUrl: 'https://example.com/exports/t/guide.xml',
      playUrlForChannel: (id) => `https://example.com/play/${id}`,
    });

    expect(body.startsWith('#EXTM3U')).toBe(true);
    expect(body).toContain(
      'x-tvg-url="https://example.com/exports/t/guide.xml"'
    );
    expect(body).toContain('tvg-id="aiolivetv:one"');
    expect(body).toContain('https://example.com/play/aiolivetv:one');
    expect(body).not.toContain('aiolivetv:two');
    expect(body).not.toContain('\nEvil');
    expect(sanitizeM3uText('a\nb')).toBe('a b');
  });
});

describe('XMLTV generation', () => {
  it('uses matching channel ids and UTC timestamps', () => {
    const start = new Date('2026-06-01T12:00:00.000Z');
    const stop = new Date('2026-06-01T13:00:00.000Z');
    expect(toXmltvTimestamp(start)).toBe('20260601120000 +0000');

    const xml = generateXmltvGuide({
      channels: [
        {
          id: 'aiolivetv:one',
          name: 'One & Co',
          logo: 'https://cdn.example/logo.png',
          hasStreamSource: true,
        },
        {
          id: 'aiolivetv:bare',
          name: 'Bare',
          hasStreamSource: true,
        },
      ],
      programmes: [
        {
          channelId: 'aiolivetv:one',
          start,
          stop,
          title: 'Morning <News>',
          description: 'Desc & more',
        },
        {
          channelId: 'aiolivetv:one',
          start: stop,
          stop: start,
          title: 'Invalid',
        },
      ],
    });

    expect(xml).toContain('channel id="aiolivetv:one"');
    expect(xml).toContain('channel id="aiolivetv:bare"');
    expect(xml).toContain('<display-name>One &amp; Co</display-name>');
    expect(xml).toContain('start="20260601120000 +0000"');
    expect(xml).toContain('<title>Morning &lt;News&gt;</title>');
    expect(xml).not.toContain('Invalid');
    expect(escapeXml(`a&b<"'`)).toBe('a&amp;b&lt;&quot;&apos;');
  });

  it('dedupes and rejects invalid events while keeping channels without EPG', () => {
    const start = new Date('2026-06-01T12:00:00.000Z');
    const stop = new Date('2026-06-01T13:00:00.000Z');
    const programmes = dedupeProgrammes([
      {
        channelId: 'c1',
        start,
        stop,
        title: 'Show',
      },
      {
        channelId: 'c1',
        start,
        stop,
        title: 'Show',
      },
      {
        channelId: 'c1',
        start: stop,
        stop: start,
        title: 'Bad',
      },
    ]);
    expect(programmes).toHaveLength(1);
    expect(
      isValidProgramme({
        channelId: 'c',
        start,
        stop,
        title: 'Ok',
      })
    ).toBe(true);
  });
});

describe('export instance policy', () => {
  beforeEach(() => {
    state.enabled = true;
    state.disabledReason = 'Desabilitado pelo administrador desta instância';
    state.proxyEnabled = false;
    state.allowPrivateUrls = false;
  });

  it('disables export from builtins config', () => {
    state.enabled = false;
    const policy = getExportInstancePolicy();
    expect(policy.enabled).toBe(false);
    expect(() => assertExportEnabled()).toThrow(ExportPolicyError);
  });

  it('keeps proxy as a separate capability', () => {
    expect(resolveExportPlaybackMode()).toBe('redirect');
    expect(() => assertExportProxyAllowed()).toThrow(/proxy/);
    state.proxyEnabled = true;
    expect(resolveExportPlaybackMode()).toBe('proxy');
    expect(() => assertExportProxyAllowed()).not.toThrow();
  });
});
