import { ParsedStream, UserData } from '../db/schemas.js';
import {
  createLogger,
  RegexAccess,
  getTimeTakenSincePoint,
  formatMilliseconds,
  constants,
  compileRegex,
  formRegexFromKeywords,
} from '../utils/index.js';
import {
  StreamSelector,
  extractNamesFromExpression,
} from '../parser/streamExpression.js';
import StreamUtils, { shouldPassthroughStage } from './utils.js';
import { formatBitrate } from '../formatters/utils.js';
import { StreamContext } from './context.js';

const logger = createLogger('filterer');

interface Reason {
  total: number;
  details: Record<string, number>;
}

export interface FilterStatistics {
  removed: {
    excludedStreamType: Reason;
    requiredStreamType: Reason;
    excludedResolution: Reason;
    requiredResolution: Reason;
    excludedEncode: Reason;
    requiredEncode: Reason;
    excludedVisualTag: Reason;
    requiredVisualTag: Reason;
    excludedAudioTag: Reason;
    requiredAudioTag: Reason;
    excludedAudioChannel: Reason;
    requiredAudioChannel: Reason;
    excludedLanguage: Reason;
    requiredLanguage: Reason;
    excludedSubtitle: Reason;
    requiredSubtitle: Reason;
    excludedRegex: Reason;
    requiredRegex: Reason;
    excludedKeywords: Reason;
    requiredKeywords: Reason;
    excludedFilterCondition: Reason;
    requiredFilterCondition: Reason;
    bitrate: Reason;
  };
  included: {
    passthrough: Reason;
    resolution: Reason;
    encode: Reason;
    visualTag: Reason;
    audioTag: Reason;
    audioChannel: Reason;
    language: Reason;
    subtitle: Reason;
    streamType: Reason;
    regex: Reason;
    keywords: Reason;
    streamExpression: Reason;
  };
}

export interface FilterTimings {
  /** Total wall-clock ms spent inside all filter() calls for this request */
  totalMs: number;
  /** Ms spent checking access to regex filtering */
  regexAccessMs: number;
  /** Ms spent evaluating includedStreamExpressions */
  expressionMs: number;
  /** Ms spent compiling regex / keyword patterns */
  regexCompileMs: number;
  /** Ms spent sequentially pre-computing per-stream regex/keyword decisions before the filter
   *  pass. Pre-computed sequentially (not inside Promise.all) so this value is accurate. */
  regexTestMs: number;
  /** Ms spent in the core per-stream shouldKeepStream filter pass */
  filterPassMs: number;
  /** Number of filter() calls accumulated */
  calls: number;
}

class StreamFilterer {
  private userData: UserData;
  private filterStatistics: FilterStatistics;
  private filterTimings: FilterTimings;

  constructor(userData: UserData) {
    this.userData = userData;
    this.filterStatistics = {
      removed: {
        excludedStreamType: { total: 0, details: {} },
        requiredStreamType: { total: 0, details: {} },
        excludedResolution: { total: 0, details: {} },
        requiredResolution: { total: 0, details: {} },
        excludedEncode: { total: 0, details: {} },
        requiredEncode: { total: 0, details: {} },
        excludedVisualTag: { total: 0, details: {} },
        requiredVisualTag: { total: 0, details: {} },
        excludedAudioTag: { total: 0, details: {} },
        requiredAudioTag: { total: 0, details: {} },
        excludedAudioChannel: { total: 0, details: {} },
        requiredAudioChannel: { total: 0, details: {} },
        excludedLanguage: { total: 0, details: {} },
        requiredLanguage: { total: 0, details: {} },
        excludedSubtitle: { total: 0, details: {} },
        requiredSubtitle: { total: 0, details: {} },
        excludedRegex: { total: 0, details: {} },
        requiredRegex: { total: 0, details: {} },
        excludedKeywords: { total: 0, details: {} },
        requiredKeywords: { total: 0, details: {} },
        excludedFilterCondition: { total: 0, details: {} },
        requiredFilterCondition: { total: 0, details: {} },
        bitrate: { total: 0, details: {} },
      },
      included: {
        passthrough: { total: 0, details: {} },
        resolution: { total: 0, details: {} },
        encode: { total: 0, details: {} },
        visualTag: { total: 0, details: {} },
        audioTag: { total: 0, details: {} },
        audioChannel: { total: 0, details: {} },
        language: { total: 0, details: {} },
        subtitle: { total: 0, details: {} },
        streamType: { total: 0, details: {} },
        regex: { total: 0, details: {} },
        keywords: { total: 0, details: {} },
        streamExpression: { total: 0, details: {} },
      },
    };
    this.filterTimings = {
      totalMs: 0,
      regexAccessMs: 0,
      expressionMs: 0,
      regexCompileMs: 0,
      regexTestMs: 0,
      filterPassMs: 0,
      calls: 0,
    };
  }

