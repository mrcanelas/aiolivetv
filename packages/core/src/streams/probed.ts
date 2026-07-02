import type { ParsedFile } from '../db/schemas.js';

export interface ProbedStreamInfo {
  /** Source URL that was probed. */
  url: string;
  /** Container / protocol (e.g. hls, mpegts). */
  format?: string;
  /** Video codec (e.g. h264, hevc). */
  videoCodec?: string;
  /** Audio codec (e.g. aac, ac3). */
  audioCodec?: string;
  width?: number;
  height?: number;
  /** Measured video bitrate in bits per second. */
  videoBitrate?: number;
  audioChannels?: number;
  audioChannelLayout?: string;
  durationMs?: number;
}

const EMPTY_PARSED_FILE: ParsedFile = {
  audioChannels: [],
  visualTags: [],
  audioTags: [],
  languages: [],
};

function heightToResolution(height: number | undefined): string | undefined {
  if (!height) return undefined;
  if (height >= 2160) return '2160p';
  if (height >= 1080) return '1080p';
  if (height >= 720) return '720p';
  if (height >= 480) return '480p';
  return `${height}p`;
}

function normalizeCodec(codec: string | undefined): string | undefined {
  if (!codec) return undefined;
  const lower = codec.toLowerCase();
  if (lower === 'h264' || lower === 'avc') return 'H.264';
  if (lower === 'hevc' || lower === 'h265') return 'HEVC';
  if (lower === 'av1') return 'AV1';
  if (lower === 'vp9') return 'VP9';
  if (lower === 'mpeg2video') return 'MPEG-2';
  return codec.toUpperCase();
}

function audioLayoutToChannelTag(
  layout: string | undefined,
  channels: number | undefined
): string | undefined {
  if (layout) {
    const normalized = layout.toLowerCase();
    if (normalized.includes('5.1') || normalized.includes('5.1(')) return '5.1';
    if (normalized.includes('7.1')) return '7.1';
    if (normalized === 'stereo') return '2.0';
    if (normalized === 'mono') return '1.0';
  }
  if (channels === 1) return '1.0';
  if (channels === 2) return '2.0';
  if (channels === 6) return '5.1';
  if (channels === 8) return '7.1';
  return undefined;
}

/** Maps ffprobe output into formatter-friendly {@link ParsedFile} fields. */
export function probedStreamToParsedFile(
  probed: ProbedStreamInfo
): Partial<ParsedFile> {
  const parsed: Partial<ParsedFile> = {
    resolution: heightToResolution(probed.height),
    encode: normalizeCodec(probed.videoCodec),
    container: probed.format,
  };

  const channelTag = audioLayoutToChannelTag(
    probed.audioChannelLayout,
    probed.audioChannels
  );
  if (channelTag) {
    parsed.audioChannels = [channelTag];
  }

  const audioCodec = normalizeCodec(probed.audioCodec);
  if (audioCodec) {
    parsed.audioTags = [audioCodec];
  }

  return parsed;
}

/**
 * Probed metadata wins on technical fields; declared label metadata fills gaps.
 */
export function mergeDeclaredAndProbed(
  declared: ParsedFile | undefined,
  probed: Partial<ParsedFile> | undefined
): ParsedFile | undefined {
  if (!declared && !probed) return undefined;
  const base = declared ?? { ...EMPTY_PARSED_FILE };

  if (!probed) return declared;

  return {
    ...base,
    resolution: probed.resolution ?? base.resolution,
    quality: probed.quality ?? base.quality,
    encode: probed.encode ?? base.encode,
    container: probed.container ?? base.container,
    audioChannels: probed.audioChannels?.length
      ? probed.audioChannels
      : base.audioChannels,
    audioTags: probed.audioTags?.length ? probed.audioTags : base.audioTags,
    visualTags: probed.visualTags?.length ? probed.visualTags : base.visualTags,
    languages: probed.languages?.length ? probed.languages : base.languages,
    subtitles: probed.subtitles?.length ? probed.subtitles : base.subtitles,
  };
}

export function formatProbedStreamSummary(
  probed: ProbedStreamInfo | null | undefined
): string | undefined {
  if (!probed) return undefined;
  const parts: string[] = [];
  const resolution = heightToResolution(probed.height);
  if (resolution) parts.push(resolution);
  const encode = normalizeCodec(probed.videoCodec);
  if (encode) parts.push(encode);
  if (probed.format) parts.push(probed.format.toUpperCase());
  if (probed.audioCodec) parts.push(normalizeCodec(probed.audioCodec)!);
  if (probed.audioChannelLayout) parts.push(probed.audioChannelLayout);
  return parts.length ? parts.join(' · ') : undefined;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  bit_rate?: string;
  channels?: number;
  channel_layout?: string;
}

interface FfprobePayload {
  streams?: FfprobeStream[];
  format?: {
    format_name?: string;
    duration?: string;
  };
}

/** Parses `ffprobe -print_format json` stdout into {@link ProbedStreamInfo}. */
export function parseFfprobeJson(
  url: string,
  raw: string
): ProbedStreamInfo {
  let payload: FfprobePayload;
  try {
    payload = JSON.parse(raw) as FfprobePayload;
  } catch {
    throw new Error('Invalid ffprobe JSON output');
  }

  const video = payload.streams?.find((s) => s.codec_type === 'video');
  const audio = payload.streams?.find((s) => s.codec_type === 'audio');
  const durationSec = payload.format?.duration
    ? Number.parseFloat(payload.format.duration)
    : undefined;

  return {
    url,
    format: payload.format?.format_name,
    videoCodec: video?.codec_name,
    audioCodec: audio?.codec_name,
    width: video?.width,
    height: video?.height,
    videoBitrate: video?.bit_rate
      ? Number.parseInt(video.bit_rate, 10)
      : undefined,
    audioChannels: audio?.channels,
    audioChannelLayout: audio?.channel_layout,
    durationMs:
      durationSec !== undefined && Number.isFinite(durationSec)
        ? Math.round(durationSec * 1000)
        : undefined,
  };
}
