import type {
  Addon,
  Option,
  ParsedStream,
  Stream,
  UserData,
} from '../db/index.js';
import { MI_TV_COUNTRIES } from '../builtins/mitv/index.js';
import { SpainTvConfigSchema } from '../builtins/spain/addon.js';
import { MOVISTAR_COUNTRIES } from '../builtins/movistartv/index.js';
import { XtreamConfigSchema } from '../builtins/xtream/config.js';
import {
  TvheadendConfigSchema,
  getTvheadendInstancePolicy,
  formatTvheadendDisabledReason,
} from '../builtins/tvheadend/index.js';
import {
  PlutoTvConfigSchema,
  PLUTO_TV_REGIONS,
  getPlutoTvInstancePolicy,
  formatPlutoTvDisabledReason,
  plutoTvRegionLabel,
} from '../builtins/plutotv/index.js';
import StreamParser from '../parser/streams.js';
import { appConfig, constants, toUrlSafeBase64 } from '../utils/index.js';
import { Preset, baseOptions } from './preset.js';

class LiveTvStreamParser extends StreamParser {
  protected override getStreamType(
    _stream: Stream,
    _service: ParsedStream['service'],
    _currentParsedStream: ParsedStream
  ): ParsedStream['type'] {
    return constants.LIVE_STREAM_TYPE;
  }
}

export class RtvePreset extends Preset {
  static override getParser(): typeof StreamParser {
    return LiveTvStreamParser;
  }

  static override get METADATA() {
    const resources = [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
      constants.STREAM_RESOURCE,
    ];
    const timeout =
      appConfig.presets.rtve.defaultTimeout ?? appConfig.presets.defaultTimeout;
    return {
      ID: 'rtve',
      NAME: 'RTVE',
      LOGO: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ee/Logo_RTVE.svg/330px-Logo_RTVE.svg.png',
      URL: appConfig.presets.rtve.url,
      TIMEOUT: timeout,
      USER_AGENT:
        appConfig.presets.rtve.defaultUserAgent ?? appConfig.http.defaultUserAgent,
      DESCRIPTION:
        'Spanish live TV channels, programme metadata and streams from the community RTVE addon. Some streams are restricted to Spain.',
      SUPPORTED_SERVICES: [],
      SUPPORTED_RESOURCES: resources,
      SUPPORTED_STREAM_TYPES: [constants.LIVE_STREAM_TYPE],
      CATEGORY: constants.PresetCategory.STREAMS,
      OPTIONS: baseOptions('RTVE', resources, timeout, appConfig.presets.rtve.url).map(
        (option) =>
          option.id === 'resources' ? { ...option, showInSimpleMode: true } : option
      ),
    };
  }

  static override async generateAddons(
    _userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    const source = (options.url?.trim() || this.DEFAULT_URL).replace(/\/$/, '');
    return [
      {
        name: options.name || this.METADATA.NAME,
        enabled: true,
        library: false,
        manifestUrl: source.endsWith('/manifest.json')
          ? source
          : `${source}/manifest.json`,
        resources: options.resources || this.METADATA.SUPPORTED_RESOURCES,
        timeout: options.timeout || this.METADATA.TIMEOUT,
        resultPassthrough: true,
        preset: { id: '', type: this.METADATA.ID, options },
        headers: { 'User-Agent': this.METADATA.USER_AGENT },
      },
    ];
  }
}

const epgTimeShiftOption = (): Option => ({
  id: 'timeShiftMinutes',
  name: 'EPG Time Shift (minutes)',
  description:
    'Shift all program start and end times by this amount. Use positive values if the guide runs ahead of the broadcast, or negative if it lags.',
  type: 'number',
  required: false,
  showInSimpleMode: true,
  default: 0,
  constraints: {
    min: -720,
    max: 720,
    forceInUi: false,
  },
});

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
    maxBytes: appConfig.resources.liveTvSourceMaxBytes,
    timeShiftMinutes: options.timeShiftMinutes ?? 0,
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
      OPTIONS: [...sourceOptions('XMLTV', resources), epgTimeShiftOption()],
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
    timeShiftMinutes: options.timeShiftMinutes ?? 0,
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
    epgTimeShiftOption(),
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
        'Live channels and EPG from Vivo Play via the Telefónica Brazil API.',
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

