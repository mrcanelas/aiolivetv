import { z } from 'zod';

const MAX_CATEGORY_NAME_REGEX_LENGTH = 200;

export function parseCategoryIds(value?: string): string[] {
  return (value ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

export function compileCategoryNameRegex(pattern?: string): RegExp | undefined {
  if (!pattern?.trim()) return undefined;
  const trimmed = pattern.trim();
  if (trimmed.length > MAX_CATEGORY_NAME_REGEX_LENGTH) {
    throw new Error(
      `Invalid category name regex: must be at most ${MAX_CATEGORY_NAME_REGEX_LENGTH} characters`
    );
  }
  try {
    return new RegExp(trimmed, 'i');
  } catch (err) {
    throw new Error(
      `Invalid category name regex "${pattern}": ${(err as Error).message}`
    );
  }
}

export const XtreamConfigSchema = z
  .object({
    url: z.string().min(1),
    username: z.string().min(1),
    password: z.string().min(1),
    timeout: z.number().int().positive(),
    preferredFormat: z.enum(['m3u8', 'ts', 'rtmp']).default('m3u8'),
    categoryId: z.string().optional(),
    categoryNameRegex: z.string().optional(),
    timeShiftMinutes: z.number().int().default(0),
  })
  .superRefine((config, ctx) => {
    try {
      compileCategoryNameRegex(config.categoryNameRegex);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['categoryNameRegex'],
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

export type XtreamConfig = z.infer<typeof XtreamConfigSchema>;
