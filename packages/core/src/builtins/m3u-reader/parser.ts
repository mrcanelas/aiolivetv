import { decodeHtmlEntities } from '../../utils/text.js';
import { normalizeChannelGroup } from '../../utils/channelName.js';

export interface M3uEntry {
  channelId: string;
  name: string;
  url: string;
  logo?: string;
  group?: string;
  country?: string;
  language?: string;
}

/** Only playlist-level headers advertise guides; stream attributes do not. */
export function parseM3uEpgUrls(playlist: string): string[] {
  const urls = new Set<string>();
  const header = playlist
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .find((line) => /^#EXTM3U(?:\s|$)/i.test(line.trim()));
  if (!header) return [];
  for (const match of header.matchAll(
    /(?:^|\s)(?:x-tvg-url|url-tvg|tvg-url)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/gi
  )) {
    const value = decodeHtmlEntities(match[1].replace(/^["']|["']$/g, ''));
    for (const candidate of value.split(/[,\s]+/)) {
      try {
        const url = new URL(candidate);
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          urls.add(url.href);
        }
      } catch {
        // A broken guide address must not prevent importing the playlist.
      }
    }
  }
  return [...urls];
}

function splitExtinf(line: string): [string, string] {
  let quote = '';
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (
      (character === '"' || character === "'") &&
      (!quote || quote === character)
    ) {
      quote = quote ? '' : character;
    } else if (character === ',' && !quote) {
      return [line.slice(0, index), line.slice(index + 1).trim()];
    }
  }
  return [line, ''];
}

export function parseM3u(playlist: string): M3uEntry[] {
  const lines = playlist.replace(/^\uFEFF/, '').split(/\r?\n/);
  const entries: M3uEntry[] = [];
  let metadata: Record<string, string> | undefined;
  let displayName = '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('#EXTINF:')) {
      const [attributes, name] = splitExtinf(line);
      metadata = {};
      displayName = name;
      for (const match of attributes.matchAll(
        /([\w-]+)=("[^"]*"|'[^']*'|[^\s]+)/g
      )) {
        metadata[match[1].toLowerCase()] = match[2].replace(/^["']|["']$/g, '');
      }
    } else if (line && !line.startsWith('#') && metadata) {
      const name = decodeHtmlEntities(metadata['tvg-name'] || displayName);
      const channelId = metadata['tvg-id'] || name;
      if (name && channelId) {
        entries.push({
          channelId,
          name,
          url: line,
          logo: metadata['tvg-logo'],
          group: normalizeChannelGroup(metadata['group-title']),
          country: metadata['tvg-country'],
          language: metadata['tvg-language'],
        });
      }
      metadata = undefined;
      displayName = '';
    }
  }

  return entries;
}