function movistarCountryLabel(code: string | undefined): string {
  return (
    MOVISTAR_COUNTRIES.find((country) => country.code === code)?.name ?? 'Chile'
  );
}

function generateMovistarAddon(options: Record<string, any>): Addon {
  const country = options.country || 'cl';
  const config = {
    timeout: options.timeout || appConfig.presets.defaultTimeout,
    country,
    timeShiftMinutes: options.timeShiftMinutes ?? 0,
  };
  const customName =
    typeof options.name === 'string' ? options.name.trim() : '';
  const name =
    customName && customName !== 'Movistar'
      ? customName
      : `Movistar (${movistarCountryLabel(country)})`;
  return {
    name,
    manifestUrl: `${appConfig.bootstrap.internalUrl}/builtins/live-tv/movistar-tv/${toUrlSafeBase64(JSON.stringify(config))}/manifest.json`,
    enabled: true,
    resources: options.resources || [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
    ],
    timeout: config.timeout,
    resultPassthrough: true,
    preset: { id: '', type: 'movistar-tv', options },
    headers: { 'User-Agent': appConfig.http.defaultUserAgent },
  };
}

function movistarTvOptions(resources: ('catalog' | 'meta')[]): Option[] {
  return [
    {
      id: 'resources',
      name: 'Resources',
      description: 'Choose catalog and/or metadata from this source.',
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
      default: 'Movistar',
    },
    {
      id: 'country',
      name: 'Country',
      description:
        'Movistar publishes a separate guide per Latin American country. Add one instance per country.',
      type: 'select',
      required: true,
      showInSimpleMode: true,
      default: 'cl',
      options: MOVISTAR_COUNTRIES.map((country) => ({
        label: country.name,
        value: country.code,
      })),
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
    epgTimeShiftOption(),
  ];
}

export class MovistarTvPreset extends Preset {
  static override get METADATA() {
    const resources = [constants.CATALOG_RESOURCE, constants.META_RESOURCE];
    return {
      ID: 'movistar-tv',
      NAME: 'Movistar',
      LOGO: '/assets/movistar_logo.png',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/live-tv/movistar-tv`],
      TIMEOUT: appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'Live channels and EPG from Movistar via the Telefónica API (Chile, Peru, Colombia and Argentina).',
      OPTIONS: movistarTvOptions(resources),
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
    return [generateMovistarAddon(options)];
  }
}

function generateTvpAddon(options: Record<string, any>): Addon {
  const timeout = Math.max(
    options.timeout || appConfig.presets.defaultTimeout,
    15_000
  );
  const config = {
    timeout,
    timeShiftMinutes: options.timeShiftMinutes ?? 0,
  };
  return {
    name: options.name || 'TVP',
    manifestUrl: `${appConfig.bootstrap.internalUrl}/builtins/live-tv/tvp/${toUrlSafeBase64(JSON.stringify(config))}/manifest.json`,
    enabled: true,
    resources: (options.resources || [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
    ]).filter(
      (resource: string) =>
        resource === constants.CATALOG_RESOURCE ||
        resource === constants.META_RESOURCE
    ),
    timeout: config.timeout,
    resultPassthrough: true,
    preset: { id: '', type: 'tvp', options },
    headers: { 'User-Agent': appConfig.http.defaultUserAgent },
  };
}

function tvpTvOptions(resources: ('catalog' | 'meta')[]): Option[] {
  return [
    {
      id: 'resources',
      name: 'Resources',
      description: 'Choose catalog and/or metadata from this source.',
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
      default: 'TVP',
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
    epgTimeShiftOption(),
  ];
}

function generateDirectvAddon(options: Record<string, any>): Addon {
  const timeout = Math.max(
    options.timeout || appConfig.presets.defaultTimeout,
    15_000
  );
  const config = {
    timeout,
    timeShiftMinutes: options.timeShiftMinutes ?? 0,
  };
  return {
    name: options.name || 'DIRECTV',
    manifestUrl: `${appConfig.bootstrap.internalUrl}/builtins/live-tv/directv/${toUrlSafeBase64(JSON.stringify(config))}/manifest.json`,
    enabled: true,
    resources: (options.resources || [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
    ]).filter(
      (resource: string) =>
        resource === constants.CATALOG_RESOURCE ||
        resource === constants.META_RESOURCE
    ),
    timeout: config.timeout,
    resultPassthrough: true,
    preset: { id: '', type: 'directv', options },
    headers: { 'User-Agent': appConfig.http.defaultUserAgent },
  };
}

function directvOptions(resources: ('catalog' | 'meta')[]): Option[] {
  return [
    {
      id: 'resources',
      name: 'Resources',
      description: 'Choose catalog and/or metadata from this source.',
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
      default: 'DIRECTV',
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
    epgTimeShiftOption(),
  ];
}

export class DirectvPreset extends Preset {
  static override get METADATA() {
    const resources = [constants.CATALOG_RESOURCE, constants.META_RESOURCE];
    return {
      ID: 'directv',
      NAME: 'DIRECTV',
      LOGO: '/assets/directv.png',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/live-tv/directv`],
      TIMEOUT: appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'Live channels and EPG from DIRECTV (US).\n\nLogos and programme images are geo-blocked and only load when the viewer is in the United States.',
      OPTIONS: directvOptions(resources),
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
    return [generateDirectvAddon(options)];
  }
}

export class TvpPreset extends Preset {
  static override get METADATA() {
    const resources = [constants.CATALOG_RESOURCE, constants.META_RESOURCE];
    return {
      ID: 'tvp',
      NAME: 'TVP',
      LOGO: '/assets/tvp_logo.png',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/live-tv/tvp`],
      TIMEOUT: appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'Live channels and EPG from TVP (Poland). Catalog and metadata only.',
      OPTIONS: tvpTvOptions(resources),
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
    return [generateTvpAddon(options)];
  }
}

function generateClaroTvAddon(options: Record<string, any>): Addon {
  const config = {
    timeout: options.timeout || appConfig.presets.defaultTimeout,
    location: options.location || 'SAO PAULO,SAO PAULO',
    timeShiftMinutes: options.timeShiftMinutes ?? 0,
  };
  return {
    name: options.name || 'Claro TV+',
    manifestUrl: `${appConfig.bootstrap.internalUrl}/builtins/live-tv/claro-tv/${toUrlSafeBase64(JSON.stringify(config))}/manifest.json`,
    enabled: true,
    resources: options.resources || [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
    ],
    timeout: config.timeout,
    resultPassthrough: true,
    preset: { id: '', type: 'claro-tv', options },
    headers: { 'User-Agent': appConfig.http.defaultUserAgent },
  };
}

function claroTvOptions(resources: ('catalog' | 'meta')[]): Option[] {
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
      default: 'Claro TV+',
    },
    {
      id: 'location',
      name: 'Location',
      description:
        'Claro TV+ region in CITY,STATE format (for example SAO PAULO,SAO PAULO).',
      type: 'string',
      required: true,
      default: 'SAO PAULO,SAO PAULO',
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
    epgTimeShiftOption(),
  ];
}

export class ClaroTvPreset extends Preset {
  static override get METADATA() {
    const resources = [constants.CATALOG_RESOURCE, constants.META_RESOURCE];
    return {
      ID: 'claro-tv',
      NAME: 'Claro TV+',
      LOGO: '/assets/clarotv_logo.webp',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/live-tv/claro-tv`],
      TIMEOUT: appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'Live channels and EPG from Claro TV+ via clarotvmais.com.br.',
      OPTIONS: claroTvOptions(resources),
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
    return [generateClaroTvAddon(options)];
  }
}

function miTvCountryLabel(code: string | undefined): string {
  return (
    MI_TV_COUNTRIES.find((country) => country.code === code)?.name ?? 'Brazil'
  );
}

function generateMiTvAddon(options: Record<string, any>): Addon {
  const country = options.country || 'br';
  const config = {
    timeout: options.timeout || appConfig.presets.defaultTimeout,
    country,
    timeShiftMinutes: options.timeShiftMinutes ?? 0,
  };
  const customName =
    typeof options.name === 'string' ? options.name.trim() : '';
  const name =
    customName && customName !== 'Mi.tv'
      ? customName
      : `Mi.tv (${miTvCountryLabel(country)})`;
  return {
    name,
    manifestUrl: `${appConfig.bootstrap.internalUrl}/builtins/live-tv/mi-tv/${toUrlSafeBase64(JSON.stringify(config))}/manifest.json`,
    enabled: true,
    resources: options.resources || [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
    ],
    timeout: config.timeout,
    resultPassthrough: true,
    preset: { id: '', type: 'mi-tv', options },
    headers: { 'User-Agent': appConfig.http.defaultUserAgent },
  };
}

function miTvOptions(resources: ('catalog' | 'meta')[]): Option[] {
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
      default: 'Mi.tv',
    },
    {
      id: 'country',
      name: 'Country',
      description:
        'Mi.tv publishes a separate guide per Latin American country. Add one instance per country.',
      type: 'select',
      required: true,
      showInSimpleMode: true,
      default: 'br',
      options: MI_TV_COUNTRIES.map((country) => ({
        label: country.name,
        value: country.code,
      })),
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
    epgTimeShiftOption(),
  ];
}

