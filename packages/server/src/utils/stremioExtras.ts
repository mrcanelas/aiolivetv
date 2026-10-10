import type { Request } from 'express';

export function getEncodedExtras(
  req: Request<{ extras?: string }>
): string | undefined {
  if (req.params.extras === undefined) return undefined;
  // Express decodes route params, losing the distinction between separators and values.
  const path = req.path.replace(/\/$/, '');
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/, '');
}
