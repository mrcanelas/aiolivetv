import { getIconUrl } from 'age-rating-kit';

const TVP_ICON_BASE =
  'https://s.tvp.pl/files/portale-v4/tvp-pl/default/assets/images/elements';

const TVP_RATING_ICONS: Record<string, string> = {
  '0': `${TVP_ICON_BASE}/smile_green.svg`,
  '1': `${TVP_ICON_BASE}/smile_green.svg`,
  bo: `${TVP_ICON_BASE}/smile_green.svg`,
  '7': `${TVP_ICON_BASE}/7.svg`,
  '12': `${TVP_ICON_BASE}/12.svg`,
  '16': `${TVP_ICON_BASE}/16.svg`,
  '18': `${TVP_ICON_BASE}/adult.svg`,
  jm: `${TVP_ICON_BASE}/jm.svg`,
  n: `${TVP_ICON_BASE}/N.svg`,
  napisy: `${TVP_ICON_BASE}/N.svg`,
  sub: `${TVP_ICON_BASE}/N.svg`,
  subbed: `${TVP_ICON_BASE}/N.svg`,
  ad: `${TVP_ICON_BASE}/AD.svg`,
  audiodesc: `${TVP_ICON_BASE}/AD.svg`,
  audiodeskrypcja: `${TVP_ICON_BASE}/AD.svg`,
};

function normalizedKey(value?: string): string | undefined {
  const key = value?.trim().toLowerCase();
  return key || undefined;
}

export function getContentRatingIconUrl(
  system?: string,
  value?: string
): string | undefined {
  if (normalizedKey(system) === 'tvp') {
    const icon = TVP_RATING_ICONS[normalizedKey(value) ?? ''];
    if (icon) return icon;
  }
  const baseUrl = process.env.AIOLIVETV_AGE_RATING_ICONS_BASE_URL?.replace(
    /\/+$/,
    ''
  );
  return getIconUrl(system, value, baseUrl ? { baseUrl } : undefined);
}
