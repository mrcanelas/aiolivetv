import { createHash } from 'node:crypto';
import type { UserData } from '../db/schemas.js';
import { Cache, createLogger } from '../utils/index.js';
import { AIOStreams } from '../main/index.js';
import { TV_TYPE } from '../utils/constants.js';
import { collectExportChannels, type ExportChannel } from './channels.js';
import { generateM3uPlaylist } from './m3u.js';
import {
  generateXmltvGuide,
  programmesFromMetaVideos,
  type ExportProgramme,
} from './xmltv.js';
import { buildExportPlayUrl, buildExportUrls } from './tokens.js';
import {
  assertExportEnabled,
  getExportInstancePolicy,
  resolveExportPlaybackMode,
} from './policy.js';

const logger = createLogger('export');
const playlistCache = Cache.getInstance<string, string>('export-m3u');
const guideCache = Cache.getInstance<string, string>('export-xmltv');
const PLAYLIST_CACHE_TTL = 120;
const GUIDE_CACHE_TTL = 300;

function exportCacheKey(token: string, userData: UserData): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        token,
        userData,
        getExportInstancePolicy(),
        buildExportUrls(token),
      ])
    )
    .digest('hex');
}

export type ExportSummary = {
  m3uUrl: string;
  xmltvUrl: string;
  channelCount: number;
  channelsWithEpg: number;
  channelsWithoutStream: number;
  playbackMode: 'redirect' | 'proxy';
  warnings: string[];
};

export function summariseExport(
  token: string,
  channels: ExportChannel[]
): ExportSummary {
  const urls = buildExportUrls(token);
  const withoutStream = channels.filter((c) => !c.hasStreamSource);
  const warnings: string[] = [];
  if (!channels.length) {
    warnings.push('No enabled channels in your saved configuration.');
  }
  if (withoutStream.length) {
    warnings.push(
      `${withoutStream.length} channels without enabled streams are omitted from the playlist.`
    );
  }
  const mode = resolveExportPlaybackMode();
  if (mode === 'redirect') {
    warnings.push(
      'Redirect playback requires your player to reach the stream provider directly.'
    );
  }
  return {
    ...urls,
    channelCount: channels.filter((c) => c.hasStreamSource).length,
    channelsWithEpg: 0,
    channelsWithoutStream: withoutStream.length,
    playbackMode: mode,
    warnings,
  };
}

export async function buildM3uForUser(
  token: string,
  userData: UserData
): Promise<{ body: string; channels: ExportChannel[] }> {
  assertExportEnabled();
  const channels = collectExportChannels(userData);
  await loadProgrammesForChannels(userData, channels);
  const { xmltvUrl } = buildExportUrls(token);
  const body = generateM3uPlaylist({
    channels,
    xmltvUrl,
    playUrlForChannel: (channelId) => buildExportPlayUrl(token, channelId),
  });
  return { body, channels };
}

export async function getCachedM3u(
  token: string,
  userData: UserData
): Promise<string> {
  const cacheKey = exportCacheKey(token, userData);
  const cached = await playlistCache.get(cacheKey);
  if (cached) return cached;
  const { body } = await buildM3uForUser(token, userData);
  await playlistCache.set(cacheKey, body, PLAYLIST_CACHE_TTL);
  return body;
}

async function loadProgrammesForChannels(
  userData: UserData,
  channels: ExportChannel[]
): Promise<{ programmes: ExportProgramme[]; channelsWithEpg: number }> {
  const policy = getExportInstancePolicy();
  const windowEnd = new Date(
    Date.now() + policy.epgWindowHours * 60 * 60 * 1000
  );
  let channelsWithEpg = 0;
  const programmes: ExportProgramme[] = [];

  let aio: AIOStreams;
  try {
    aio = await new AIOStreams(userData).initialise();
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'failed to initialise streams engine for export guide'
    );
    return { programmes, channelsWithEpg };
  }

  // Bound concurrency to avoid hammering providers when building the guide.
  const concurrency = 4;
  for (let i = 0; i < channels.length; i += concurrency) {
    const slice = channels.slice(i, i + concurrency);
    const results = await Promise.all(
      slice.map(async (channel) => {
        try {
          const response = await aio.getMeta(TV_TYPE, channel.id);
          const mapping = userData.channelMappings?.find(
            (item) => item.id === channel.id
          );
          if (!mapping?.name && response.data?.name)
            channel.name = response.data.name;
          if (!channel.logo && response.data?.poster)
            channel.logo = response.data.poster;
          if (!channel.group && response.data?.genres?.length)
            channel.group = response.data.genres[0];
          const videos = response.data?.videos ?? [];
          const channelProgrammes = programmesFromMetaVideos(
            channel.id,
            videos as Array<{
              title?: string;
              overview?: string | null;
              description?: string | null;
              released?: string | null;
              startTime?: string | null;
              endTime?: string | null;
              genres?: string[] | null;
            }>,
            windowEnd
          );
          return { channelId: channel.id, channelProgrammes };
        } catch (err) {
          logger.debug(
            {
              channelId: channel.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'export guide: channel meta unavailable'
          );
          return {
            channelId: channel.id,
            channelProgrammes: [] as ExportProgramme[],
          };
        }
      })
    );
    for (const result of results) {
      if (result.channelProgrammes.length) channelsWithEpg += 1;
      programmes.push(...result.channelProgrammes);
    }
  }

  channels.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
  return { programmes, channelsWithEpg };
}

export async function buildXmltvForUser(
  token: string,
  userData: UserData
): Promise<{
  body: string;
  channelsWithEpg: number;
  channels: ExportChannel[];
}> {
  assertExportEnabled();
  const channels = collectExportChannels(userData);
  const { programmes, channelsWithEpg } = await loadProgrammesForChannels(
    userData,
    channels
  );
  const body = generateXmltvGuide({
    channels,
    programmes,
    generatorName: 'AIOLiveTV',
  });
  void token;
  return { body, channelsWithEpg, channels };
}

export async function getCachedXmltv(
  token: string,
  userData: UserData
): Promise<string> {
  const cacheKey = exportCacheKey(token, userData);
  const cached = await guideCache.get(cacheKey);
  if (cached) return cached;
  const { body } = await buildXmltvForUser(token, userData);
  await guideCache.set(cacheKey, body, GUIDE_CACHE_TTL);
  return body;
}
