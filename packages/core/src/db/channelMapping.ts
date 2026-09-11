import { z } from 'zod';

export const ChannelMapping = z.object({
  id: z.string().min(1),
  canonicalAddonId: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  name: z.string().min(1).optional(),
  poster: z.string().optional(),
  hidden: z.boolean().optional(),
  streams: z
    .array(
      z.object({
        addonId: z.string().min(1),
        channelId: z.string().min(1),
        url: z.string().url().optional(),
        name: z.string().min(1).optional(),
        confidence: z.number().min(0).max(1).optional(),
        enabled: z.boolean().optional(),
      })
    )
    .optional(),
  rejectedStreams: z
    .array(
      z.object({
        addonId: z.string().min(1),
        channelId: z.string().min(1),
      })
    )
    .optional(),
});

export type ChannelMapping = z.infer<typeof ChannelMapping>;
