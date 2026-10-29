import { config as appConfig } from '../config/index.js';
import { normalizeUserData } from '../utils/userConfig.js';
import {
  Addon,
  Manifest,
  StrictManifestResource,
  UserData,
} from '../db/index.js';
import { constants, ExtrasParser } from '../utils/index.js';
import Proxifier from '../streams/proxifier.js';
import StreamLimiter from '../streams/limiter.js';
import {
  StreamFetcher as Fetcher,
  StreamFilterer as Filterer,
  StreamSorter as Sorter,
  StreamDeduplicator as Deduplicator,
  StreamPrecomputer as Precomputer,
  StreamContext,
} from '../streams/index.js';
import type { AIOStreamsContext, AIOStreamsOptions } from './types.js';
import {
  applyPresets,
  assignPublicIps,
  fetchManifests,
  buildResources,
} from './setup.js';
import {
  getCatalog as _getCatalog,
  type GetCatalogOptions,
  applyPreferredChannelGuides,
} from './catalog.js';
import { configurationProvidesNativeEpg } from './epgProvider.js';
import { enrichEpgVideos } from '../metadata/tmdb.js';
import {
  getStreams as _getStreams,
  getMeta as _getMeta,
  getSubtitles as _getSubtitles,
  getAddonCatalog as _getAddonCatalog,
} from './resources.js';

export class AIOStreams {
  private ctx: AIOStreamsContext;

  constructor(userData: UserData, options?: AIOStreamsOptions) {
    userData = normalizeUserData(userData);
    const filterer = new Filterer(userData);
    const precomputer = new Precomputer(userData);
    this.ctx = {
      userData,
      options,
      manifestUrl: `${appConfig.bootstrap.baseUrl}/stremio/${userData.uuid}/${userData.encryptedPassword}/manifest.json`,
      manifests: {},
      supportedResources: {},
      finalResources: [],
      finalCatalogs: [],
      finalAddonCatalogs: [],
      isInitialised: false,
      addons: [],
      proxifier: new Proxifier(userData),
      limiter: new StreamLimiter(userData),
      filterer,
      precomputer,
      fetcher: new Fetcher(userData, filterer, precomputer),
      deduplicator: new Deduplicator(userData),
      sorter: new Sorter(userData),
      streamContext: null,
      addonInitialisationErrors: [],
    };
  }

  public async initialise(): Promise<AIOStreams> {
    if (this.ctx.isInitialised) return this;
    await applyPresets(this.ctx);
    await assignPublicIps(this.ctx);
    await fetchManifests(this.ctx);
    buildResources(this.ctx);
    this.ctx.isInitialised = true;
    return this;
  }

  private checkInitialised() {
    if (!this.ctx.isInitialised) {
      throw new Error('AIOLiveTV is not initialised. Call initialise() first.');
    }
  }

  public async getStreams(id: string, type: string) {
    return _getStreams(this.ctx, id, type);
  }

  public async getCatalog(
    type: string,
    id: string,
    extras?: string,
    options?: GetCatalogOptions
  ) {
    const result = await _getCatalog(this.ctx, type, id, extras, options);
    if (type === constants.TV_TYPE && result.metasDetailed?.length) {
      const date = new ExtrasParser(extras).date;
      if (date) {
        const preferred = await applyPreferredChannelGuides(
          this.ctx,
          result.metasDetailed,
          date
        );
        result.metasDetailed = preferred.items;
        if (!preferred.cacheable) result.cacheable = false;
      }
    }
    return result;
  }

  public async getMeta(type: string, id: string) {
    const result = await _getMeta(this.ctx, type, id);
    if (
      (type === constants.TV_TYPE || type === constants.CHANNEL_TYPE) &&
      result.data?.videos?.length
    ) {
      result.data.videos = await enrichEpgVideos(
        result.data.videos,
        this.ctx.userData
      );
    }
    return result;
  }

  public async getSubtitles(type: string, id: string, extras?: string) {
    return _getSubtitles(this.ctx, type, id, extras);
  }

  public async getAddonCatalog(type: string, id: string) {
    return _getAddonCatalog(this.ctx, type, id);
  }

  public getStreamContext(): StreamContext | null {
    return this.ctx.streamContext;
  }

  public getResources(): StrictManifestResource[] {
    this.checkInitialised();
    return this.ctx.finalResources;
  }

  public getCatalogs(): Manifest['catalogs'] {
    this.checkInitialised();
    return this.ctx.finalCatalogs;
  }

  public getAddonCatalogs(): Manifest['addonCatalogs'] {
    this.checkInitialised();
    return this.ctx.finalAddonCatalogs;
  }

  public getAddon(instanceId: string): Addon | undefined {
    return this.ctx.addons.find((a) => a.instanceId === instanceId);
  }

  public getAddons(): Addon[] {
    this.checkInitialised();
    return this.ctx.addons;
  }

  public getInitialisationErrors(): AIOStreamsContext['addonInitialisationErrors'] {
    return this.ctx.addonInitialisationErrors;
  }

  public getManifest(instanceId: string): Manifest | null | undefined {
    this.checkInitialised();
    return this.ctx.manifests[instanceId];
  }

  public hasEpgProvider(): boolean {
    this.checkInitialised();
    return configurationProvidesNativeEpg(this.ctx.addons, this.ctx.manifests);
  }
}
