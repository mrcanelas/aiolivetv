import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
} from 'react';
import type { MenuId } from '../../../core/src/utils/fieldMeta';
import { CONFIGURE_VISIBLE_MENUS } from '@/constants/configure-menus';

export type { MenuId };

type MenuContextType = {
  selectedMenu: MenuId;
  setSelectedMenu: (menu: MenuId) => void;
  nextMenu: () => void;
  previousMenu: () => void;
  firstMenu: MenuId;
  lastMenu: MenuId;
};

const MenuContext = createContext<MenuContextType>({
  selectedMenu: 'about',
  setSelectedMenu: () => {},
  nextMenu: () => {},
  previousMenu: () => {},
  firstMenu: 'about',
  lastMenu: 'save-install',
});

export function MenuProvider({ children }: { children: React.ReactNode }) {
  const menus = useMemo((): MenuId[] => [...CONFIGURE_VISIBLE_MENUS], []);
  const defaultMenu = CONFIGURE_VISIBLE_MENUS[0];

  const initialMenu = (() => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      const menu = url.searchParams.get('menu');
      if (menu && (menus as string[]).includes(menu)) {
        return menu as MenuId;
      }
    }
    return defaultMenu;
  })();

  const [selectedMenu, setInternalSelectedMenu] = useState<MenuId>(initialMenu);

  useEffect(() => {
    if (!menus.includes(selectedMenu)) {
      setInternalSelectedMenu(menus[0] ?? defaultMenu);
    }
  }, [menus, selectedMenu, defaultMenu]);

  const setSelectedMenu = (menu: MenuId) => {
    window.scrollTo(0, 0);
    setInternalSelectedMenu(menu);
  };

  const firstMenu = menus[0];
  const lastMenu = menus[menus.length - 1];

  const nextMenu = () => {
    const currentIndex = menus.indexOf(selectedMenu);
    const nextIndex = (currentIndex + 1) % menus.length;
    setSelectedMenu(menus[nextIndex]);
  };

  const previousMenu = () => {
    const currentIndex = menus.indexOf(selectedMenu);
    const previousIndex = (currentIndex - 1 + menus.length) % menus.length;
    setSelectedMenu(menus[previousIndex]);
  };

  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedMenu !== 'about') {
      url.searchParams.set('menu', selectedMenu);
    } else {
      url.searchParams.delete('menu');
    }
    window.history.replaceState({}, '', url.toString());
  }, [selectedMenu]);

  return (
    <MenuContext.Provider
      value={{
        selectedMenu,
        setSelectedMenu,
        nextMenu,
        previousMenu,
        firstMenu,
        lastMenu,
      }}
    >
      {children}
    </MenuContext.Provider>
  );
}

export const useMenu = () => useContext(MenuContext);