export class MiTvPreset extends Preset {
  static override get METADATA() {
    const resources = [constants.CATALOG_RESOURCE, constants.META_RESOURCE];
    return {
      ID: 'mi-tv',
      NAME: 'Mi.tv',
      LOGO: '/assets/mitv_logo.png',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/live-tv/mi-tv`],
      TIMEOUT: appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'Live channels and EPG from Mi.tv (Argentina, Brazil, Chile, Colombia, Mexico and other Latin American countries).',
      OPTIONS: miTvOptions(resources),
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
    return [generateMiTvAddon(options)];
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
      OPTIONS: [
        ...sourceOptions('M3U', resources),
        {
          id: 'discoverEpg',
          name: 'Find EPG guides',
          type: 'action' as const,
          description:
            'Find XMLTV guide URLs declared by this playlist. Selected guides are added with this addon and stay in your draft until Save.',
        },
      ],
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

function generateXtreamAddon(options: Record<string, any>): Addon {
  const config = XtreamConfigSchema.parse({
    url: options.url,
    username: options.username,
    password: options.password,
    timeout: options.timeout || appConfig.presets.defaultTimeout,
    preferredFormat: options.preferredFormat || 'm3u8',
    categoryId: options.categoryId || undefined,
    categoryNameRegex: options.categoryNameRegex || undefined,
    timeShiftMinutes: options.timeShiftMinutes ?? 0,
  });
  return {
    name: options.name || 'Xtream Codes',
    manifestUrl: `${appConfig.bootstrap.internalUrl}/builtins/live-tv/xtream/${toUrlSafeBase64(JSON.stringify(config))}/manifest.json`,
    enabled: true,
    resources: options.resources || [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
      constants.STREAM_RESOURCE,
    ],
    timeout: config.timeout,
    resultPassthrough: true,
    preset: { id: '', type: 'xtream', options },
    headers: { 'User-Agent': appConfig.http.defaultUserAgent },
  };
}

function xtreamOptions(
  resources: ('catalog' | 'meta' | 'stream')[]
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
      default: 'Xtream Codes',
    },
    {
      id: 'url',
      name: 'Server URL',
      description: 'Xtream Codes server URL (for example http://example.com:8080)',
      type: 'url',
      required: true,
    },
    {
      id: 'username',
      name: 'Username',
      description: 'Xtream Codes account username',
      type: 'string',
      required: true,
    },
    {
      id: 'password',
      name: 'Password',
      description: 'Xtream Codes account password',
      type: 'password',
      required: true,
    },
    {
      id: 'preferredFormat',
      name: 'Stream format',
      description: 'Preferred container for live channel URLs',
      type: 'select',
      required: true,
      default: 'm3u8',
      options: [
        { label: 'HLS (m3u8)', value: 'm3u8' },
        { label: 'MPEG-TS (ts)', value: 'ts' },
        { label: 'RTMP', value: 'rtmp' },
      ],
    },
    {
      id: 'categoryId',
      name: 'Category IDs',
      description:
        'Optional comma-separated live category IDs to limit imported channels (e.g. 1339,513). Combined with Category Name Regex. Leave both empty to import all categories.',
      type: 'string',
      required: false,
    },
    {
      id: 'categoryNameRegex',
      name: 'Category Name Regex',
      description:
        'Optional case-insensitive regular expression; live categories whose name matches are imported (e.g. ^(?:CH|DE|AT|TR)\\|). Combined with Category IDs.',
      type: 'string',
      required: false,
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
    epgTimeShiftOption(),
  ];
}

export class XtreamPreset extends Preset {
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
      ID: 'xtream',
      NAME: 'Xtream Codes',
      LOGO: '',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/live-tv/xtream`],
      TIMEOUT: appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'Live TV channels, EPG and streams from an Xtream Codes provider.',
      OPTIONS: xtreamOptions(resources),
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
    return [generateXtreamAddon(options)];
  }
}

