import type { UserData } from '../db/schemas.js';
import { AIOStreams } from '../main/index.js';
import { TV_TYPE } from '../utils/constants.js';
import { createLogger } from '../utils/index.js';
import { collectExportChannels } from './channels.js';
import {
  assertExportEnabled,
  assertExportProxyAllowed,
  resolveExportPlaybackMode,
  type ExportPlaybackMode,
} from './policy.js';

const logger = createLogger('export');

export type ResolvedExportStream = {
  url: string;
  headers?: Record<string, string>;
  mode: ExportPlaybackMode;
  channelId: string;
};

/**
 * Resolve a playable stream for an exported channel at request time.
 * Does not embed temporary provider URLs into the playlist.
 */
export async function resolveExportStream(
  userData: UserData,
  channelId: string
): Promise<ResolvedExportStream> {
  assertExportEnabled();
  if (
    !collectExportChannels(userData).some(
      (channel) => channel.id === channelId && channel.hasStreamSource
    )
  ) {
    throw Object.assign(new Error('Canal indisponível na configuração salva'), {
      code: 'not_found',
    });
  }
  const mode = resolveExportPlaybackMode();
  if (mode === 'proxy') {
    assertExportProxyAllowed();
  }

  const aio = await new AIOStreams(userData).initialise();
  const response = await aio.getStreams(channelId, TV_TYPE);
  const streams = response.data?.streams ?? [];
  const playable = streams.find((stream) => stream.url);
  if (!playable?.url) {
    throw Object.assign(new Error('Nenhuma fonte de reprodução disponível'), {
      code: 'not_found' as const,
    });
  }

  const headers: Record<string, string> = {};
  if (playable.requestHeaders) {
    for (const [key, value] of Object.entries(playable.requestHeaders)) {
      if (typeof value === 'string' && value) headers[key] = value;
    }
  }

  // Redirect must not be used to "hide" permanent credentials in the URL.
  if (mode === 'redirect') {
    if (Object.keys(headers).length) {
      throw Object.assign(
        new Error(
          'Esta fonte exige cabeçalhos de reprodução. Habilite o proxy de exportação na instância ou use outra fonte.'
        ),
        { code: 'proxy_required' }
      );
    }
    try {
      const parsed = new URL(playable.url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Unsupported stream protocol');
      }
      if (parsed.username || parsed.password) {
        logger.warn(
          { channelId },
          'export stream URL contains embedded credentials; refusing redirect'
        );
        throw Object.assign(
          new Error(
            'Esta fonte exige credenciais na URL. Habilite o proxy de exportação na instância ou use outra fonte.'
          ),
          { code: 'proxy_required' as const }
        );
      }
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err) throw err;
      throw Object.assign(new Error('URL de stream inválida'), {
        code: 'error' as const,
      });
    }
  }

  return {
    url: playable.url,
    headers: Object.keys(headers).length ? headers : undefined,
    mode,
    channelId,
  };
}
