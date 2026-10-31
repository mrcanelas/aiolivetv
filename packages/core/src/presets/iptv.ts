import { z } from 'zod';
import type { Addon, Option, PresetMetadata, UserData } from '../db/index.js';
import {
  IPTV_ORG_COUNTRIES,
  IPTV_EPG_COUNTRIES,
  IptvOrgConfigSchema,
  IptvEpgConfigSchema,
} from '../builtins/iptv/config.js';
import { appConfig, constants, toUrlSafeBase64 } from '../utils/index.js';
import { Preset, baseOptions } from './preset.js';
import { M3uPreset } from './liveTv.js';

function metadata(guide: boolean): PresetMetadata {
  const id = guide ? 'iptv-epg' : 'iptv-org';
  const name = guide ? 'IPTV-EPG' : 'IPTV-org';
  const resources = guide
    ? [constants.CATALOG_RESOURCE, constants.META_RESOURCE]
    : [
        constants.CATALOG_RESOURCE,
        constants.META_RESOURCE,
        constants.STREAM_RESOURCE,
      ];
  const timeout = Math.max(appConfig.presets.defaultTimeout, 30_000);
  const countries = guide ? IPTV_EPG_COUNTRIES : IPTV_ORG_COUNTRIES;
  const options: Option[] = [
    ...baseOptions(name, resources, timeout).filter(
      (option) => option.id !== 'url'
    ),
    {
      id: 'countries',
      name: 'Countries',
      type: 'multi-select',
      description: guide
        ? 'Choose programme guides. Streams must come from IPTV-org or another source.'
        : 'Choose country playlists. Link streams to guide channels in Channels; some streams are geo-blocked or unavailable.',
      required: true,
      showInSimpleMode: true,
      default: [guide ? 'gb' : 'uk'],
      options: countries.map((country) => ({
        label: country.name,
        value: country.code,
      })),
    },
  ];
  if (guide)
    options.push({
      id: 'timeShiftMinutes',
      name: 'EPG Time Shift (minutes)',
      type: 'number',
      description:
        'Shift programme times; positive values move programmes later.',
      default: 0,
      showInSimpleMode: true,
      constraints: { min: -720, max: 720, forceInUi: false },
    });
  return {
    ID: id,
    NAME: name,
    LOGO: guide ? '/assets/iptv_epg.png' : '/assets/iptv_org.png',
    URL: [`${appConfig.bootstrap.internalUrl}/builtins/live-tv/${id}`],
    TIMEOUT: timeout,
    USER_AGENT: appConfig.http.defaultUserAgent,
    DESCRIPTION: guide
      ? 'Channel metadata, catalogs and EPG from IPTV-EPG.org. No streams. Coverage varies by country.'
      : 'Channels and live streams from IPTV-org country playlists. Add a guide separately and review matches in Channels.',
    OPTIONS: options,
    SUPPORTED_SERVICES: [],
    SUPPORTED_STREAM_TYPES: guide ? [] : [constants.LIVE_STREAM_TYPE],
    SUPPORTED_RESOURCES: resources,
    BUILTIN: true,
    CATEGORY: guide
      ? constants.PresetCategory.META_CATALOGS
      : constants.PresetCategory.STREAMS,
  };
}

async function generateAddons(
  guide: boolean,
  options: Record<string, any>
): Promise<Addon[]> {
  const meta = metadata(guide);
  const schema = guide ? IptvEpgConfigSchema : IptvOrgConfigSchema;
  const countries = [
    ...new Set(
      z
        .array(schema.shape.country)
        .min(1)
        .parse(options.countries ?? [guide ? 'gb' : 'uk'])
    ),
  ];
  return countries.map((country) => {
    const config = schema.parse({
      country,
      timeout: options.timeout ?? meta.TIMEOUT,
      maxBytes: guide
        ? appConfig.resources.iptvEpgSourceMaxBytes
        : appConfig.resources.liveTvSourceMaxBytes,
      timeShiftMinutes: options.timeShiftMinutes ?? 0,
    });
    const label =
      (guide ? IPTV_EPG_COUNTRIES : IPTV_ORG_COUNTRIES).find(
        (item) => item.code === country
      )?.name ?? country;
    const resources = z
      .array(
        guide
          ? z.enum(['catalog', 'meta'])
          : z.enum(['catalog', 'meta', 'stream'])
      )
      .min(1)
      .parse(options.resources ?? meta.SUPPORTED_RESOURCES);
    return {
      identifier: country,
      name: `${options.name?.trim() || meta.NAME} (${label})`,
      manifestUrl: `${meta.URL[0]}/${toUrlSafeBase64(JSON.stringify(config))}/manifest.json`,
      enabled: true,
      resources,
      timeout: config.timeout,
      resultPassthrough: true,
      preset: { id: '', type: meta.ID, options },
      headers: { 'User-Agent': meta.USER_AGENT },
    };
  });
}

export class IptvOrgPreset extends Preset {
  static override get METADATA() {
    return metadata(false);
  }
  static override getParser() {
    return M3uPreset.getParser();
  }
  static override async generateAddons(
    _userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    return generateAddons(false, options);
  }
}

export class IptvEpgPreset extends Preset {
  static override get METADATA() {
    return metadata(true);
  }
  static override async generateAddons(
    _userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    return generateAddons(true, options);
  }
}