function generateTvheadendAddon(options: Record<string, any>): Addon {
  const policy = getTvheadendInstancePolicy();
  if (!policy.enabled) {
    throw new Error(
      formatTvheadendDisabledReason(
        policy.disabledReason || 'Disabled by this instance administrator'
      )
    );
  }
  if (options.playbackMode === 'proxy' && !policy.proxyEnabled) {
    throw new Error(
      'Proxy playback is disabled by this instance administrator'
    );
  }

  const config = TvheadendConfigSchema.parse({
    url: options.url,
    username: options.username || '',
    password: options.password || '',
    playbackUrl: options.playbackUrl || '',
    playbackMode: options.playbackMode || 'direct',
    profile: options.profile || 'pass',
    tagIds: options.tagIds || '',
    timeout: options.timeout || appConfig.presets.defaultTimeout,
    timeShiftMinutes: options.timeShiftMinutes ?? 0,
  });

  return {
    name: options.name || 'TVHeadend',
    manifestUrl: `${appConfig.bootstrap.internalUrl}/builtins/live-tv/tvheadend/${toUrlSafeBase64(JSON.stringify(config))}/manifest.json`,
    enabled: true,
    resources: options.resources || [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
      constants.STREAM_RESOURCE,
    ],
    timeout: config.timeout,
    resultPassthrough: true,
    preset: { id: '', type: 'tvheadend', options },
    headers: { 'User-Agent': appConfig.http.defaultUserAgent },
  };
}

