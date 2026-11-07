import type { MetaPreview } from '../../db/index.js';
import { sanitizeChannelDisplayName } from '../../utils/channelName.js';
import { decodeHtmlEntities } from '../../utils/text.js';
import { isSportsMarket } from './provider.js';

function fold(text: string) {
  return decodeHtmlEntities(text)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

function channelKey(name: string) {
  return fold(sanitizeChannelDisplayName(name)).replace(/[\s._-]/g, '');
}

export function sportsTitlesMatch(event: string, programme: string) {
  const key = (value: string) =>
    fold(value)
      .replace(/\s+(?:vs?\.?|x|@|×|[-–—])\s+/g, ' versus ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  const fixture = key(event);
  return fixture.includes(' versus ') && fixture === key(programme);
}

export async function selectSportsChannels(
  channels: MetaPreview[],
  broadcasters: string[],
  market: string,
  confirmProgramme: (channel: MetaPreview) => Promise<boolean>
) {
  const candidates = channels
    .filter(
      (channel) =>
        !channel.country ||
        (typeof channel.country === 'string' &&
          isSportsMarket(channel.country, market))
    )
    .map((channel) => ({
      channel,
      keys: [
        channel.name,
        ...(Array.isArray(channel.aliases) ? channel.aliases : []),
      ]
        .filter(
          (name): name is string => typeof name === 'string' && !!name.trim()
        )
        .map(channelKey),
    }));
  const selected = new Set<string>();
  for (const broadcaster of broadcasters) {
    const key = channelKey(broadcaster);
    if (!key) continue;
    const matches = candidates.filter(({ keys }) =>
      keys.some(
        (candidate) =>
          candidate === key ||
          (!/\d$/.test(key) &&
            candidate.startsWith(key) &&
            /^\d+$/.test(candidate.slice(key.length)))
      )
    );
    if (matches.length === 1 && matches[0].keys.includes(key)) {
      selected.add(matches[0].channel.id);
      continue;
    }
    const confirmed = (
      await Promise.all(
        matches.map(async ({ channel }) =>
          (await confirmProgramme(channel)) ? channel : undefined
        )
      )
    ).filter(Boolean);
    if (confirmed.length === 1 && confirmed[0]) selected.add(confirmed[0].id);
  }
  return [...selected];
}
