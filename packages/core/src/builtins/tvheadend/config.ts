import { z } from 'zod';

export const TVHEADEND_PLAYBACK_MODES = ['direct', 'proxy'] as const;
export type TvheadendPlaybackMode =
  (typeof TVHEADEND_PLAYBACK_MODES)[number];

export const TvheadendConfigSchema = z.object({
  url: z.string().min(1),
  username: z.string().optional().default(''),
  password: z.string().optional().default(''),
  playbackUrl: z.string().optional().default(''),
  playbackMode: z.enum(TVHEADEND_PLAYBACK_MODES).default('direct'),
  profile: z.string().optional().default('pass'),
  tagIds: z.string().optional().default(''),
  timeout: z.number().int().positive(),
  timeShiftMinutes: z.number().int().default(0),
});

export type TvheadendConfig = z.infer<typeof TvheadendConfigSchema>;

export function parseTagIds(value?: string): string[] {
  return (value ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}