function tvheadendOptions(
  resources: ('catalog' | 'meta' | 'stream')[]
): Option[] {
  const policy = getTvheadendInstancePolicy();
  const proxyOptionAvailable = policy.proxyEnabled;
  const playbackModes = [
    { label: 'Direct (temporary ticket)', value: 'direct' },
    ...(proxyOptionAvailable
      ? [{ label: 'Proxy (through this instance)', value: 'proxy' }]
      : []),
  ];

  return [
    {
      id: 'accessNotice',
      name: 'Server Access Required',
      description:
        'This AIOLiveTV instance must be able to reach TVHeadend to import channels and EPG. Addresses such as `192.168.x.x`, `localhost` or internal Docker hostnames refer to **this instance network**, not automatically to your home network. Public instances block private addresses unless the administrator enables `HTTP_ALLOW_PRIVATE_URLS`.',
      type: 'alert',
      intent: 'info',
      required: false,
      showInSimpleMode: true,
    },
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
      name: 'Connection Name',
      description: 'Name shown for this TVHeadend connection in the addon list',
      type: 'string',
      required: true,
      default: 'TVHeadend',
    },
    {
      id: 'url',
      name: 'Server URL',
      description:
        'Address AIOLiveTV uses to fetch channels and schedules (for example `http://tvheadend:9981` or `https://tvh.example.com`).',
      type: 'url',
      required: true,
    },
    {
      id: 'username',
      name: 'Username',
      description:
        'TVHeadend username (leave blank if the server allows anonymous access)',
      type: 'string',
      required: false,
    },
    {
      id: 'password',
      name: 'Password',
      description:
        'TVHeadend password. Stored on the backend; the configurator does not connect to TVHeadend directly.',
      type: 'password',
      required: false,
    },
    {
      id: 'playbackUrl',
      name: 'Playback URL',
      description:
        'Address used by the player when it differs from the internal API address (for example a public or VPN URL). Leave blank to use the server URL.',
      type: 'url',
      required: false,
    },
    {
      id: 'playbackMode',
      name: 'Playback Mode',
      description: proxyOptionAvailable
        ? '**Direct:** the player connects to TVHeadend with a temporary ticket (no permanent password in the URL). **Proxy:** video passes through AIOLiveTV; credentials remain on the backend.'
        : '**Direct:** the player connects to TVHeadend with a temporary ticket. Proxy mode is disabled by this instance administrator.',
      type: 'select',
      required: true,
      default: 'direct',
      options: playbackModes,
    },
    {
      id: 'profile',
      name: 'HTTP Profile',
      description:
        'TVHeadend streaming profile (default `pass`, without transcoding). Stremio clients generally handle MPEG-TS/`pass` better than less common containers.',
      type: 'string',
      required: false,
      default: 'pass',
      showInSimpleMode: false,
    },
    {
      id: 'tagIds',
      name: 'Tag / Group IDs',
      description:
        'Optional comma-separated list of TVHeadend channel tag UUIDs. Only these groups will be imported.',
      type: 'string',
      required: false,
      showInSimpleMode: false,
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
    epgTimeShiftOption(),
    {
      id: 'testConnection',
      name: 'Test Connection',
      description:
        'Lightweight TVHeadend API check (lists one channel). Does not start a stream or occupy a tuner.',
      type: 'action',
      required: false,
      showInSimpleMode: true,
      buttonIntent: 'primary-subtle',
    },
  ];
}

