import type { z } from 'zod';
import type { Manifest, Meta, MetaPreview, Stream } from '../../db/index.js';
import { TV_TYPE } from '../../utils/constants.js';
import { resolveNotWebReady } from '../../streams/web-readiness.js';
import {
  applyEpgTimeShift,
  bareChannelPreview,
  buildEpgCatalogResponse,
  channelGenreCatalogExtra,
  channelGenres,
  EPG_GUIDE_CATALOG_EXTRAS,
  guideChannelMeta,
  LIVE_TV_CATALOG_PAGE_SIZE,
  matchesCatalogGenre,
  programToVideo,
  resolveGuideDate,
  shiftedProgramOverlapsUtcDay,
  type CatalogHandlerResponse,
} from '../live-tv/epg.js';
import {
  CHANNEL_ID_PREFIX,
  decodeChannelId,
  encodeChannelId,
} from '../live-tv/shared.js';
import {
  channelIdentity,
  loadPlutoCatalog,
  parseChannelIdentity,
  resolvePlutoStreamUrlWithRetry,
  type PlutoChannel,
} from './client.js';
import { PlutoTvConfigSchema, type PlutoTvConfig } from './config.js';
import { assertPlutoTvEnabled } from './policy.js';
import { plutoTvRegionLabel } from './regions.js';

function encodedIdFor(channel: PlutoChannel): string {
  return encodeChannelId(channelIdentity(channel.region, channel.originalId));
}

function findChannel(
  channels: PlutoChannel[],
  rawId: string
): PlutoChannel | undefined {
  const parsed = parseChannelIdentity(rawId);
  if (parsed) {
    return channels.find(
      (channel) =>
        channel.originalId.toLowerCase() === parsed.originalId.toLowerCase() &&
        channel.region.toLowerCase() === parsed.region
    );
  }
  return channels.find(
    (channel) => channel.originalId.toLowerCase() === rawId.toLowerCase()
  );
}

export class PlutoTvAddon {
  private readonly config: PlutoTvConfig;

  constructor(config: z.input<typeof PlutoTvConfigSchema>) {
    this.config = PlutoTvConfigSchema.parse(config);
  }

  async getManifest(): Promise<Manifest> {
    assertPlutoTvEnabled();
    let groups: Array<string | undefined> = [];
    let epgProvider = false;
    const label = plutoTvRegionLabel(this.config.region);
    try {
      const { m3u, xmltv } = await loadPlutoCatalog(this.config);
      groups = m3u.channels.map((channel) => channel.group);
      epgProvider = m3u.channels.some(
        (channel) =>
          (xmltv.data.programsByChannelId.get(channel.originalId.toLowerCase())
            ?.length ?? 0) > 0
      );
    } catch {
      groups = [];
    }
    return {
      id: 'org.aiolivetv.pluto-tv',
      name: `Pluto TV (${label})`,
      version: '1.0.0',
      description: `Live channels, EPG and streams from community Pluto TV playlists (${label}). Not an official Pluto TV API.`,
      types: [TV_TYPE],
      resources: [
        {
          name: 'catalog',
          types: [TV_TYPE],
          idPrefixes: [CHANNEL_ID_PREFIX],
        },
        { name: 'meta', types: [TV_TYPE], idPrefixes: [CHANNEL_ID_PREFIX] },
        { name: 'stream', types: [TV_TYPE], idPrefixes: [CHANNEL_ID_PREFIX] },
      ],
      catalogs: [
        {
          id: 'pluto-tv-channels',
          type: TV_TYPE,
          name: `Pluto TV ${label}`,
          extra: [
            ...EPG_GUIDE_CATALOG_EXTRAS,
            channelGenreCatalogExtra(groups),
          ],
        },
      ],
      ...(epgProvider ? { behaviorHints: { epgProvider: true } } : {}),
    };
  }

  async getCatalog(skip = 0, genre?: string): Promise<MetaPreview[]> {
    assertPlutoTvEnabled();
    const { m3u } = await loadPlutoCatalog(this.config);
    return m3u.channels
      .filter((channel) => matchesCatalogGenre(channel.group, genre))
      .slice(skip, skip + LIVE_TV_CATALOG_PAGE_SIZE)
      .map((channel) =>
        bareChannelPreview({
          id: encodedIdFor(channel),
          name: channel.name,
          poster: channel.logo,
          // Keep the original tvg-id so export/guide mapping stays exact.
          tvgId: channel.originalId,
          country: channel.region.toUpperCase(),
          genres: channelGenres(channel.group),
        })
      );
  }