  private incrementRemovalReason(
    reason: keyof FilterStatistics['removed'],
    detail?: string
  ) {
    this.filterStatistics.removed[reason].total++;
    if (detail) {
      this.filterStatistics.removed[reason].details[detail] =
        (this.filterStatistics.removed[reason].details[detail] || 0) + 1;
    }
  }

  private incrementIncludedReason(
    reason: keyof FilterStatistics['included'],
    detail?: string
  ) {
    this.filterStatistics.included[reason].total++;
    if (detail) {
      this.filterStatistics.included[reason].details[detail] =
        (this.filterStatistics.included[reason].details[detail] || 0) + 1;
    }
  }

  public getFilterStatistics() {
    return this.filterStatistics;
  }

  public getFilterTimings(): FilterTimings {
    return {
      ...this.filterTimings,
    };
  }

  public resetFilterTimings(): void {
    this.filterTimings = {
      totalMs: 0,
      regexAccessMs: 0,
      expressionMs: 0,
      regexCompileMs: 0,
      regexTestMs: 0,
      filterPassMs: 0,
      calls: 0,
    };
  }

  public generateFilterSummary(
    streams: ParsedStream[],
    finalStreams: ParsedStream[],
    type: string,
    id: string
  ): void {
    const totalFiltered = streams.length - finalStreams.length;
    const summary = [
      '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `  🔍 Filter Summary for ${id} (${type})`,
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `  📊 Total Streams : ${streams.length}`,
      `  ✔️ Kept         : ${finalStreams.length}`,
      `  ❌ Filtered     : ${totalFiltered}`,
    ];

    // Add filter details if any streams were filtered
    const { filterDetails, includedDetails } = this.getFormattedFilterDetails();

    if (filterDetails.length > 0) {
      summary.push('\n  🔎 Filter Details:');
      summary.push(...filterDetails);
    }
    if (includedDetails.length > 0) {
      summary.push('\n  🔎 Included Details:');
      summary.push(...includedDetails);
    }
    summary.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.debug(summary.join('\n'));
  }

  public getFormattedFilterDetails(): {
    filterDetails: string[];
    includedDetails: string[];
  } {
    const filterDetails: string[] = [];
    for (const [reason, stats] of Object.entries(
      this.filterStatistics.removed
    )) {
      if (stats.total > 0) {
        // Convert camelCase to Title Case with spaces
        const formattedReason = reason
          .replace(/([A-Z])/g, ' $1')
          .replace(/^./, (str) => str.toUpperCase());

        filterDetails.push(`\n  📌 ${formattedReason} (${stats.total})`);
        for (const [detail, count] of Object.entries(stats.details)) {
          filterDetails.push(`    • ${count}× ${detail}`);
        }
      }
    }

    const includedDetails: string[] = [];
    for (const [reason, stats] of Object.entries(
      this.filterStatistics.included
    )) {
      if (stats.total > 0) {
        const formattedReason = reason
          .replace(/([A-Z])/g, ' $1')
          .replace(/^./, (str) => str.toUpperCase());
        includedDetails.push(`\n  📌 ${formattedReason} (${stats.total})`);
        for (const [detail, count] of Object.entries(stats.details)) {
          includedDetails.push(`    • ${count}× ${detail}`);
        }
      }
    }

    return { filterDetails, includedDetails };
  }

