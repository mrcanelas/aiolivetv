import type { ParsedFile } from '../db/schemas.js';
import FileParser from '../parser/file.js';

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
  const parsedFile: ParsedFile = {
    ...parsed,
    title: undefined,
  };

  const hasMetadata =
    parsedFile.resolution ||
    parsedFile.quality ||
    parsedFile.encode ||
    parsedFile.audioChannels.length > 0 ||
    parsedFile.audioTags.length > 0 ||
    parsedFile.visualTags.length > 0 ||
    parsedFile.languages.length > 0;

  if (!hasMetadata) return undefined;

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