export class TvheadendPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return LiveTvStreamParser;
  }

  static override get METADATA() {
    const resources = [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
      constants.STREAM_RESOURCE,
    ];
    const policy = getTvheadendInstancePolicy();
    return {
      ID: 'tvheadend',
      NAME: 'TVHeadend',
      LOGO: '/assets/tvheadend_logo.png',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/live-tv/tvheadend`],
      TIMEOUT: appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'Live channels, EPG and streams from your TVHeadend server. Requires access to your server.',
      OPTIONS: tvheadendOptions(resources),
      SUPPORTED_STREAM_TYPES: [constants.LIVE_STREAM_TYPE],
      SUPPORTED_RESOURCES: resources,
      BUILTIN: true,
      CATEGORY: constants.PresetCategory.STREAMS,
      DISABLED: policy.enabled
        ? undefined
        : {
            disabled: true,
            reason: formatTvheadendDisabledReason(
              policy.disabledReason || 'Disabled by this instance administrator'
            ),
          },
    };
  }

  static override async generateAddons(
    _userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    return [generateTvheadendAddon(options)];
  }
}

function generatePlutoTvAddon(options: Record<string, any>): Addon {
  const policy = getPlutoTvInstancePolicy();
  if (!policy.enabled) {
    throw new Error(
      formatPlutoTvDisabledReason(
        policy.disabledReason || 'Disabled by this instance administrator'
      )
    );
  }

  const region = options.region || 'br';
  const config = PlutoTvConfigSchema.parse({
    region,
    timeout: options.timeout || appConfig.presets.defaultTimeout,
    timeShiftMinutes: options.timeShiftMinutes ?? 0,
  });
  const customName =
    typeof options.name === 'string' ? options.name.trim() : '';
  const name =
    customName && customName !== 'Pluto TV'
      ? customName
      : `Pluto TV (${plutoTvRegionLabel(config.region)})`;

  return {
    name,
    manifestUrl: `${appConfig.bootstrap.internalUrl}/builtins/live-tv/pluto-tv/${toUrlSafeBase64(JSON.stringify(config))}/manifest.json`,
    enabled: true,
    resources: options.resources || [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
      constants.STREAM_RESOURCE,
    ],
    timeout: config.timeout,
    resultPassthrough: true,
    preset: { id: '', type: 'pluto-tv', options },
    headers: { 'User-Agent': appConfig.http.defaultUserAgent },
  };
}

function plutoTvOptions(
  resources: ('catalog' | 'meta' | 'stream')[]
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
      default: 'Pluto TV',
    },
    {
      id: 'region',
      name: 'Catalog / Country',
      description:
        'Import catalogs from different countries. Playback depends on regional stream availability. Add one instance per country. Community sources: OwnerPlugins/pluto-tv-m3u and matthuisman/i.mjh.nz (unofficial).',
      type: 'select',
      required: true,
      showInSimpleMode: true,
      default: 'br',
      options: PLUTO_TV_REGIONS.map((region) => ({
        label: region.name,
        value: region.code,
      })),
    },
    {
      id: 'timeout',
      name: 'Timeout (ms)',
      description: 'Timeout for playlist/guide downloads',
      type: 'number',
      required: true,
      default: appConfig.presets.defaultTimeout,
      constraints: {
        min: appConfig.userLimits.timeouts.minTimeout,
        max: appConfig.userLimits.timeouts.maxTimeout,
        forceInUi: false,
      },
    },
    epgTimeShiftOption(),
    {
      id: 'testConnection',
      name: 'Test Import',
      description:
        'Downloads the regional M3U and XMLTV files and counts channels and EPG matches. Does not start streams.',
      type: 'action',
      required: false,
      showInSimpleMode: true,
      buttonIntent: 'primary-subtle',
    },
  ];
}

export class PlutoTvPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return LiveTvStreamParser;
  }

  static override get METADATA() {
    const resources = [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
      constants.STREAM_RESOURCE,
    ];
    const policy = getPlutoTvInstancePolicy();
    return {
      ID: 'pluto-tv',
      NAME: 'Pluto TV',
      LOGO: '/assets/plutotv_logo.webp',
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/live-tv/pluto-tv`],
      TIMEOUT: appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'Live channels, EPG and streams from regional community playlists (OwnerPlugins M3U and matthuisman XMLTV). Unofficial Pluto TV integration. Playback may depend on the player region.',
      OPTIONS: plutoTvOptions(resources),
      SUPPORTED_STREAM_TYPES: [constants.LIVE_STREAM_TYPE],
      SUPPORTED_RESOURCES: resources,
      BUILTIN: true,
      CATEGORY: constants.PresetCategory.STREAMS,
      DISABLED: policy.enabled
        ? undefined
        : {
            disabled: true,
            reason: formatPlutoTvDisabledReason(
              policy.disabledReason || 'Disabled by this instance administrator'
            ),
          },
    };
  }

  static override async generateAddons(
    _userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    return [generatePlutoTvAddon(options)];
  }
}

