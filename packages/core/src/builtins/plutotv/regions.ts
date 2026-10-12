/**
 * Regional catalogs verified to have both:
 * - OwnerPlugins/pluto-tv-m3u `pluto-live-XX.m3u`
 * - matthuisman/i.mjh.nz `PlutoTV/xx.xml.gz`
 *
 * Do not invent country codes — only list pairs that were checked.
 */
export const PLUTO_TV_REGIONS = [
  { code: 'ar', name: 'Argentina' },
  { code: 'br', name: 'Brazil' },
  { code: 'ca', name: 'Canada' },
  { code: 'cl', name: 'Chile' },
  { code: 'de', name: 'Germany' },
  { code: 'dk', name: 'Denmark' },
  { code: 'es', name: 'Spain' },
  { code: 'fr', name: 'France' },
  { code: 'gb', name: 'United Kingdom' },
  { code: 'it', name: 'Italy' },
  { code: 'mx', name: 'Mexico' },
  { code: 'no', name: 'Norway' },
  { code: 'se', name: 'Sweden' },
  { code: 'us', name: 'United States' },
] as const;

export type PlutoTvRegionCode = (typeof PLUTO_TV_REGIONS)[number]['code'];

export const PLUTO_TV_REGION_CODES = PLUTO_TV_REGIONS.map(
  (region) => region.code
) as [PlutoTvRegionCode, ...PlutoTvRegionCode[]];

const byCode = new Map(
  PLUTO_TV_REGIONS.map((region) => [region.code, region])
);

export function plutoTvRegion(code: string) {
  return byCode.get(code as PlutoTvRegionCode) ?? byCode.get('br')!;
}

export function plutoTvRegionLabel(code: string): string {
  return plutoTvRegion(code).name;
}

/** Community live playlist (OwnerPlugins/pluto-tv-m3u). */
export function plutoTvM3uUrl(region: PlutoTvRegionCode): string {
  const code = region.toUpperCase();
  return `https://raw.githubusercontent.com/OwnerPlugins/pluto-tv-m3u/main/pluto-live-${code}.m3u`;
}

/** Community guide (matthuisman/i.mjh.nz PlutoTV/). Prefer regional .xml.gz. */
export function plutoTvXmltvUrl(region: PlutoTvRegionCode): string {
  return `https://raw.githubusercontent.com/matthuisman/i.mjh.nz/master/PlutoTV/${region}.xml.gz`;
}
