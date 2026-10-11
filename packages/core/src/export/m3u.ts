import type { ExportChannel } from './channels.js';
import { toTvgId } from './channels.js';

/** Collapse/strip characters that would break Extended M3U line structure. */
export function sanitizeM3uText(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/"/g, "'")
    .trim();
}

export function rewriteHlsPlaylist(
  playlist: string,
  baseUrl: string,
  proxyUrl: (url: URL) => string
): string {
  const rewrite = (uri: string) => {
    const url = new URL(uri, baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Unsupported HLS URI protocol');
    }
    return proxyUrl(url);
  };
  return playlist
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        return line.replace(
          /\bURI="([^"]+)"/g,
          (_, uri: string) => `URI="${rewrite(uri)}"`
        );
      }
      return rewrite(trimmed);
    })
    .join('\n');
}

function attr(name: string, value: string | undefined): string {
  if (!value) return '';
  return ` ${name}="${sanitizeM3uText(value)}"`;
}

export type M3uGenerateOptions = {
  channels: ExportChannel[];
  playUrlForChannel: (channelId: string) => string;
  /** Optional absolute XMLTV URL for the #EXTM3U header (informational). */
  xmltvUrl?: string;
};

export function generateM3uPlaylist(options: M3uGenerateOptions): string {
  const headerAttrs = options.xmltvUrl
    ? ` x-tvg-url="${sanitizeM3uText(options.xmltvUrl)}"`
    : '';
  const lines = [`#EXTM3U${headerAttrs}`];

  for (const channel of options.channels) {
    if (!channel.hasStreamSource) continue;
    const tvgId = toTvgId(channel.id);
    const name = sanitizeM3uText(channel.name) || tvgId;
    const logo = channel.logo ? sanitizeM3uText(channel.logo) : undefined;
    const group = channel.group ? sanitizeM3uText(channel.group) : undefined;
    lines.push(
      `#EXTINF:-1${attr('tvg-id', tvgId)}${attr('tvg-name', name)}${attr('tvg-logo', logo)}${attr('group-title', group)},${name}`
    );
    lines.push(options.playUrlForChannel(channel.id));
  }

  return `${lines.join('\n')}\n`;
}