  public async filter(
    streams: ParsedStream[],
    context: StreamContext
  ): Promise<ParsedStream[]> {
    const { type, id } = context;

    const start = Date.now();
    // Sub-phase timing accumulators for this filter() call
    let regexAccessMs = 0;
    let expressionMs = 0;
    let regexCompileMs = 0;
    let filterPassMs = 0;
    let regexTestMs = 0;
    const regexAccessStart = Date.now();
    const isRegexAllowed = await RegexAccess.isRegexAllowed(this.userData, [
      ...(this.userData.excludedRegexPatterns ?? []),
      ...(this.userData.requiredRegexPatterns ?? []),
      ...(this.userData.includedRegexPatterns ?? []),
      ...(this.userData.preferredRegexPatterns ?? []).map(
        (regex) => regex.pattern
      ),
    ]);

    regexAccessMs = Date.now() - regexAccessStart;

    const expressionStart = Date.now();
    const includedStreamsByExpression =
      await this.applyIncludedStreamExpressions(streams, context);
    expressionMs = Date.now() - expressionStart;
    if (includedStreamsByExpression.length > 0) {
      logger.info(
        `${includedStreamsByExpression.length} streams were included by stream expressions`
      );
    }

    const regexCompileStart = Date.now();
    const excludedRegexPatterns =
      isRegexAllowed &&
      this.userData.excludedRegexPatterns &&
      this.userData.excludedRegexPatterns.length > 0
        ? await Promise.all(
            this.userData.excludedRegexPatterns.map(
              async (pattern) => await compileRegex(pattern)
            )
          )
        : undefined;

    const requiredRegexPatterns =
      isRegexAllowed &&
      this.userData.requiredRegexPatterns &&
      this.userData.requiredRegexPatterns.length > 0
        ? await Promise.all(
            this.userData.requiredRegexPatterns.map(
              async (pattern) => await compileRegex(pattern)
            )
          )
        : undefined;

    const includedRegexPatterns =
      isRegexAllowed &&
      this.userData.includedRegexPatterns &&
      this.userData.includedRegexPatterns.length > 0
        ? await Promise.all(
            this.userData.includedRegexPatterns.map(
              async (pattern) => await compileRegex(pattern)
            )
          )
        : undefined;

    const excludedKeywordsPattern =
      this.userData.excludedKeywords &&
      this.userData.excludedKeywords.length > 0
        ? await formRegexFromKeywords(this.userData.excludedKeywords)
        : undefined;

    const requiredKeywordsPattern =
      this.userData.requiredKeywords &&
      this.userData.requiredKeywords.length > 0
        ? await formRegexFromKeywords(this.userData.requiredKeywords)
        : undefined;

    const includedKeywordsPattern =
      this.userData.includedKeywords &&
      this.userData.includedKeywords.length > 0
        ? await formRegexFromKeywords(this.userData.includedKeywords)
        : undefined;
    regexCompileMs = Date.now() - regexCompileStart;

    // test many regexes against many attributes and return true if at least one regex matches any attribute
    // and false if no regex matches any attribute
    const testRegexes = (stream: ParsedStream, patterns: RegExp[]): boolean => {
      const file = stream.parsedFile;
      const stringsToTest = [
        stream.filename,
        file?.releaseGroup,
        stream.indexer,
        stream.folderName,
      ].filter((v) => v !== undefined);

      for (const string of stringsToTest) {
        for (const pattern of patterns) {
          if (pattern.test(string)) {
            return true;
          }
        }
      }
      return false;
    };

    const normaliseRange = (
      range: [number, number] | undefined,
      defaults: { min: number; max: number }
    ): [number | undefined, number | undefined] | undefined => {
      if (!range) return undefined;
      const [min, max] = range;
      const normMin = min === defaults.min ? undefined : min;
      const normMax = max === defaults.max ? undefined : max;
      return normMin === undefined && normMax === undefined
        ? undefined
        : [normMin, normMax];
    };

    const normaliseBitrateRange = (
      bitrateRange: [number, number] | undefined
    ) => {
      return normaliseRange(bitrateRange, {
        min: constants.MIN_BITRATE,
        max: constants.MAX_BITRATE,
      });
    };

    const shouldKeepStream = (stream: ParsedStream): boolean => {
      const file = stream.parsedFile;

      const skipLanguageFiltering = shouldPassthroughStage(stream, 'language');
      const skipSubtitleFiltering = shouldPassthroughStage(stream, 'subtitle');

      // Temporarily add in our fake visual tags used for sorting/filtering
      // HDR+DV
      if (
        file?.visualTags?.some((tag) => tag.startsWith('HDR')) &&
        file?.visualTags?.some((tag) => tag.startsWith('DV'))
      ) {
        const hdrIndex = file?.visualTags?.findIndex((tag) =>
          tag.startsWith('HDR')
        );
        const dvIndex = file?.visualTags?.findIndex((tag) =>
          tag.startsWith('DV')
        );
        const insertIndex = Math.min(hdrIndex, dvIndex);
        file?.visualTags?.splice(insertIndex, 0, 'HDR+DV');
      }
      // DV Only
      if (
        file?.visualTags?.some((tag) => tag.startsWith('DV')) &&
        !file?.visualTags?.some((tag) => tag.startsWith('HDR'))
      ) {
        file?.visualTags?.push('DV Only');
      }
      // HDR Only
      if (
        file?.visualTags?.some((tag) => tag.startsWith('HDR')) &&
        !file?.visualTags?.some((tag) => tag.startsWith('DV'))
      ) {
        file?.visualTags?.push('HDR Only');
      }

      if (shouldPassthroughStage(stream, 'filter')) {
        this.incrementIncludedReason('passthrough', stream.addon.name);
        return true;
      }

      // carry out include checks first
      if (this.userData.includedStreamTypes?.includes(stream.type)) {
        this.incrementIncludedReason('streamType', stream.type);
        return true;
      }

      if (
        this.userData.includedResolutions?.includes(
          file?.resolution || ('Unknown' as any)
        )
      ) {
        const resolution = this.userData.includedResolutions.find(
          (resolution) => (file?.resolution || 'Unknown') === resolution
        );
        if (resolution) {
          this.incrementIncludedReason('resolution', resolution);
        }
        return true;
      }

      if (
        this.userData.includedVisualTags?.some((tag) =>
          (file?.visualTags.length ? file.visualTags : ['Unknown']).includes(
            tag
          )
        )
      ) {
        const tag = this.userData.includedVisualTags.find((tag) =>
          (file?.visualTags.length ? file.visualTags : ['Unknown']).includes(
            tag
          )
        );
        if (tag) {
          this.incrementIncludedReason('visualTag', tag);
        }
        return true;
      }

      if (
        this.userData.includedAudioTags?.some((tag) =>
          (file?.audioTags.length ? file.audioTags : ['Unknown']).includes(tag)
        )
      ) {
        const tag = this.userData.includedAudioTags.find((tag) =>
          (file?.audioTags.length ? file.audioTags : ['Unknown']).includes(tag)
        );
        if (tag) {
          this.incrementIncludedReason('audioTag', tag);
        }
        return true;
      }

      if (
        this.userData.includedAudioChannels?.some((channel) =>
          (file?.audioChannels.length
            ? file.audioChannels
            : ['Unknown']
          ).includes(channel)
        )
      ) {
        const channel = this.userData.includedAudioChannels.find((channel) =>
          (file?.audioChannels.length
            ? file.audioChannels
            : ['Unknown']
          ).includes(channel)
        );
        this.incrementIncludedReason('audioChannel', channel!);
        return true;
      }

      if (
        !skipLanguageFiltering &&
        this.userData.includedLanguages?.some((lang) =>
          (file?.languages.length ? file.languages : ['Unknown']).includes(lang)
        )
      ) {
        const lang = this.userData.includedLanguages.find((lang) =>
          (file?.languages.length ? file.languages : ['Unknown']).includes(lang)
        );
        this.incrementIncludedReason('language', lang!);
        return true;
      }

      if (
        !skipSubtitleFiltering &&
        this.userData.includedSubtitles?.some((lang) =>
          (file?.subtitles?.length ? file.subtitles : ['Unknown']).includes(
            lang
          )
        )
      ) {
        const lang = this.userData.includedSubtitles.find((lang) =>
          (file?.subtitles?.length ? file.subtitles : ['Unknown']).includes(
            lang
          )
        );
        this.incrementIncludedReason('subtitle', lang!);
        return true;
      }

      if (
        this.userData.includedEncodes?.some(
          (encode) => (file?.encode || 'Unknown') === encode
        )
      ) {
        const encode = this.userData.includedEncodes.find(
          (encode) => (file?.encode || 'Unknown') === encode
        );
        if (encode) {
          this.incrementIncludedReason('encode', encode);
        }
        return true;
      }

      if (
        includedRegexPatterns &&
        regexDecisionsMap.get(stream.id)?.includedByRegex
      ) {
        this.incrementIncludedReason('regex', includedRegexPatterns[0].source);
        return true;
      }

      if (
        includedKeywordsPattern &&
        regexDecisionsMap.get(stream.id)?.includedByKeywords
      ) {
        this.incrementIncludedReason(
          'keywords',
          includedKeywordsPattern.source
        );
        return true;
      }

      if (this.userData.excludedStreamTypes?.includes(stream.type)) {
        // Track stream type exclusions
        this.incrementRemovalReason('excludedStreamType', stream.type);
        return false;
      }

      // Track required stream type misses
      if (
        this.userData.requiredStreamTypes &&
        this.userData.requiredStreamTypes.length > 0 &&
        !this.userData.requiredStreamTypes.includes(stream.type)
      ) {
        this.incrementRemovalReason('requiredStreamType', stream.type);
        return false;
      }

      // info type streams can bypass remaining filters
      if (stream.type === 'info') {
        this.incrementIncludedReason('streamType', 'info');
        return true;
      }

      // Resolutions
      if (
        this.userData.excludedResolutions?.includes(
          (file?.resolution || 'Unknown') as any
        )
      ) {
        this.incrementRemovalReason(
          'excludedResolution',
          file?.resolution || 'Unknown'
        );
        return false;
      }

      if (
        this.userData.requiredResolutions &&
        this.userData.requiredResolutions.length > 0 &&
        !this.userData.requiredResolutions.includes(
          (file?.resolution || 'Unknown') as any
        )
      ) {
        this.incrementRemovalReason(
          'requiredResolution',
          file?.resolution || 'Unknown'
        );
        return false;
      }

      // encode
      if (
        this.userData.excludedEncodes?.includes(
          file?.encode || ('Unknown' as any)
        )
      ) {
        this.incrementRemovalReason(
          'excludedEncode',
          file?.encode || 'Unknown'
        );
        return false;
      }

      if (
        this.userData.requiredEncodes &&
        this.userData.requiredEncodes.length > 0 &&
        !this.userData.requiredEncodes.includes(
          file?.encode || ('Unknown' as any)
        )
      ) {
        this.incrementRemovalReason(
          'requiredEncode',
          file?.encode || 'Unknown'
        );
        return false;
      }

      if (
        this.userData.excludedVisualTags?.some((tag) =>
          (file?.visualTags.length ? file.visualTags : ['Unknown']).includes(
            tag
          )
        )
      ) {
        const tag = this.userData.excludedVisualTags.find((tag) =>
          (file?.visualTags.length ? file.visualTags : ['Unknown']).includes(
            tag
          )
        );
        this.incrementRemovalReason('excludedVisualTag', tag!);
        return false;
      }

      if (
        this.userData.requiredVisualTags &&
        this.userData.requiredVisualTags.length > 0 &&
        !this.userData.requiredVisualTags.some((tag) =>
          (file?.visualTags.length ? file.visualTags : ['Unknown']).includes(
            tag
          )
        )
      ) {
        this.incrementRemovalReason(
          'requiredVisualTag',
          file?.visualTags.length ? file.visualTags.join(', ') : 'Unknown'
        );
        return false;
      }

      if (
        this.userData.excludedAudioTags?.some((tag) =>
          (file?.audioTags.length ? file.audioTags : ['Unknown']).includes(tag)
        )
      ) {
        const tag = this.userData.excludedAudioTags.find((tag) =>
          (file?.audioTags.length ? file.audioTags : ['Unknown']).includes(tag)
        );
        this.incrementRemovalReason('excludedAudioTag', tag!);
        return false;
      }

      if (
        this.userData.requiredAudioTags &&
        this.userData.requiredAudioTags.length > 0 &&
        !this.userData.requiredAudioTags.some((tag) =>
          (file?.audioTags.length ? file.audioTags : ['Unknown']).includes(tag)
        )
      ) {
        this.incrementRemovalReason(
          'requiredAudioTag',
          file?.audioTags.length ? file.audioTags.join(', ') : 'Unknown'
        );
        return false;
      }

      if (
        this.userData.excludedAudioChannels?.some((channel) =>
          (file?.audioChannels.length
            ? file.audioChannels
            : ['Unknown']
          ).includes(channel)
        )
      ) {
        const channel = this.userData.excludedAudioChannels.find((channel) =>
          (file?.audioChannels.length
            ? file.audioChannels
            : ['Unknown']
          ).includes(channel)
        );
        this.incrementRemovalReason('excludedAudioChannel', channel!);
        return false;
      }

      if (
        this.userData.requiredAudioChannels &&
        this.userData.requiredAudioChannels.length > 0 &&
        !this.userData.requiredAudioChannels.some((channel) =>
          (file?.audioChannels.length
            ? file.audioChannels
            : ['Unknown']
          ).includes(channel)
        )
      ) {
        this.incrementRemovalReason(
          'requiredAudioChannel',
          file?.audioChannels.length ? file.audioChannels.join(', ') : 'Unknown'
        );
        return false;
      }

      // languages
      if (
        !skipLanguageFiltering &&
        this.userData.excludedLanguages?.length &&
        (file?.languages.length ? file.languages : ['Unknown']).every((lang) =>
          this.userData.excludedLanguages!.includes(lang as any)
        )
      ) {
        this.incrementRemovalReason(
          'excludedLanguage',
          file?.languages.length ? file.languages.join(', ') : 'Unknown'
        );
        return false;
      }

      if (
        !skipLanguageFiltering &&
        this.userData.requiredLanguages &&
        this.userData.requiredLanguages.length > 0 &&
        !this.userData.requiredLanguages.some((lang) =>
          (file?.languages.length ? file.languages : ['Unknown']).includes(lang)
        )
      ) {
        this.incrementRemovalReason(
          'requiredLanguage',
          file?.languages.length ? file.languages.join(', ') : 'Unknown'
        );
        return false;
      }

      // subtitles
      if (
        !skipSubtitleFiltering &&
        this.userData.excludedSubtitles?.length &&
        (file?.subtitles?.length ? file.subtitles : ['Unknown']).every((sub) =>
          this.userData.excludedSubtitles!.includes(sub as any)
        )
      ) {
        this.incrementRemovalReason(
          'excludedSubtitle',
          file?.subtitles?.length ? file.subtitles.join(', ') : 'Unknown'
        );
        return false;
      }

      if (
        !skipSubtitleFiltering &&
        this.userData.requiredSubtitles &&
        this.userData.requiredSubtitles.length > 0 &&
        !this.userData.requiredSubtitles.some((sub) =>
          (file?.subtitles?.length ? file.subtitles : ['Unknown']).includes(sub)
        )
      ) {
        this.incrementRemovalReason(
          'requiredSubtitle',
          file?.subtitles?.length ? file.subtitles.join(', ') : 'Unknown'
        );
        return false;
      }

      if (
        excludedRegexPatterns &&
        regexDecisionsMap.get(stream.id)?.excludedByRegex
      ) {
        this.incrementRemovalReason('excludedRegex');
        return false;
      }
      if (
        requiredRegexPatterns &&
        requiredRegexPatterns.length > 0 &&
        !regexDecisionsMap.get(stream.id)?.requiredByRegex
      ) {
        this.incrementRemovalReason('requiredRegex');
        return false;
      }

      if (
        excludedKeywordsPattern &&
        regexDecisionsMap.get(stream.id)?.excludedByKeywords
      ) {
        this.incrementRemovalReason('excludedKeywords');
        return false;
      }

      if (
        requiredKeywordsPattern &&
        !regexDecisionsMap.get(stream.id)?.requiredByKeywords
      ) {
        this.incrementRemovalReason('requiredKeywords');
        return false;
      }

      const globalBitrateRange = this.userData.bitrate?.global;
      const resolutionBitrateRange = stream.parsedFile?.resolution
        ? // @ts-ignore
          this.userData.bitrate?.resolution?.[stream.parsedFile.resolution]
        : undefined;

      let finalBitrateRange:
        | [number | undefined, number | undefined]
        | undefined;
      finalBitrateRange =
        normaliseBitrateRange(resolutionBitrateRange) ||
        normaliseBitrateRange(globalBitrateRange);

      if (
        finalBitrateRange &&
        stream.bitrate !== undefined &&
        Number.isFinite(stream.bitrate)
      ) {
        if (
          finalBitrateRange[0] !== undefined &&
          stream.bitrate < finalBitrateRange[0]
        ) {
          this.incrementRemovalReason(
            'bitrate',
            `< ${formatBitrate(finalBitrateRange[0])}`
          );
          return false;
        }
        if (
          finalBitrateRange[1] !== undefined &&
          stream.bitrate > finalBitrateRange[1]
        ) {
          this.incrementRemovalReason(
            'bitrate',
            `> ${formatBitrate(finalBitrateRange[1])}`
          );
          return false;
        }
      }

      return true;
    };

    // Separate included streams by whether they have passthrough flags
    const includedWithPassthrough = includedStreamsByExpression.filter(
      (stream) => stream.passthrough !== undefined
    );
    const includedWithoutPassthrough = includedStreamsByExpression.filter(
      (stream) => stream.passthrough === undefined
    );

    if (includedWithoutPassthrough.length > 0) {
      logger.info(
        `${includedWithoutPassthrough.length} included streams (no passthrough) will skip filtering entirely`
      );
    }

    if (includedWithPassthrough.length > 0) {
      logger.info(
        `${includedWithPassthrough.length} included streams have passthrough flags and will go through filtering`
      );
    }

    // Only exclude streams without passthrough from filtering
    const filterableStreams = streams.filter(
      (stream) => !includedWithoutPassthrough.some((s) => s.id === stream.id)
    );

    const hasAnyRegexFilter = !!(
      excludedRegexPatterns ||
      requiredRegexPatterns ||
      includedRegexPatterns ||
      excludedKeywordsPattern ||
      requiredKeywordsPattern ||
      includedKeywordsPattern
    );
    const regexDecisionsMap = new Map<
      string,
      {
        includedByRegex: boolean;
        includedByKeywords: boolean;
        excludedByRegex: boolean;
        requiredByRegex: boolean;
        excludedByKeywords: boolean;
        requiredByKeywords: boolean;
      }
    >();
    if (hasAnyRegexFilter) {
      const regexTestStart = Date.now();
      for (const stream of filterableStreams) {
        regexDecisionsMap.set(stream.id, {
          includedByRegex: includedRegexPatterns
            ? testRegexes(stream, includedRegexPatterns)
            : false,
          includedByKeywords: includedKeywordsPattern
            ? testRegexes(stream, [includedKeywordsPattern])
            : false,
          excludedByRegex: excludedRegexPatterns
            ? testRegexes(stream, excludedRegexPatterns)
            : false,
          requiredByRegex: requiredRegexPatterns
            ? testRegexes(stream, requiredRegexPatterns)
            : true,
          excludedByKeywords: excludedKeywordsPattern
            ? testRegexes(stream, [excludedKeywordsPattern])
            : false,
          requiredByKeywords: requiredKeywordsPattern
            ? testRegexes(stream, [requiredKeywordsPattern])
            : true,
        });
      }
      regexTestMs = Date.now() - regexTestStart;
    }

    const filterPassStart = Date.now();
    const filteredStreams = filterableStreams.filter(shouldKeepStream);
    filterPassMs = Date.now() - filterPassStart;

    const finalStreams = StreamUtils.mergeStreams([
      ...includedWithoutPassthrough,
      ...filteredStreams,
    ]);

    const totalMs = Date.now() - start;
    this.filterTimings.totalMs += totalMs;
    this.filterTimings.regexAccessMs += regexAccessMs;
    this.filterTimings.expressionMs += expressionMs;
    this.filterTimings.regexCompileMs += regexCompileMs;
    this.filterTimings.regexTestMs += regexTestMs;
    this.filterTimings.filterPassMs += filterPassMs;
    this.filterTimings.calls++;
    logger.info(
      `Applied basic filters in ${getTimeTakenSincePoint(start)}, removed ${streams.length - finalStreams.length} streams`
    );
    return finalStreams;
  }
  private getDisplayCondition(expression: string): string {
    const names = extractNamesFromExpression(expression);
    if (names && names.length > 0) {
      return names.join(', ');
    }
    // Fallback to truncation if no names found
    const maxLength = 50;
    if (expression.length > maxLength) {
      return expression.substring(0, maxLength - 3) + '...';
    }
    return expression;
  }

