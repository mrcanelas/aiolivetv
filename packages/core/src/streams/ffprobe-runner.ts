import { spawn } from 'node:child_process';
import { canRunFfprobe } from '../utils/runtime.js';

export { canRunFfprobe };

export async function runFfprobe(
  url: string,
  options: { binaryPath?: string; timeoutMs?: number } = {}
): Promise<string> {
  const binaryPath =
    options.binaryPath ?? process.env.FFPROBE_PATH ?? 'ffprobe';
  if (!options.binaryPath && !canRunFfprobe()) {
    throw new Error('ffprobe is not available in this runtime');
  }
  const timeoutMs = options.timeoutMs ?? 15_000;

  return new Promise((resolve, reject) => {
    const args = [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_streams',
      '-show_format',
      url,
    ];
    const proc = spawn(binaryPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('ffprobe timed out'));
    }, timeoutMs);

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `ffprobe exited with code ${code}`));
    });
  });
}
