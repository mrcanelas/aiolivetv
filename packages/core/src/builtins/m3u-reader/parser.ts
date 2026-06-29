import { decodeHtmlEntities } from '../../utils/text.js';

export interface M3uEntry {
  channelId: string;
  name: string;
  url: string;
  logo?: string;
  group?: string;
  country?: string;
  language?: string;
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
          group: metadata['group-title'],
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