  async getCatalogGuide(
    skip = 0,
    date?: string,
    genre?: string
  ): Promise<Meta[]> {
    assertPlutoTvEnabled();
    const guideDate = resolveGuideDate(date);
    const { m3u, xmltv } = await loadPlutoCatalog(this.config);
    const page = m3u.channels
      .filter((channel) => matchesCatalogGenre(channel.group, genre))
      .slice(skip, skip + LIVE_TV_CATALOG_PAGE_SIZE);

    return page.map((channel) => {
      const encodedId = encodedIdFor(channel);
      const programs =
        xmltv.data.programsByChannelId.get(
          channel.originalId.trim().toLowerCase()
        ) ?? [];
      const videos = programs
        .filter((program) =>
          shiftedProgramOverlapsUtcDay(
            program,
            guideDate,
            this.config.timeShiftMinutes
          )
        )
        .map((program) => {
          const { startTime, endTime } = applyEpgTimeShift(
            program.startTime,
            program.endTime,
            this.config.timeShiftMinutes
          );
          return programToVideo({
            channelEncodedId: encodedId,
            title: program.title,
            subtitle: program.subtitle,
            description: program.description,
            thumbnail: program.thumbnail,
            startTime,
            endTime,
            airedYear: program.released?.slice(0, 4),
            categories: program.categories,
            cast: program.cast,
            directors: program.directors,
            ratings: program.ratings,
          });
        });
      return guideChannelMeta(
        {
          id: encodedId,
          name: channel.name,
          logo: channel.logo,
          tvgId: channel.originalId,
          country: channel.region.toUpperCase(),
          genres: channelGenres(channel.group),
        },
        videos
      );
    });
  }

  async getCatalogResponse(
    skip = 0,
    date?: string,
    genre?: string
  ): Promise<CatalogHandlerResponse> {
    return buildEpgCatalogResponse(
      (pageSkip) => this.getCatalog(pageSkip, genre),
      (pageSkip, guideDate) => this.getCatalogGuide(pageSkip, guideDate, genre),
      skip,
      date
    );
  }

  async getMeta(id: string): Promise<Meta> {
    assertPlutoTvEnabled();
    const rawId = decodeChannelId(id);
    const { m3u, xmltv } = await loadPlutoCatalog(this.config);
    const channel = findChannel(m3u.channels, rawId);
    if (!channel) throw new Error(`Channel not found: ${rawId}`);

    const encodedId = encodedIdFor(channel);
    const guideDate = resolveGuideDate();
    const programs =
      xmltv.data.programsByChannelId.get(
        channel.originalId.trim().toLowerCase()
      ) ?? [];
    const videos = programs
      .filter((program) =>
        shiftedProgramOverlapsUtcDay(
          program,
          guideDate,
          this.config.timeShiftMinutes
        )
      )
      .map((program) => {
        const { startTime, endTime } = applyEpgTimeShift(
          program.startTime,
          program.endTime,
          this.config.timeShiftMinutes
        );
        return programToVideo({
          channelEncodedId: encodedId,
          title: program.title,
          subtitle: program.subtitle,
          description: program.description,
          thumbnail: program.thumbnail,
          startTime,
          endTime,
          airedYear: program.released?.slice(0, 4),
          categories: program.categories,
          cast: program.cast,
          directors: program.directors,
          ratings: program.ratings,
        });
      })
      .sort((a, b) => (a.released ?? '').localeCompare(b.released ?? ''));

    return {
      id: encodedId,
      type: TV_TYPE,
      name: channel.name,
      poster: channel.logo,
      posterShape: 'square',
      logo: channel.logo,
      tvgId: channel.originalId,
      country: channel.region.toUpperCase(),
      genres: channelGenres(channel.group),
      behaviorHints: { hasScheduledVideos: videos.length > 0 },
      videos: videos.length ? videos : undefined,
    };
  }

  async getStreams(id: string): Promise<Stream[]> {
    assertPlutoTvEnabled();
    const rawId = decodeChannelId(id);
    const parsed = parseChannelIdentity(rawId);
    if (parsed && parsed.region !== this.config.region) return [];
    const originalId = parsed?.originalId ?? rawId;
    const { url } = await resolvePlutoStreamUrlWithRetry(
      this.config,
      originalId
    );
    const { m3u } = await loadPlutoCatalog(this.config);
    const channel = m3u.byOriginalId.get(originalId.toLowerCase());
    const stream: Stream = {
      url,
      name: channel?.name || 'Pluto TV',
      description: `Pluto TV · ${this.config.region.toUpperCase()}`,
    };
    const notWebReady = await resolveNotWebReady(stream, { probe: false });
    return [
      notWebReady
        ? { ...stream, behaviorHints: { notWebReady: true } }
        : stream,
    ];
  }
}