function spainTvMetadata(
  id: string,
  name: string,
  logo: string,
  streams = false
) {
  const resources = streams
    ? [
        constants.CATALOG_RESOURCE,
        constants.META_RESOURCE,
        constants.STREAM_RESOURCE,
      ]
    : [constants.CATALOG_RESOURCE, constants.META_RESOURCE];
  return {
    ID: id,
    NAME: name,
    LOGO: `/assets/${logo}`,
    URL: [`${appConfig.bootstrap.internalUrl}/builtins/live-tv/${id}`],
    TIMEOUT: appConfig.presets.defaultTimeout,
    USER_AGENT: appConfig.http.defaultUserAgent,
    SUPPORTED_SERVICES: [],
    DESCRIPTION: streams
      ? 'Live channels, XMLTV guide and streams from TDTChannels. Sources: LaQuay/TDTChannels.'
      : `Spanish channel catalog and detailed programme metadata from ${name}.`,
    OPTIONS: [
      {
        id: 'resources',
        name: 'Resources',
        type: 'multi-select' as const,
        description: 'Choose which resources to use from this provider.',
        default: resources,
        showInSimpleMode: true,
        options: resources.map((resource) => ({
          label: constants.RESOURCE_LABELS[resource],
          value: resource,
        })),
      },
      {
        id: 'name',
        name: 'Name',
        type: 'string' as const,
        description: 'What to call this addon',
        required: true,
        default: name,
      },
      {
        id: 'timeout',
        name: 'Timeout (ms)',
        type: 'number' as const,
        description: 'Timeout for provider requests',
        required: true,
        default: appConfig.presets.defaultTimeout,
        constraints: {
          min: appConfig.userLimits.timeouts.minTimeout,
          max: appConfig.userLimits.timeouts.maxTimeout,
          forceInUi: false,
        },
      },
      epgTimeShiftOption(),
    ],
    SUPPORTED_STREAM_TYPES: streams ? [constants.LIVE_STREAM_TYPE] : [],
    SUPPORTED_RESOURCES: resources,
    BUILTIN: true,
    CATEGORY: streams
      ? constants.PresetCategory.STREAMS
      : constants.PresetCategory.META_CATALOGS,
  };
}

