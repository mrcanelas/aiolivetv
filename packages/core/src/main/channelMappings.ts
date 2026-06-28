import type { UserData } from '../db/index.js';

export interface ChannelMatchCandidate {
  id: string;
  name: string;
  tvgId?: string;
  aliases?: string[];
  country?: string;
  language?: string;
  categories?: string[];
  logo?: string;
}

export function getCanonicalChannelId(id: string) {
  return id.split(':epg:', 1)[0];
}

export function getChannelMapping(userData: UserData, channelId: string) {
  channelId = getCanonicalChannelId(channelId);
  return userData.channelMappings?.find((channel) => channel.id === channelId);
}

function normalise(value?: string) {
  return value
    ?.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function equal(a?: string, b?: string) {
  const left = normalise(a);
  return Boolean(left && left === normalise(b));
}

function overlaps(left: string[] = [], right: string[] = []) {
  const values = new Set(left.map(normalise).filter(Boolean));
  return right.some((value) => values.has(normalise(value)));
}

export function getChannelMatchConfidence(
  left: ChannelMatchCandidate,
  right: ChannelMatchCandidate
) {
  if (equal(left.tvgId, right.tvgId)) return 1;

  const namesMatch = equal(left.name, right.name);
  const aliasesMatch = overlaps(
    [left.name, ...(left.aliases ?? [])],
    [right.name, ...(right.aliases ?? [])]
  );
  let score = namesMatch ? 0.9 : aliasesMatch ? 0.88 : 0;
  if (!score) return 0;
  if (equal(left.country, right.country)) score += 0.03;
  if (equal(left.language, right.language)) score += 0.03;
  if (overlaps(left.categories, right.categories)) score += 0.02;
  if (equal(left.logo, right.logo)) score += 0.02;
  return Math.min(score, 0.99);
}

export const isHighConfidenceChannelMatch = (confidence: number) =>
  confidence >= 0.9;

export function isChannelAddonEnabled(
  userData: UserData,
  channelId: string,
  addonId: string
) {
  return (
    getChannelMapping(userData, channelId)?.streams?.find(
      (stream) => stream.addonId === addonId
    )?.enabled !== false
  );
}
