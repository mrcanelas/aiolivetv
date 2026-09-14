import { z } from 'zod';

export const ChannelStreamSource = z.object({
  addonId: z.string().min(1),
  channelId: z.string().min(1),
  url: z.string().url().optional(),
  name: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  enabled: z.boolean().optional(),
  headers: z.record(z.string().min(1), z.string().min(1)).optional(),
  resolution: z.string().min(1).optional(),
  encode: z.string().min(1).optional(),
  quality: z.string().min(1).optional(),
  languages: z.array(z.string().min(1)).optional(),
  audioChannels: z.array(z.string().min(1)).optional(),
  visualTags: z.array(z.string().min(1)).optional(),
});

export const ChannelMapping = z.object({
  id: z.string().min(1),
  canonicalAddonId: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  name: z.string().min(1).optional(),
  poster: z.string().optional(),
  group: z.string().min(1).optional(),
  hidden: z.boolean().optional(),
  streams: z.array(ChannelStreamSource).optional(),
  rejectedStreams: z
    .array(
      z.object({
        addonId: z.string().min(1),
        channelId: z.string().min(1),
      })
    )
    .optional(),
});

export type ChannelStreamSource = z.infer<typeof ChannelStreamSource>;
export type ChannelMapping = z.infer<typeof ChannelMapping>;