function generateSpainTvAddon(
  metadata: ReturnType<typeof spainTvMetadata>,
  options: Record<string, any>
): Addon {
  const config = SpainTvConfigSchema.parse({
    timeout: options.timeout || appConfig.presets.defaultTimeout,
    timeShiftMinutes: options.timeShiftMinutes ?? 0,
  });
  const resources = options.resources || metadata.SUPPORTED_RESOURCES;
  const supported = new Set<string>(metadata.SUPPORTED_RESOURCES);
  if (
    !Array.isArray(resources) ||
    resources.some((resource) => !supported.has(resource))
  ) {
    throw new Error(`${metadata.NAME} does not support the selected resources`);
  }
  return {
    name: options.name || metadata.NAME,
    enabled: true,
    manifestUrl: `${appConfig.bootstrap.internalUrl}/builtins/live-tv/${metadata.ID}/${toUrlSafeBase64(JSON.stringify(config))}/manifest.json`,
    resources,
    timeout: config.timeout,
    resultPassthrough: true,
    preset: { id: '', type: metadata.ID, options },
    headers: { 'User-Agent': metadata.USER_AGENT },
  };
}

export class OrangeTvPreset extends Preset {
  static override get METADATA() {
    return spainTvMetadata('orange-tv', 'Orange TV', 'orangetv_logo.png');
  }
  static override async generateAddons(
    _userData: UserData,
    options: Record<string, any>
  ) {
    return [generateSpainTvAddon(this.METADATA, options)];
  }
}

export class MovistarPlusPreset extends Preset {
  static override get METADATA() {
    return spainTvMetadata(
      'movistar-plus',
      'Movistar Plus+ Spain',
      'moviestarplus_logo.jpg'
    );
  }
  static override async generateAddons(
    _userData: UserData,
    options: Record<string, any>
  ) {
    return [generateSpainTvAddon(this.METADATA, options)];
  }
}

export class TdtChannelsPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return LiveTvStreamParser;
  }
  static override get METADATA() {
    return spainTvMetadata(
      'tdtchannels',
      'TDTChannels',
      'tdtchannels_logo.webp',
      true
    );
  }
  static override async generateAddons(
    _userData: UserData,
    options: Record<string, any>
  ) {
    return [generateSpainTvAddon(this.METADATA, options)];
  }
}
