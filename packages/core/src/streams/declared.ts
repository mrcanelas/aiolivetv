import type { ParsedFile } from '../db/schemas.js';
import FileParser from '../parser/file.js';
import { PARSE_REGEX } from '../parser/regex.js';
import { decodeHtmlEntities } from '../utils/text.js';

export type DeclaredStreamSource =
  | 'name'
  | 'description'
  | 'm3u'
  | 'catalog'
  | 'combined';

export interface DeclaredStreamInput {
  name?: string | null;
  description?: string | null;
  /** M3U `group-title` or catalog genre/category hint. */
  group?: string | null;
}

export interface DeclaredStreamInfo {
  /** Fields consumed by formatters (`stream.resolution`, etc.). */
  parsedFile: ParsedFile;
  /** Which label parts were used to derive {@link parsedFile}. */
  source: DeclaredStreamSource;
  /** Raw text passed to the release-name parser. */
  label: string;
}

function trim(value: string | null | undefined) {
  return value?.trim() ?? '';
}

/**
 * Builds the best-effort label for live stream metadata parsing from addon/M3U
 * names. IPTV providers often split hints across name, description and group.
 */
export function buildDeclaredStreamLabel(
  input: DeclaredStreamInput
): { label: string; source: DeclaredStreamSource } | undefined {
  const name = trim(input.name);
  const description = trim(input.description);
  const group = trim(input.group);

  if (!name && !description && !group) return undefined;

  const parts: string[] = [];
  if (name) parts.push(name);
  if (description && description.toLowerCase() !== name.toLowerCase()) {
    parts.push(description);
  }
  if (
    group &&
    !parts.some((part) => part.toLowerCase().includes(group.toLowerCase()))
  ) {
    parts.push(group);
  }

  const label = parts.join(' · ').trim();
  if (!label) return undefined;

  let source: DeclaredStreamSource = 'name';
  if (name && description && description.toLowerCase() !== name.toLowerCase()) {
    source = 'combined';
  } else if (!name && description) {
    source = 'description';
  } else if (!name && !description && group) {
    source = 'm3u';
  } else if (name && !description && group) {
    source = 'catalog';
  }

  return { label, source };
}

function normalizeLiveLabel(label: string) {
  return decodeHtmlEntities(label)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/²/g, '2')
    .toLowerCase();
}

function matchPattern(
  label: string,
  patterns: Record<string, RegExp>
): string | undefined {
  return Object.entries(patterns).find(([, pattern]) => pattern.test(label))?.[0];
}

function matchMultiplePatterns(
  label: string,
  patterns: Record<string, RegExp>
): string[] {
  return Object.entries(patterns)
    .filter(([, pattern]) => pattern.test(label))
    .map(([tag]) => tag);
}

/**
 * IPTV addons often label streams as "Canal FHD" instead of release names.
 * The torrent title parser treats those as movie titles, so we scan quality
 * markers directly on the label.
 */
export function parseLiveStreamHints(label: string): Partial<ParsedFile> {
  const normalized = normalizeLiveLabel(label);
  const hints: Partial<ParsedFile> = {};

  if (/\b(4k|uhd|2160p?)\b/.test(normalized)) {
    hints.resolution = '2160p';
  } else if (/\b(fhd|full hd|1080p?)\b/.test(normalized)) {
    hints.resolution = '1080p';
  } else if (/\b(hd2|hd 2)\b/.test(normalized)) {
    hints.resolution = '720p';
  } else if (
    /\bhd\b/.test(normalized) &&
    !/\bfhd\b/.test(normalized) &&
    !/\buhd\b/.test(normalized)
  ) {
    hints.resolution = '720p';
  } else if (/\b(sd|480p?)\b/.test(normalized)) {
    hints.resolution = '480p';
  } else {
    hints.resolution = matchPattern(normalized, PARSE_REGEX.resolutions);
  }

  hints.encode = matchPattern(normalized, PARSE_REGEX.encodes);
  hints.quality = matchPattern(normalized, PARSE_REGEX.qualities);
  hints.audioChannels = matchMultiplePatterns(
    normalized,
    PARSE_REGEX.audioChannels
  );
  hints.audioTags = matchMultiplePatterns(normalized, PARSE_REGEX.audioTags);
  hints.visualTags = matchMultiplePatterns(normalized, PARSE_REGEX.visualTags);
  hints.languages = matchMultiplePatterns(normalized, PARSE_REGEX.languages);

  return hints;
}

function mergeDeclaredParsedFile(
  parsed: ParsedFile,
  hints: Partial<ParsedFile>
): ParsedFile {
  return {
    ...parsed,
    resolution: parsed.resolution ?? hints.resolution,
    quality: parsed.quality ?? hints.quality,
    encode: parsed.encode ?? hints.encode,
    audioChannels: parsed.audioChannels.length
      ? parsed.audioChannels
      : (hints.audioChannels ?? []),
    audioTags: parsed.audioTags.length
      ? parsed.audioTags
      : (hints.audioTags ?? []),
    visualTags: parsed.visualTags.length
      ? parsed.visualTags
      : (hints.visualTags ?? []),
    languages: parsed.languages.length
      ? parsed.languages
      : (hints.languages ?? []),
    subtitles: parsed.subtitles?.length
      ? parsed.subtitles
      : hints.subtitles,
  };
}

function hasDeclaredMetadata(parsedFile: ParsedFile) {
  return !!(
    parsedFile.resolution ||
    parsedFile.quality ||
    parsedFile.encode ||
    parsedFile.audioChannels.length > 0 ||
    parsedFile.audioTags.length > 0 ||
    parsedFile.visualTags.length > 0 ||
    parsedFile.languages.length > 0
  );
}

/**
 * Parses declared stream metadata from addon/list labels (no network probe).
 * Reuses the release-name parser so formatter variables match VOD streams.
 */
export function parseDeclaredStreamInfo(
  input: DeclaredStreamInput
): DeclaredStreamInfo | undefined {
  const built = buildDeclaredStreamLabel(input);
  if (!built) return undefined;

  const parsed = FileParser.parse(built.label);
  const parsedFile = mergeDeclaredParsedFile(
    { ...parsed, title: undefined },
    parseLiveStreamHints(built.label)
  );

  if (!hasDeclaredMetadata(parsedFile)) return undefined;

  return {
    parsedFile,
    source: built.source,
    label: built.label,
  };
}

/** Compact summary for Channels UI badges. */
export function formatDeclaredStreamSummary(
  parsedFile: ParsedFile | undefined | null
): string | undefined {
  if (!parsedFile) return undefined;
  const parts: string[] = [];
  if (parsedFile.resolution) parts.push(parsedFile.resolution);
  if (parsedFile.encode) parts.push(parsedFile.encode);
  if (
    parsedFile.quality &&
    parsedFile.quality !== parsedFile.resolution
  ) {
    parts.push(parsedFile.quality);
  }
  if (parsedFile.audioChannels.length) {
    parts.push(parsedFile.audioChannels.join('/'));
  }
  if (parsedFile.languages.length) {
    parts.push(parsedFile.languages.join(', '));
  }
  return parts.length ? parts.join(' · ') : undefined;
}
