import { config as appConfig } from '../../config/index.js';
import { FeatureControl } from '../../utils/feature.js';
import { SsrfError, assertSafeOutboundUrl } from '../../utils/ssrf.js';

export const TVHEADEND_PRESET_ID = 'tvheadend';

export type TvheadendInstancePolicy = {
  enabled: boolean;
  disabledReason?: string;
  allowPrivateUrls: boolean;
  proxyEnabled: boolean;
};

export function getTvheadendInstancePolicy(): TvheadendInstancePolicy {
  const disabledByFeature = FeatureControl.disabledAddons.has(
    TVHEADEND_PRESET_ID
  );
  const removedByFeature = FeatureControl.removedAddons.has(
    TVHEADEND_PRESET_ID
  );
  const enabledByConfig = appConfig.builtins.tvheadend.enabled;

  if (removedByFeature) {
    return {
      enabled: false,
      disabledReason:
        FeatureControl.removedAddons.get(TVHEADEND_PRESET_ID) ||
        'Removido pelo administrador desta instância',
      allowPrivateUrls: appConfig.bootstrap.allowPrivateUrls,
      proxyEnabled: appConfig.builtins.tvheadend.proxyEnabled,
    };
  }

  if (disabledByFeature) {
    return {
      enabled: false,
      disabledReason:
        FeatureControl.disabledAddons.get(TVHEADEND_PRESET_ID) ||
        'Desabilitado pelo administrador desta instância',
      allowPrivateUrls: appConfig.bootstrap.allowPrivateUrls,
      proxyEnabled: appConfig.builtins.tvheadend.proxyEnabled,
    };
  }

  if (!enabledByConfig) {
    return {
      enabled: false,
      disabledReason:
        appConfig.builtins.tvheadend.disabledReason.trim() ||
        'Desabilitado pelo administrador desta instância',
      allowPrivateUrls: appConfig.bootstrap.allowPrivateUrls,
      proxyEnabled: appConfig.builtins.tvheadend.proxyEnabled,
    };
  }

  return {
    enabled: true,
    allowPrivateUrls: appConfig.bootstrap.allowPrivateUrls,
    proxyEnabled: appConfig.builtins.tvheadend.proxyEnabled,
  };
}

export function formatTvheadendDisabledReason(reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed) {
    return 'Desabilitado pelo administrador desta instância';
  }
  if (
    trimmed.startsWith('Desabilitado pelo administrador') ||
    trimmed.startsWith('Removido pelo administrador')
  ) {
    return trimmed;
  }
  return `Desabilitado pelo administrador desta instância. ${trimmed}`;
}

export class TvheadendPolicyError extends Error {
  readonly code:
    | 'disabled'
    | 'private_blocked'
    | 'proxy_disabled'
    | 'invalid_url';

  constructor(
    code: TvheadendPolicyError['code'],
    message: string
  ) {
    super(message);
    this.name = 'TvheadendPolicyError';
    this.code = code;
  }
}

export function assertTvheadendEnabled(): void {
  const policy = getTvheadendInstancePolicy();
  if (!policy.enabled) {
    throw new TvheadendPolicyError(
      'disabled',
      formatTvheadendDisabledReason(
        policy.disabledReason ||
          'Desabilitado pelo administrador desta instância'
      )
    );
  }
}

export async function assertTvheadendUrlAllowed(
  input: string
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new TvheadendPolicyError('invalid_url', 'URL inválida');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TvheadendPolicyError(
      'invalid_url',
      `Protocolo não suportado: ${url.protocol}`
    );
  }

  const policy = getTvheadendInstancePolicy();
  if (policy.allowPrivateUrls) {
    return url;
  }

  try {
    return await assertSafeOutboundUrl(url);
  } catch (err) {
    if (err instanceof SsrfError) {
      throw new TvheadendPolicyError(
        'private_blocked',
        `Endereço bloqueado pela política da instância: ${err.message}`
      );
    }
    throw err;
  }
}

export function assertTvheadendProxyAllowed(): void {
  const policy = getTvheadendInstancePolicy();
  if (!policy.proxyEnabled) {
    throw new TvheadendPolicyError(
      'proxy_disabled',
      'A reprodução por proxy está desabilitada pelo administrador desta instância'
    );
  }
}
