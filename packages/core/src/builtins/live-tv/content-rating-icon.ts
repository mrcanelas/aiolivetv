import { getIconUrl } from 'age-rating-kit';

export function getContentRatingIconUrl(
  system?: string,
  value?: string
): string | undefined {
  const baseUrl = process.env.AIOLIVETV_AGE_RATING_ICONS_BASE_URL?.replace(
    /\/+$/,
    ''
  );
  return getIconUrl(system, value, baseUrl ? { baseUrl } : undefined);
}
