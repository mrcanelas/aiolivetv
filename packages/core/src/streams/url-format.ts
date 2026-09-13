export type StreamDeliveryFormat =
  | 'hls'
  | 'mpegts'
  | 'dash'
  | 'mp4'
  | 'webm'
  | 'rtmp'
  | 'rtsp'
  | 'udp'
  | 'rtp'
  | 'unknown';

export interface StreamUrlFormatInfo {
  protocol?: string;
  extension?: string;
  format: StreamDeliveryFormat;
  label: string;
  isAdaptive: boolean;
}

const FORMAT_LABELS: Record<StreamDeliveryFormat, string> = {
  hls: 'HLS',
  mpegts: 'MPEG-TS',
  dash: 'DASH',
  mp4: 'MP4',
  webm: 'WebM',
  rtmp: 'RTMP',
  rtsp: 'RTSP',
  udp: 'UDP',
  rtp: 'RTP',
  unknown: 'Unknown',
};

function result(
  protocol: string | undefined,
  extension: string | undefined,
  format: StreamDeliveryFormat,
  isAdaptive: boolean
): StreamUrlFormatInfo {
  return {
    protocol,
    extension,
    format,
    label: FORMAT_LABELS[format],
    isAdaptive,
  };
}

export function inferStreamUrlFormat(
  url?: string | null
): StreamUrlFormatInfo {
  if (!url) {
    return result(undefined, undefined, 'unknown', false);
  }

  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    return result(undefined, undefined, 'unknown', false);
  }

  const protocol = parsed.protocol.replace(':', '').toLowerCase();
  const pathname = decodeURIComponent(parsed.pathname).toLowerCase();
  const search = parsed.search.toLowerCase();
  const extensionMatch = pathname.match(/\.([a-z0-9]+)$/);
  const extension = extensionMatch?.[1];

  if (protocol === 'rtmp' || protocol === 'rtmps') {
    return result(protocol, extension, 'rtmp', false);
  }
  if (protocol === 'rtsp') {
    return result(protocol, extension, 'rtsp', false);
  }
  if (protocol === 'udp') {
    return result(protocol, extension, 'udp', false);
  }
  if (protocol === 'rtp') {
    return result(protocol, extension, 'rtp', false);
  }

  if (
    extension === 'm3u8' ||
    search.includes('m3u8') ||
    search.includes('hls')
  ) {
    return result(protocol, extension ?? 'm3u8', 'hls', true);
  }

  if (extension === 'mpd' || search.includes('dash')) {
    return result(protocol, extension ?? 'mpd', 'dash', true);
  }

  if (
    extension === 'ts' ||
    extension === 'm2ts' ||
    extension === 'mpegts' ||
    search.includes('mpegts')
  ) {
    return result(protocol, extension, 'mpegts', false);
  }

  if (extension === 'mp4' || extension === 'm4v' || extension === 'mov') {
    return result(protocol, extension, 'mp4', false);
  }

  if (extension === 'webm') {
    return result(protocol, extension, 'webm', false);
  }

  return {
    protocol,
    extension,
    format: 'unknown',
    label: extension ? extension.toUpperCase() : FORMAT_LABELS.unknown,
    isAdaptive: false,
  };
}
