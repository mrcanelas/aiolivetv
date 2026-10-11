import { config as appConfig } from '../../config/index.js';
import { encryptString, decryptString } from '../../utils/crypto.js';
import { TvheadendConfigSchema, type TvheadendConfig } from './config.js';

export type TvheadendProxyKind = 'stream' | 'logo';

export type TvheadendProxyPayload = {
  kind: TvheadendProxyKind;
  channelUuid?: string;
  assetPath?: string;
  config: TvheadendConfig;
};

export function buildTvheadendProxyUrl(
  config: TvheadendConfig,
  channelUuid: string,
  kind: TvheadendProxyKind = 'stream'
): string {
  const payload: TvheadendProxyPayload = {
    kind,
    channelUuid,
    config,
  };
  const { success, data, error } = encryptString(JSON.stringify(payload));
  if (!success || !data) {
    throw new Error(`Failed to encrypt TVHeadend proxy payload: ${error}`);
  }
  return `${appConfig.bootstrap.baseUrl}/api/v1/tvheadend/proxy/${data}`;
}

export function buildTvheadendLogoProxyUrl(
  config: TvheadendConfig,
  assetUrl: string
): string {
  let assetPath = assetUrl;
  try {
    const parsed = new URL(assetUrl);
    assetPath = `${parsed.pathname}${parsed.search}`;
  } catch {
    assetPath = assetUrl;
  }
  const payload: TvheadendProxyPayload = {
    kind: 'logo',
    assetPath,
    config,
  };
  const { success, data, error } = encryptString(JSON.stringify(payload));
  if (!success || !data) {
    throw new Error(`Failed to encrypt TVHeadend logo payload: ${error}`);
  }
  return `${appConfig.bootstrap.baseUrl}/api/v1/tvheadend/proxy/${data}`;
}

export function decryptTvheadendProxyPayload(
  token: string
): TvheadendProxyPayload {
  const { success, data, error } = decryptString(token);
  if (!success || !data) {
    throw new Error(error || 'Invalid TVHeadend proxy token');
  }
  const parsed = JSON.parse(data) as TvheadendProxyPayload;
  const config = TvheadendConfigSchema.parse(parsed.config);
  return {
    kind: parsed.kind === 'logo' ? 'logo' : 'stream',
    channelUuid: parsed.channelUuid,
    assetPath: parsed.assetPath,
    config,
  };
}
