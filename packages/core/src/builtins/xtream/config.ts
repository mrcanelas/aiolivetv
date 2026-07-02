import { z } from 'zod';

export const XtreamConfigSchema = z.object({
  url: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  timeout: z.number().int().positive(),
  preferredFormat: z.enum(['m3u8', 'ts', 'rtmp']).default('m3u8'),
  categoryId: z.string().optional(),
  timeShiftMinutes: z.number().int().default(0),
});

export type XtreamConfig = z.infer<typeof XtreamConfigSchema>;
