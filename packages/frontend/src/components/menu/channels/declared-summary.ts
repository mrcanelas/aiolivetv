import type { DeclaredStreamInfo } from '@/lib/api';

export function formatDeclaredSummary(
  declared: DeclaredStreamInfo | null | undefined
): string | undefined {
  const parsedFile = declared?.parsedFile;
  if (!parsedFile) return undefined;
  const parts: string[] = [];
  if (parsedFile.resolution) parts.push(parsedFile.resolution);
  if (parsedFile.encode) parts.push(parsedFile.encode);
  if (parsedFile.quality && parsedFile.quality !== parsedFile.resolution) {
    parts.push(parsedFile.quality);
  }
  if (parsedFile.audioChannels?.length) {
    parts.push(parsedFile.audioChannels.join('/'));
  }
  if (parsedFile.languages?.length) {
    parts.push(parsedFile.languages.join(', '));
  }
  return parts.length ? parts.join(' · ') : undefined;
}
