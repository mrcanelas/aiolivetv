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
  const disabledByFeature =
    FeatureControl.disabledAddons.has(TVHEADEND_PRESET_ID);
  const removedByFeature =
    FeatureControl.removedAddons.has(TVHEADEND_PRESET_ID);
  const enabledByConfig = appConfig.builtins.tvheadend.enabled;

  if (removedByFeature) {
    return {
      enabled: false,
      disabledReason:
        FeatureControl.removedAddons.get(TVHEADEND_PRESET_ID) ||
        'Removed by this instance administrator',
      allowPrivateUrls: appConfig.bootstrap.allowPrivateUrls,
      proxyEnabled: appConfig.builtins.tvheadend.proxyEnabled,
    };
  }

  if (disabledByFeature) {
    return {
      enabled: false,
      disabledReason:
        FeatureControl.disabledAddons.get(TVHEADEND_PRESET_ID) ||
        'Disabled by this instance administrator',
      allowPrivateUrls: appConfig.bootstrap.allowPrivateUrls,
      proxyEnabled: appConfig.builtins.tvheadend.proxyEnabled,
    };
  }

  if (!enabledByConfig) {
    return {
      enabled: false,
      disabledReason:
        appConfig.builtins.tvheadend.disabledReason.trim() ||
        'Disabled by this instance administrator',
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
    return 'Disabled by this instance administrator';
  }
  if (
    trimmed.startsWith('Disabled by this instance administrator') ||
    trimmed.startsWith('Removed by this instance administrator')
  ) {
    return trimmed;
  }
  return `Disabled by this instance administrator. ${trimmed}`;
}

export class TvheadendPolicyError extends Error {
  readonly code:
    | 'disabled'
    | 'private_blocked'
    | 'proxy_disabled'
    | 'invalid_url';

  constructor(code: TvheadendPolicyError['code'], message: string) {
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
        policy.disabledReason || 'Disabled by this instance administrator'
      )
    );
  }
}

export async function assertTvheadendUrlAllowed(input: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new TvheadendPolicyError('invalid_url', 'Invalid URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TvheadendPolicyError(
      'invalid_url',
      `Unsupported protocol: ${url.protocol}`
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
        `Address blocked by this instance policy: ${err.message}`
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
      'Proxy playback is disabled by this instance administrator'
    );
  }
}
