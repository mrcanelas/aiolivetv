import { config as appConfig } from '../config/index.js';

export type ExportInstancePolicy = {
  enabled: boolean;
  disabledReason?: string;
  proxyEnabled: boolean;
  epgWindowHours: number;
  allowPrivateUrls: boolean;
};

export function getExportInstancePolicy(): ExportInstancePolicy {
  const section = appConfig.builtins.export;
  return {
    enabled: section.enabled,
    disabledReason: section.enabled
      ? undefined
      : section.disabledReason.trim() ||
        'Disabled by this instance administrator',
    proxyEnabled: section.proxyEnabled,
    epgWindowHours: section.epgWindowHours,
    allowPrivateUrls: appConfig.bootstrap.allowPrivateUrls,
  };
}

export class ExportPolicyError extends Error {
  readonly code: 'disabled' | 'proxy_disabled';

  constructor(code: ExportPolicyError['code'], message: string) {
    super(message);
    this.name = 'ExportPolicyError';
    this.code = code;
  }
}

export function assertExportEnabled(): void {
  const policy = getExportInstancePolicy();
  if (!policy.enabled) {
    throw new ExportPolicyError(
      'disabled',
      policy.disabledReason ||
        'Disabled by this instance administrator'
    );
  }
}

export function assertExportProxyAllowed(): void {
  const policy = getExportInstancePolicy();
  if (!policy.proxyEnabled) {
    throw new ExportPolicyError(
      'proxy_disabled',
      'A reprodução por proxy da exportação está desabilitada pelo administrador desta instância'
    );
  }
}

export type ExportPlaybackMode = 'redirect' | 'proxy';

export function resolveExportPlaybackMode(): ExportPlaybackMode {
  return getExportInstancePolicy().proxyEnabled ? 'proxy' : 'redirect';
}