  public async applyIncludedStreamExpressions(
    streams: ParsedStream[],
    context: StreamContext
  ): Promise<ParsedStream[]> {
    const expressionContext = context.toExpressionContext();
    const selector = new StreamSelector(expressionContext);
    const streamsToKeep = new Set<string>();
    if (
      !this.userData.includedStreamExpressions ||
      this.userData.includedStreamExpressions.length === 0
    ) {
      return [];
    }
    for (const item of this.userData.includedStreamExpressions) {
      const { expression, enabled } =
        typeof item === 'string' ? { expression: item, enabled: true } : item;
      if (!enabled) continue;
      const selectedStreams = await selector.select(streams, expression);
      this.filterStatistics.included.streamExpression.total +=
        selectedStreams.length;
      const displayCondition = this.getDisplayCondition(expression);
      this.filterStatistics.included.streamExpression.details[
        displayCondition
      ] =
        (this.filterStatistics.included.streamExpression.details[
          displayCondition
        ] || 0) + selectedStreams.length;
      selectedStreams.forEach((stream) => streamsToKeep.add(stream.id));
    }
    return streams.filter((stream) => streamsToKeep.has(stream.id));
  }

  public async applyStreamExpressionFilters(
    streams: ParsedStream[],
    context: StreamContext
  ): Promise<ParsedStream[]> {
    const expressionContext = context.toExpressionContext();

    // Collect pin instructions from all selectors
    const pinInstructions = new Map<string, 'top' | 'bottom'>();

    if (
      this.userData.excludedStreamExpressions &&
      this.userData.excludedStreamExpressions.length > 0
    ) {
      const selector = new StreamSelector(expressionContext);
      const streamsToRemove = new Set<string>(); // Track actual stream objects to be removed

      for (const item of this.userData.excludedStreamExpressions) {
        const { expression, enabled } =
          typeof item === 'string' ? { expression: item, enabled: true } : item;
        if (!enabled) continue;
        try {
          // Always select from the current filteredStreams (not yet modified by this loop)
          const selectedStreams = await selector.select(
            streams.filter((stream) => !streamsToRemove.has(stream.id)),
            expression
          );

          // Track these stream objects for removal (except passthrough streams)
          let newlyRemoved = 0;
          selectedStreams.forEach((stream) => {
            if (
              !shouldPassthroughStage(stream, 'excluded') &&
              !streamsToRemove.has(stream.id)
            ) {
              streamsToRemove.add(stream.id);
              newlyRemoved++;
            }
          });

          // Update skip reasons for this condition (only count newly selected streams)
          if (newlyRemoved > 0) {
            this.filterStatistics.removed.excludedFilterCondition.total +=
              newlyRemoved;
            const displayCondition = this.getDisplayCondition(expression);
            this.filterStatistics.removed.excludedFilterCondition.details[
              displayCondition
            ] =
              (this.filterStatistics.removed.excludedFilterCondition.details[
                displayCondition
              ] || 0) + newlyRemoved;
          }
        } catch (error) {
          logger.error(
            `Failed to apply excluded stream expression "${expression}": ${error instanceof Error ? error.message : String(error)}`
          );
          // Continue with the next condition instead of breaking the entire loop
        }
      }

      logger.debug(
        { excluded: streamsToRemove.size },
        'streams removed by excluded conditions'
      );

      // Remove all marked streams at once, after processing all conditions
      streams = streams.filter((stream) => !streamsToRemove.has(stream.id));

      // Collect pin instructions from excluded selector
      for (const [id, pos] of selector.getPinInstructions()) {
        pinInstructions.set(id, pos);
      }
    }

    const requiredStreamExpressions = (
      this.userData.requiredStreamExpressions || []
    ).filter((item) => item.enabled);

    if (requiredStreamExpressions.length > 0) {
      const selector = new StreamSelector(expressionContext);
      const streamsToKeep = new Set<string>(); // Track actual stream objects to be kept

      for (const item of requiredStreamExpressions) {
        const { expression } = item;
        try {
          const selectedStreams = await selector.select(
            streams.filter(
              (stream) =>
                !streamsToKeep.has(stream.id) ||
                shouldPassthroughStage(stream, 'required')
            ),
            expression
          );

          // Track these stream objects to keep
          let newlyKept = 0;
          selectedStreams.forEach((stream) => {
            if (!streamsToKeep.has(stream.id)) {
              streamsToKeep.add(stream.id);
              newlyKept++;
            }
          });

          // Update skip reasons for this condition (only count newly selected streams)
          if (newlyKept > 0) {
            this.filterStatistics.removed.requiredFilterCondition.total +=
              newlyKept;
            const displayCondition = this.getDisplayCondition(expression);
            this.filterStatistics.removed.requiredFilterCondition.details[
              displayCondition
            ] =
              (this.filterStatistics.removed.requiredFilterCondition.details[
                displayCondition
              ] || 0) + newlyKept;
          }
        } catch (error) {
          logger.error(
            `Failed to apply required stream expression "${expression}": ${error instanceof Error ? error.message : String(error)}`
          );
          // Continue with the next condition instead of breaking the entire loop
        }
      }

      let passthroughCount = 0;
      streams.forEach((stream) => {
        if (
          shouldPassthroughStage(stream, 'required') &&
          !streamsToKeep.has(stream.id)
        ) {
          streamsToKeep.add(stream.id);
          passthroughCount++;
        }
      });

      logger.debug(
        { kept: streamsToKeep.size, passthrough: passthroughCount },
        'streams kept by required conditions'
      );
      // remove all streams that are not in the streamsToKeep set
      streams = streams.filter((stream) => streamsToKeep.has(stream.id));

      // Collect pin instructions from required selector
      for (const [id, pos] of selector.getPinInstructions()) {
        pinInstructions.set(id, pos);
      }
    }

    // Apply pin reordering from SEL pin() calls
    if (pinInstructions.size > 0) {
      const pinnedTop: ParsedStream[] = [];
      const pinnedBottom: ParsedStream[] = [];
      const rest: ParsedStream[] = [];

      for (const stream of streams) {
        const pin = pinInstructions.get(stream.id);
        if (pin === 'top') pinnedTop.push(stream);
        else if (pin === 'bottom') pinnedBottom.push(stream);
        else rest.push(stream);
      }

      streams = [...pinnedTop, ...rest, ...pinnedBottom];
      logger.info(
        `Applied SEL pinning: ${pinnedTop.length} pinned to top, ${pinnedBottom.length} pinned to bottom`
      );
    }

    return streams;
  }
}

export default StreamFilterer;
