import type { ExportChannel } from './channels.js';
import { toTvgId } from './channels.js';

export type ExportProgramme = {
  channelId: string;
  start: Date;
  stop: Date;
  title: string;
  description?: string;
  categories?: string[];
};

export type XmltvGenerateOptions = {
  channels: ExportChannel[];
  programmes: ExportProgramme[];
  generatorName?: string;
};

/** Remove characters illegal in XML 1.0 text/attr nodes. */
export function stripInvalidXmlChars(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
}

export function escapeXml(value: string): string {
  return stripInvalidXmlChars(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** XMLTV timestamp with explicit UTC offset. */
export function toXmltvTimestamp(date: Date): string {
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');
  return `${y}${mo}${d}${h}${mi}${s} +0000`;
}

export function isValidProgramme(programme: ExportProgramme): boolean {
  if (!programme.title?.trim()) return false;
  if (!(programme.start instanceof Date) || Number.isNaN(programme.start.getTime())) {
    return false;
  }
  if (!(programme.stop instanceof Date) || Number.isNaN(programme.stop.getTime())) {
    return false;
  }
  return programme.stop.getTime() > programme.start.getTime();
}

export function dedupeProgrammes(
  programmes: ExportProgramme[]
): ExportProgramme[] {
  const seen = new Set<string>();
  const out: ExportProgramme[] = [];
  for (const programme of programmes) {
    if (!isValidProgramme(programme)) continue;
    const key = [
      toTvgId(programme.channelId),
      programme.start.toISOString(),
      programme.stop.toISOString(),
      programme.title.trim(),
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(programme);
  }
  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  return out;
}

export function generateXmltvGuide(options: XmltvGenerateOptions): string {
  const generator = escapeXml(
    options.generatorName || 'AIOLiveTV'
  );
  const programmes = dedupeProgrammes(options.programmes);
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<!DOCTYPE tv SYSTEM "xmltv.dtd">`,
    `<tv generator-info-name="${generator}">`,
  ];

  for (const channel of options.channels) {
    const id = escapeXml(toTvgId(channel.id));
    parts.push(`  <channel id="${id}">`);
    parts.push(
      `    <display-name>${escapeXml(channel.name || channel.id)}</display-name>`
    );
    if (channel.logo) {
      parts.push(`    <icon src="${escapeXml(channel.logo)}" />`);
    }
    parts.push('  </channel>');
  }

  for (const programme of programmes) {
    const channel = escapeXml(toTvgId(programme.channelId));
    parts.push(
      `  <programme start="${toXmltvTimestamp(programme.start)}" stop="${toXmltvTimestamp(programme.stop)}" channel="${channel}">`
    );
    parts.push(`    <title>${escapeXml(programme.title)}</title>`);
    if (programme.description?.trim()) {
      parts.push(
        `    <desc>${escapeXml(programme.description.trim())}</desc>`
      );
    }
    for (const category of programme.categories ?? []) {
      if (!category.trim()) continue;
      parts.push(`    <category>${escapeXml(category.trim())}</category>`);
    }
    parts.push('  </programme>');
  }

  parts.push('</tv>');
  return `${parts.join('\n')}\n`;
}

/**
 * Convert Stremio-style meta.videos entries into export programmes.
 * Expects ISO start/end in video fields used by live-tv helpers.
 */
export function programmesFromMetaVideos(
  channelId: string,
  videos: Array<{
    title?: string;
    overview?: string | null;
    description?: string | null;
    released?: string | null;
    startTime?: string | null;
    endTime?: string | null;
    genres?: string[] | null;
  }>,
  windowEnd: Date
): ExportProgramme[] {
  const now = Date.now();
  const out: ExportProgramme[] = [];
  for (const video of videos) {
    const startRaw = video.startTime || video.released || undefined;
    const stopRaw = video.endTime || undefined;
    if (!startRaw || !stopRaw) continue;
    const start = new Date(startRaw);
    const stop = new Date(stopRaw);
    if (stop.getTime() <= now) continue;
    if (start.getTime() >= windowEnd.getTime()) continue;
    out.push({
      channelId,
      start,
      stop,
      title: video.title || 'Programme',
      description: video.overview || video.description || undefined,
      categories: video.genres?.filter(Boolean),
    });
  }
  return out;
}
