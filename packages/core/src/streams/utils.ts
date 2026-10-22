import { ParsedStream, PassthroughStage } from '../db/schemas.js';

/**
 * Check if a stream should passthrough a specific stage.
 * Returns true if:
 * - stream.addon.resultPassthrough is true
 * - stream.passthrough is true (passthrough all stages)
 * - stream.passthrough is an array that includes the specified stage
 */
export function shouldPassthroughStage(
  stream: ParsedStream,
  stage: PassthroughStage
): boolean {
  // Addon-level passthrough always bypasses all stages
  if (stream.addon.resultPassthrough) {
    return true;
  }

  // Check stream-level passthrough
  if (stream.passthrough === true) {
    // true = passthrough all stages
    return true;
  }

  if (Array.isArray(stream.passthrough)) {
    // Array = passthrough only specified stages
    return stream.passthrough.includes(stage);
  }

  return false;
}

class StreamUtils {
  // ensure we have a unique list of streams after merging
  public static mergeStreams(streams: ParsedStream[]): ParsedStream[] {
    const mergedStreams = new Map<string, ParsedStream>();
    for (const stream of streams) {
      mergedStreams.set(stream.id, stream);
    }
    return Array.from(mergedStreams.values());
  }
}

export default StreamUtils;
