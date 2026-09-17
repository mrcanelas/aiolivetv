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
import { StreamParser } from '../parser/index.js';
import { parseDeclaredStreamInfo } from '../streams/declared.js';

class USATvStreamParser extends StreamParser {
  protected override getParsedFile(
    stream: Stream,
    _parsedStream: ParsedStream
  ): ParsedFile | undefined {
    return parseDeclaredStreamInfo({
      name: stream.name,
      description: stream.description,
    })?.parsedFile;
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

export class USATVPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return USATvStreamParser;
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
        'USA TV',
        supportedResources,
        appConfig.presets.usaTv.defaultTimeout ??
          appConfig.presets.defaultTimeout,
        appConfig.presets.usaTv.url
      ).filter((option) => option.id !== 'resources'),
    ];

    return {
      ID: 'usa-tv',
      NAME: 'USA TV',
      LOGO: 'https://raw.githubusercontent.com/yowmamasita/usa-tv-next/main/public/logo.png',
      URL: appConfig.presets.usaTv.url,
      TIMEOUT:
        appConfig.presets.usaTv.defaultTimeout ??
        appConfig.presets.defaultTimeout,
      USER_AGENT:
        appConfig.presets.usaTv.defaultUserAgent ??
        appConfig.http.defaultUserAgent,
      SUPPORTED_SERVICES: [],
      DESCRIPTION:
        "USA TV Next provides access to 169 channels across various categories including local channels, news, sports, entertainment, premium, lifestyle, kids' shows, documentaries, music, and Latino programming.",
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
    const source = (options.url?.trim() || this.DEFAULT_URL).replace(/\/$/, '');
    const url = source.endsWith('/manifest.json')
      ? source
      : `${source}/manifest.json`;

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
