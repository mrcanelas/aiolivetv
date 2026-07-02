import type { MenuId } from '../../../core/src/utils/fieldMeta';

/** Top-level configure pages for the AIOLiveTV scope (see AGENTS.md). */
export const CONFIGURE_VISIBLE_MENUS = [
  'about',
  'addons',
  'channels',
  'formatter',
  'miscellaneous',
  'save-install',
] as const satisfies readonly MenuId[];

const VISIBLE_MENU_SET = new Set<string>(CONFIGURE_VISIBLE_MENUS);

export function isConfigureMenuVisible(menu: MenuId): boolean {
  return VISIBLE_MENU_SET.has(menu);
}

/** Miscellaneous sub-tabs kept for Live TV (hide vod preload/playback tuning). */
export const CONFIGURE_VISIBLE_MISC_SUB_TABS = [
  'builtins',
  'display',
  'parent',
] as const;
