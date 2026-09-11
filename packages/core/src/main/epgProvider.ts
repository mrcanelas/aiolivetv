import type { Addon, Manifest } from '../db/index.js';
import { TV_TYPE } from '../utils/constants.js';

/**
 * Native EPG is only valid when the addon both advertises `epgProvider`
 * and exposes a TV catalog with the Stremio `date` extra (the guide).
 */
export function addonProvidesNativeEpg(
  manifest: Manifest | null | undefined,
  resources?: string[]
): boolean {
  const catalogEnabled = !resources?.length || resources.includes('catalog');
  if (!catalogEnabled) return false;
  if (manifest?.behaviorHints?.epgProvider !== true) return false;
  return Boolean(
    manifest.catalogs?.some(
      (catalog) =>
        catalog.type === TV_TYPE &&
        catalog.extra?.some((extra) => extra.name === 'date')
    )
  );
}

export function configurationProvidesNativeEpg(
  addons: Array<Pick<Addon, 'instanceId' | 'resources'>>,
  manifests: Record<string, Manifest | null | undefined>
): boolean {
  return addons.some((addon) =>
    addonProvidesNativeEpg(
      addon.instanceId ? manifests[addon.instanceId] : undefined,
      addon.resources
    )
  );
}
