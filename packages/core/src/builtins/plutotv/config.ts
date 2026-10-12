import { z } from 'zod';
import { PLUTO_TV_REGION_CODES } from './regions.js';

export const PlutoTvConfigSchema = z.object({
  region: z.enum(PLUTO_TV_REGION_CODES).default('br'),
  timeout: z.number().int().positive(),
  /** Shift program start/end times by this many minutes (positive = later). */
  timeShiftMinutes: z.number().int().default(0),
});

export type PlutoTvConfig = z.infer<typeof PlutoTvConfigSchema>;
