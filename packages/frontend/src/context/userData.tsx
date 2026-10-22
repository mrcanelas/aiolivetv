import React from 'react';
import type { UserData } from '@aiolivetv/core';
import {
  applyMigrations,
  normalizeUserData,
} from '../../../core/src/utils/userConfig';
export {
  applyMigrations,
  removeInvalidPresetReferences,
} from '../../../core/src/utils/userConfig';
import { readLocalStorage, writeLocalStorage } from '@/utils/legacy-storage';
import { RESOLUTIONS } from '../../../core/src/utils/constants';
import { useStatus } from './status';

const USER_DATA_KEY = 'aiolivetv-user-data';

export function appendDiscoveredXmltvPresets(
  presets: UserData['presets'],
  urls: string[],
  timeout: number
): UserData['presets'] {
  const next = [...presets];
  const known = new Set(
    presets
      .filter((preset) => preset.type === 'xmltv')
      .map((preset) => {
        try {
          return new URL(preset.options.sourceUrl).href;
        } catch {
          return '';
        }
      })
  );
  for (const value of urls) {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || known.has(url.href))
        continue;
      known.add(url.href);
      next.push({
        type: 'xmltv',
        instanceId: crypto.randomUUID(),
        enabled: true,
        options: {
          name: `XMLTV (${url.hostname})`,
          sourceUrl: url.href,
          resources: ['catalog', 'meta'],
          timeout,
          timeShiftMinutes: 0,
        },
      });
    } catch {
      // Ignore invalid suggestions; the M3U itself remains usable.
    }
  }
  return next;
}

export const DefaultUserData: UserData = {
  presets: [],
  formatter: { id: 'gdrive' },
  preferredResolutions: [...RESOLUTIONS],
  sortCriteria: {
    global: [
      { key: 'addon', direction: 'desc' },
      { key: 'resolution', direction: 'desc' },
    ],
  },
};

interface UserDataContextType {
  userData: UserData;
  setUserData: (data: ((prev: UserData) => UserData | null) | null) => void;
  uuid: string | null;
  setUuid: (uuid: string | null) => void;
  password: string | null;
  setPassword: (password: string | null) => void;
  encryptedPassword: string | null;
  setEncryptedPassword: (encryptedPassword: string | null) => void;
}

const UserDataContext = React.createContext<UserDataContextType | undefined>(
  undefined
);

export function UserDataProvider({ children }: { children: React.ReactNode }) {
  const { status } = useStatus();

  // Initialize userData from local storage or apply default
  const [userData, setUserData] = React.useState<UserData>(() => {
    try {
      const stored = readLocalStorage(USER_DATA_KEY);
      const data = stored ? JSON.parse(stored) : DefaultUserData;
      return applyMigrations(data);
    } catch {
      return DefaultUserData;
    }
  });

  const [uuid, setUuid] = React.useState<string | null>(null);
  const [password, setPassword] = React.useState<string | null>(null);
  const [encryptedPassword, setEncryptedPassword] = React.useState<
    string | null
  >(null);

  // Effect to persist userData to local storage
  React.useEffect(() => {
    writeLocalStorage(USER_DATA_KEY, JSON.stringify(userData));
  }, [userData]);

  const statusApplied = React.useRef(false);

  React.useEffect(() => {
    if (!status || statusApplied.current) return;
    statusApplied.current = true;

    const forced = status.settings.forced;
    const defaults = status.settings.defaults;
    const services = status.settings.services;

    setUserData((prev) => {
      const newData = { ...prev };
      const configuredProxy = prev.proxy;
      newData.proxy = {
        ...configuredProxy,
        enabled:
          forced.proxy.enabled ??
          configuredProxy?.enabled ??
          defaults.proxy?.enabled ??
          undefined,
        id: (forced.proxy.id ??
          configuredProxy?.id ??
          defaults.proxy?.id ??
          'builtin') as 'builtin' | 'mediaflow' | 'stremthru' | undefined,
        url:
          forced.proxy.url ??
          configuredProxy?.url ??
          defaults.proxy?.url ??
          undefined,
        publicUrl:
          forced.proxy.publicUrl ??
          configuredProxy?.publicUrl ??
          defaults.proxy?.publicUrl ??
          undefined,
        publicIp:
          forced.proxy.publicIp ??
          configuredProxy?.publicIp ??
          defaults.proxy?.publicIp ??
          undefined,
        credentials:
          forced.proxy.credentials ??
          configuredProxy?.credentials ??
          defaults.proxy?.credentials ??
          undefined,
        proxiedServices:
          forced.proxy.proxiedServices ??
          configuredProxy?.proxiedServices ??
          defaults.proxy?.proxiedServices ??
          [],
      };

      newData.services = (newData.services ?? []).map((service) => {
        const serviceMeta = services[service.id];
        if (!serviceMeta) return service;
        const credentials = { ...service.credentials };
        serviceMeta.credentials.forEach((credential) => {
          if (credential.forced) {
            credentials[credential.id] = credential.forced;
          } else if (credential.default) {
            credentials[credential.id] =
              credentials[credential.id] ?? credential.default;
          }
        });
        const enabled =
          service.enabled ??
          serviceMeta.credentials.every(
            (credential) =>
              credential.forced ||
              credential.default ||
              credentials[credential.id] !== undefined
          );
        return { ...service, credentials, enabled };
      });

      return normalizeUserData(newData);
    });
  }, [status]);

  const safeSetUserData = (
    data: ((prev: UserData) => UserData | null) | null
  ) => {
    if (data === null) {
      setUserData(DefaultUserData);
    } else {
      setUserData((prev) => {
        const result = data(prev);
        return result === null ? DefaultUserData : normalizeUserData(result);
      });
    }
  };

  return (
    <UserDataContext.Provider
      value={{
        userData,
        setUserData: safeSetUserData,
        uuid,
        setUuid,
        password,
        setPassword,
        encryptedPassword,
        setEncryptedPassword,
      }}
    >
      {children}
    </UserDataContext.Provider>
  );
}

export function useUserData() {
  const context = React.useContext(UserDataContext);
  if (context === undefined) {
    throw new Error('useUserData must be used within a UserDataProvider');
  }
  return context;
}

export function useParentInheritance() {
  const { userData } = useUserData();
  const parentConfig = userData?.parentConfig;
  const strategies = parentConfig?.mergeStrategies;

  function isInherited(
    section:
      | 'presets'
      | 'services'
      | 'filters'
      | 'sorting'
      | 'formatter'
      | 'proxy'
      | 'metadata'
      | 'misc'
  ): boolean {
    if (!parentConfig) return false;
    const strategy = strategies?.[section] ?? 'inherit';
    return strategy === 'inherit';
  }

  return {
    hasParent: !!parentConfig,
    parentUuid: parentConfig?.uuid,
    isInherited,
  };
}
