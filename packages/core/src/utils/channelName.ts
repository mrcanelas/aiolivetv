import { decodeHtmlEntities } from './text.js';

/**
 * Normalises live channel names for matching by stripping provider prefixes,
 * quality markers and audio/language hints while preserving regional identifiers.
 */
export function normalizeChannelName(name: string): string {
  if (!name) return '';

  let normalized = decodeHtmlEntities(name).trim().toLowerCase();
  normalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  normalized = normalized.replace(/²/g, '2');

  normalized = normalized.replace(
    /^[a-z0-9][a-z0-9\s]{1,}\s*(?:[-:|·])\s+/i,
    ''
  );

  const wordsToRemove = [
    /\btv\b/g,
    /\bhd[2]?\b/g,
    /\bfhd\b/g,
    /\buhd\b/g,
    /\b4k\b/g,
    /\bsd\b/g,
    /\blive\b/g,
    /\bao\s+vivo\b/g,
    /\bchannel\b/g,
    /\bcanal\b/g,
    /\bleg(?:endado)?\b/g,
    /\bdub(?:bado|lado)?\b/g,
    /\borig(?:inal)?\b/g,
    /\bsub(?:titulado|s)?\b/g,
    /\b1080p?\b/g,
    /\b720p?\b/g,
    /\b2160p?\b/g,
    /\bfull\s+hd\b/g,
  ];

  for (const regex of wordsToRemove) {
    normalized = normalized.replace(regex, '');
  }

  normalized = normalized.replace(/[^a-z0-9\s]/g, ' ');
  normalized = normalized.replace(/\s+/g, ' ').trim();
  return normalized;
}

/** Sørensen–Dice coefficient for fuzzy name comparison. */
export function getChannelNameSimilarity(left: string, right: string): number {
  const normLeft = left.replace(/\s+/g, '');
  const normRight = right.replace(/\s+/g, '');

  if (!normLeft || !normRight) return 0;
  if (normLeft === normRight) return 1;
  if (normLeft.length < 2 || normRight.length < 2) return 0;

  const bigrams = new Map<string, number>();
  for (let index = 0; index < normLeft.length - 1; index++) {
    const bigram = normLeft.slice(index, index + 2);
    bigrams.set(bigram, (bigrams.get(bigram) ?? 0) + 1);
  }

  let intersection = 0;
  for (let index = 0; index < normRight.length - 1; index++) {
    const bigram = normRight.slice(index, index + 2);
    const count = bigrams.get(bigram) ?? 0;
    if (count > 0) {
      bigrams.set(bigram, count - 1);
      intersection++;
    }
  }

  return (2 * intersection) / (normLeft.length + normRight.length - 2);
}
