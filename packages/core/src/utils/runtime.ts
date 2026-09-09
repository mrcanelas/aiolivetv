/**
 * Runtime detection for platforms where the process is not a long-lived
 * single instance (Vercel Container Functions, and similar).
 *
 * Vercel sets `VERCEL=1` automatically. Other platforms can opt in with
 * `EPHEMERAL_RUNTIME=1`.
 */
export function isEphemeralRuntime(): boolean {
  return process.env.VERCEL === '1' || process.env.EPHEMERAL_RUNTIME === '1';
}

export function shouldScheduleBackgroundTasks(): boolean {
  return !isEphemeralRuntime();
}

/**
 * Stream Probe needs a real `ffprobe` binary. The default Docker/Vercel
 * image does not include one, so callers must skip probes unless
 * `FFPROBE_PATH` points at a bundled binary.
 */
export function canRunFfprobe(): boolean {
  if (process.env.FFPROBE_PATH) return true;
  return !isEphemeralRuntime();
}
