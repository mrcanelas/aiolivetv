import {
  Addon,
  Option,
  ParsedFile,
  ParsedStream,
  Stream,
  UserData,
} from '../db/index.js';
import { Preset, baseOptions } from './preset.js';
import { constants, LIVE_STREAM_TYPE } from '../utils/index.js';
import { config as appConfig } from '../config/index.js';
import { FileParser, StreamParser } from '../parser/index.js';

class FrostViewStreamParser extends StreamParser {
  protected override getParsedFile(
    stream: Stream,
    parsedStream: ParsedStream
  ): ParsedFile | undefined {
    const parsed = stream.name ? FileParser.parse(stream.name) : undefined;
    if (!parsed) {
      return undefined;
    }
    return {
      ...parsed,
      title: undefined,
    };
  }

  protected override getFilename(
    _stream: Stream,
    _currentParsedStream: ParsedStream
  ): string | undefined {
    return undefined;
  }

  protected override getMessage(
    stream: Stream,
    _currentParsedStream: ParsedStream
  ): string | undefined {
    return `${stream.name} - ${stream.description}`;
  }

  protected getStreamType(
    _stream: Stream,
    _service: ParsedStream['service'],
    _currentParsedStream: ParsedStream
  ): ParsedStream['type'] {
    return constants.LIVE_STREAM_TYPE;
  }
}

export class FrostViewPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return FrostViewStreamParser;
  }

  static override get METADATA() {
    const supportedResources = [
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
      constants.STREAM_RESOURCE,
    ];

    const options: Option[] = [
      {
        id: 'resources',
        name: 'Resources',
        description:
          'Choose what to use from this addon. Select only Stream to match streams to channels from other providers without listing its channels.',
        type: 'multi-select',
        required: false,
        showInSimpleMode: true,
        default: supportedResources,
        options: supportedResources.map((resource) => ({
          label: constants.RESOURCE_LABELS[resource],
          value: resource,
        })),
      },
      ...baseOptions(
        'FrostView TV',
        supportedResources,
        appConfig.presets.frostView.defaultTimeout ??
          appConfig.presets.defaultTimeout,
        appConfig.presets.frostView.url
      ).filter((option) => option.id !== 'resources'),
    ];

    return {
      ID: 'frost-view',
      NAME: 'FrostView TV',
      LOGO: 'https://i.imgur.com/gfng7o2.jpeg',
      URL: appConfig.presets.frostView.url,
      TIMEOUT:
        appConfig.presets.frostView.defaultTimeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT:
        appConfig.presets.frostView.defaultUserAgent ??
        appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        'Canais brasileiros ao vivo com catálogo paginado, metadata e streams.',
      OPTIONS: options,
      SUPPORTED_STREAM_TYPES: [LIVE_STREAM_TYPE],
      SUPPORTED_RESOURCES: supportedResources,
      CATEGORY: constants.PresetCategory.STREAMS,
    };
  }

  static async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    return [this.generateAddon(userData, options)];
  }

  private static generateAddon(
    _userData: UserData,
    options: Record<string, any>
  ): Addon {
    const baseUrl = options.url
      ? new URL(options.url).origin
      : this.DEFAULT_URL;

    const url = options.url?.endsWith('/manifest.json')
      ? options.url
      : `${baseUrl}/manifest.json`;

    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: url,
      enabled: true,
      library: false,
      resources: options.resources || this.METADATA.SUPPORTED_RESOURCES,
      timeout: options.timeout || this.METADATA.TIMEOUT,
      resultPassthrough: true,
      preset: {
        id: '',
        type: this.METADATA.ID,
        options: options,
      },
      headers: {
        'User-Agent': this.METADATA.USER_AGENT,
      },
    };
  }
}
