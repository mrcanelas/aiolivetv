import { afterEach, describe, expect, it } from 'vitest';
import {
  canRunFfprobe,
  isEphemeralRuntime,
  shouldScheduleBackgroundTasks,
} from './runtime.js';

const ORIGINAL_VERCEL = process.env.VERCEL;
const ORIGINAL_EPHEMERAL = process.env.EPHEMERAL_RUNTIME;
const ORIGINAL_FFPROBE = process.env.FFPROBE_PATH;

afterEach(() => {
  if (ORIGINAL_VERCEL === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = ORIGINAL_VERCEL;
  if (ORIGINAL_EPHEMERAL === undefined) delete process.env.EPHEMERAL_RUNTIME;
  else process.env.EPHEMERAL_RUNTIME = ORIGINAL_EPHEMERAL;
  if (ORIGINAL_FFPROBE === undefined) delete process.env.FFPROBE_PATH;
  else process.env.FFPROBE_PATH = ORIGINAL_FFPROBE;
});

describe('runtime detection', () => {
  it('treats Vercel as an ephemeral runtime', () => {
    process.env.VERCEL = '1';
    delete process.env.EPHEMERAL_RUNTIME;
    expect(isEphemeralRuntime()).toBe(true);
    expect(shouldScheduleBackgroundTasks()).toBe(false);
    expect(canRunFfprobe()).toBe(false);
  });

  it('allows ffprobe on Vercel when FFPROBE_PATH is set', () => {
    process.env.VERCEL = '1';
    process.env.FFPROBE_PATH = '/usr/bin/ffprobe';
    expect(canRunFfprobe()).toBe(true);
  });

  it('keeps background timers on a normal host', () => {
    delete process.env.VERCEL;
    delete process.env.EPHEMERAL_RUNTIME;
    delete process.env.FFPROBE_PATH;
    expect(isEphemeralRuntime()).toBe(false);
    expect(shouldScheduleBackgroundTasks()).toBe(true);
    expect(canRunFfprobe()).toBe(true);
  });
});
