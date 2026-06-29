import type {
  Addon,
  Option,
  ParsedStream,
  Stream,
  UserData,
} from '../db/index.js';
import StreamParser from '../parser/streams.js';
import { appConfig, constants, toUrlSafeBase64 } from '../utils/index.js';
import { Preset } from './preset.js';

class LiveTvStreamParser extends StreamParser {
  protected override getStreamType(
    _stream: Stream,
    _service: ParsedStream['service'],
    _currentParsedStream: ParsedStream
  ): ParsedStream['type'] {
    return constants.LIVE_STREAM_TYPE;
  }
}

const sourceOptions = (
  name: string,
  resources: ('catalog' | 'meta' | 'stream')[]
): Option[] => [
  {
    id: 'resources',
    name: 'Resources',
    description:
      'Choose what to use from this source. Select only Stream to match streams to channels from other providers without listing its channels.',
    type: 'multi-select',
    required: false,
    showInSimpleMode: true,
    default: resources,
    options: resources.map((resource) => ({
      label: constants.RESOURCE_LABELS[resource],
      value: resource,
    })),
  },
  {
    id: 'name',
    name: 'Name',
    description: 'What to call this addon',
    type: 'string',
    required: true,
    default: name,
  },
  {
    id: 'sourceUrl',
    name: `${name} URL`,
    description: `URL of the ${name} source`,
    type: 'url',
    required: true,
  },
  {
    id: 'timeout',
    name: 'Timeout (ms)',
    description: 'Timeout for fetching the source',
    type: 'number',
    required: true,
    default: appConfig.presets.defaultTimeout,
    constraints: {
      min: appConfig.userLimits.timeouts.minTimeout,
      max: appConfig.userLimits.timeouts.maxTimeout,
      forceInUi: false,
    },
  },
];

function generateAddon(
  type: 'xmltv' | 'm3u',
  name: string,
  resources: ('catalog' | 'meta' | 'stream')[],
  options: Record<string, any>
): Addon {
  const config = {
    sourceUrl: options.sourceUrl,
    timeout: options.timeout || appConfig.presets.defaultTimeout,
  };
  return {
    name: options.name || name,
    manifestUrl: `${appConfig.bootstrap.internalUrl}/builtins/live-tv/${type}/${toUrlSafeBase64(JSON.stringify(config))}/manifest.json`,
    enabled: true,
    resources: options.resources || resources,
    timeout: config.timeout,
    resultPassthrough: true,
    preset: { id: '', type, options },
    headers: { 'User-Agent': appConfig.http.defaultUserAgent },
  };
}

export class XmltvPreset extends Preset {
  static override get METADATA() {
    const resources = [constants.CATALOG_RESOURCE, constants.META_RESOURCE];
    return {
      ID: 'xmltv',
      NAME: 'XMLTV',
      LOGO: '',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/live-tv/xmltv`],
      TIMEOUT: appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: [],
      DESCRIPTION: 'Channel metadata and catalogs from an XMLTV guide.',
      OPTIONS: sourceOptions('XMLTV', resources),
      SUPPORTED_STREAM_TYPES: [],
      SUPPORTED_RESOURCES: resources,
      BUILTIN: true,
      CATEGORY: constants.PresetCategory.META_CATALOGS,
    };
  }

  static override async generateAddons(
    _userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    return [
      generateAddon(
        'xmltv',
        this.METADATA.NAME,
        this.METADATA.SUPPORTED_RESOURCES,
        options
      ),
    ];
  }
}

function generateVivoAddon(
  options: Record<string, any>
): Addon {
  const config = {
    timeout: options.timeout || appConfig.presets.defaultTimeout,
    days: options.days ?? 3,
  };
  return {
    name: options.name || 'Vivo TV',
    manifestUrl: `${appConfig.bootstrap.internalUrl}/builtins/live-tv/vivo-tv/${toUrlSafeBase64(JSON.stringify(config))}/manifest.json`,
    enabled: true,
    resources: options.resources || [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
    ],
    timeout: config.timeout,
    resultPassthrough: true,
    preset: { id: '', type: 'vivo-tv', options },
    headers: { 'User-Agent': appConfig.http.defaultUserAgent },
  };
}

function vivoTvOptions(
  resources: ('catalog' | 'meta')[]
): Option[] {
  return [
    {
      id: 'resources',
      name: 'Resources',
      description:
        'Choose what to use from this source. Select only Stream to match streams to channels from other providers without listing its channels.',
      type: 'multi-select',
      required: false,
      showInSimpleMode: true,
      default: resources,
      options: resources.map((resource) => ({
        label: constants.RESOURCE_LABELS[resource],
        value: resource,
      })),
    },
    {
      id: 'name',
      name: 'Name',
      description: 'What to call this addon',
      type: 'string',
      required: true,
      default: 'Vivo TV',
    },
    {
      id: 'days',
      name: 'EPG days',
      description: 'How many days of programming to fetch per channel',
      type: 'number',
      required: true,
      default: 3,
      constraints: { min: 1, max: 7, forceInUi: false },
    },
    {
      id: 'timeout',
      name: 'Timeout (ms)',
      description: 'Timeout for API requests',
      type: 'number',
      required: true,
      default: appConfig.presets.defaultTimeout,
      constraints: {
        min: appConfig.userLimits.timeouts.minTimeout,
        max: appConfig.userLimits.timeouts.maxTimeout,
        forceInUi: false,
      },
    },
  ];
}

export class VivoTvPreset extends Preset {
  static override get METADATA() {
    const resources = [constants.CATALOG_RESOURCE, constants.META_RESOURCE];
    return {
      ID: 'vivo-tv',
      NAME: 'Vivo TV',
      LOGO: '/assets/vivotv_logo.png',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/live-tv/vivo-tv`],
      TIMEOUT: appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'Canais e programação EPG da Vivo Play via API Telefónica Brasil.',
      OPTIONS: vivoTvOptions(resources),
      SUPPORTED_STREAM_TYPES: [],
      SUPPORTED_RESOURCES: resources,
      BUILTIN: true,
      CATEGORY: constants.PresetCategory.META_CATALOGS,
    };
  }

  static override async generateAddons(
    _userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    return [generateVivoAddon(options)];
  }
}

export class M3uPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return LiveTvStreamParser;
  }

  static override get METADATA() {
    const resources = [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
      constants.STREAM_RESOURCE,
    ];
    return {
      ID: 'm3u',
      NAME: 'M3U',
      LOGO: '',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/live-tv/m3u`],
      TIMEOUT: appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: [],
      DESCRIPTION: 'Live TV channels and streams from an M3U playlist.',
      OPTIONS: sourceOptions('M3U', resources),
      SUPPORTED_STREAM_TYPES: [constants.LIVE_STREAM_TYPE],
      SUPPORTED_RESOURCES: resources,
      BUILTIN: true,
      CATEGORY: constants.PresetCategory.STREAMS,
    };
  }

  static override async generateAddons(
    _userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    return [
      generateAddon(
        'm3u',
        this.METADATA.NAME,
        this.METADATA.SUPPORTED_RESOURCES,
        options
      ),
    ];
  }
}
