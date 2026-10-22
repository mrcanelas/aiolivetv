import { ParsedStream, UserData } from '../db/schemas.js';
import {
  createLogger,
  RegexAccess,
  formRegexFromKeywords,
  compileRegex,
  parseRegex,
} from '../utils/index.js';
import {
  StreamSelector,
  extractNamesFromExpression,
} from '../parser/streamExpression.js';
import { StreamContext } from './context.js';

const logger = createLogger('precomputer');

export interface PrecomputeSubTimings {
  /** Time spent computing preferred regex/keyword matches (per-stream). */
  preferredRegexMs: number;
  /** Time spent computing ranked regex pattern scores (per-stream). */
  rankedRegexMs: number;
  /** Time spent evaluating ranked stream expressions (SEL). */
  rankedSELMs: number;
  /** Time spent evaluating preferred stream expressions (SEL). */
  preferredSELMs: number;
  /** Combined wall-clock time for all four stages. */
  totalMs: number;
}

class StreamPrecomputer {
  private userData: UserData;
  private accumulatedTimings: PrecomputeSubTimings;

  constructor(userData: UserData) {
    this.userData = userData;
    this.accumulatedTimings = {
      preferredRegexMs: 0,
      rankedRegexMs: 0,
      rankedSELMs: 0,
      preferredSELMs: 0,
      totalMs: 0,
    };
  }

  /** Returns accumulated precompute timings for this request (fetcher + pipeline runs combined). */
  public getPrecomputeTimings(): PrecomputeSubTimings {
    return { ...this.accumulatedTimings };
  }

  /** Resets accumulated timings for a new request (call once per getStreams invocation). */
  public resetPrecomputeTimings(): void {
    this.accumulatedTimings = {
      preferredRegexMs: 0,
      rankedRegexMs: 0,
      rankedSELMs: 0,
      preferredSELMs: 0,
      totalMs: 0,
    };
  }

  /**
   * Precompute preferred matches - runs AFTER filtering on fewer streams.
   * SEL-based operations always re-evaluate against the full stream list since
   * selections can depend on the composition of the entire set.
   */
  public async precomputePreferred(
    streams: ParsedStream[],
    context: StreamContext
  ): Promise<PrecomputeSubTimings> {
    const start = Date.now();
    // preferred regex / keywords --> ranked regex patterns --> ranked stream expressions --> preferred stream expressions
    // this is the optimal order so that regexMatched can be used in RSE/PSE and streamExpressionScore and regexScore can be used in PSE
    const preferredRegexMs =
      await this.precomputePreferredRegexMatches(streams);
    const rankedRegexMs = await this.precomputeRankedRegexPatterns(streams);
    const rankedSELMs = await this.precomputeRankedStreamExpressions(
      streams,
      context
    );
    const preferredSELMs = await this.precomputePreferredExpressionMatches(
      streams,
      context
    );
    const totalMs = Date.now() - start;
    logger.debug(
      {
        took: totalMs,
        preferredRegexMs,
        rankedRegexMs,
        rankedSELMs,
        preferredSELMs,
      },
      'precompute complete'
    );
    // Accumulate into per-request totals (mirrors how filterer accumulates filterTimings)
    this.accumulatedTimings.preferredRegexMs += preferredRegexMs;
    this.accumulatedTimings.rankedRegexMs += rankedRegexMs;
    this.accumulatedTimings.rankedSELMs += rankedSELMs;
    this.accumulatedTimings.preferredSELMs += preferredSELMs;
    this.accumulatedTimings.totalMs += totalMs;
    return {
      preferredRegexMs,
      rankedRegexMs,
      rankedSELMs,
      preferredSELMs,
      totalMs,
    };
  }

  /**
   * Precompute ranked stream expression scores.
   * Each stream accumulates scores from all matching expressions.
   */
  private async precomputeRankedStreamExpressions(
    streams: ParsedStream[],
    context: StreamContext
  ): Promise<number> {
    if (
      !this.userData.rankedStreamExpressions?.length ||
      streams.length === 0
    ) {
      return 0;
    }
    const start = Date.now();

    const selector = new StreamSelector(context.toExpressionContext());

    // initialise each stream's score and match list, and build an id -> stream
    // map so we can resolve back to original references after selector.select()
    const streamsById = new Map<string, ParsedStream>();
    for (const stream of streams) {
      stream.streamExpressionScore = 0;
      stream.rankedStreamExpressionsMatched = [];
      streamsById.set(stream.id, stream);
    }

    for (const { expression, score, enabled } of this.userData
      .rankedStreamExpressions) {
      if (enabled === false) {
        continue;
      }

      try {
        const selectedStreams = await selector.select(streams, expression);
        const exprNames = extractNamesFromExpression(expression);

        for (const selected of selectedStreams) {
          const stream = streamsById.get(selected.id);
          if (!stream) continue;
          stream.streamExpressionScore =
            (stream.streamExpressionScore ?? 0) + score;
          if (exprNames) {
            stream.rankedStreamExpressionsMatched = [
              ...(stream.rankedStreamExpressionsMatched ?? []),
              ...exprNames,
            ];
          }
        }
      } catch (error) {
        logger.error(
          {
            expression,
            err: error instanceof Error ? error.message : String(error),
          },
          'failed to apply ranked stream expression'
        );
      }
    }

    const nonZeroScores = streams.filter(
      (s) => (s.streamExpressionScore ?? 0) !== 0
    ).length;

    logger.debug(
      { streams: streams.length, nonZeroScores, took: Date.now() - start },
      'ranked stream expressions computed'
    );
    return Date.now() - start;
  }

  private async precomputeRankedRegexPatterns(
    streams: ParsedStream[]
  ): Promise<number> {
    if (!this.userData.rankedRegexPatterns?.length || streams.length === 0) {
      return 0;
    }
    const start = Date.now();

    const regexes = await Promise.all(
      this.userData.rankedRegexPatterns.map(async (entry) => ({
        ...entry,
        regex: await compileRegex(entry.pattern),
      }))
    );

    for (const stream of streams) {
      if (!stream.filename) {
        continue;
      }
      const matched: string[] = [];
      let totalScore = 0;
      for (const { regex, pattern, name, score } of regexes) {
        if (
          regex.test(stream.filename) ||
          (stream.folderName && regex.test(stream.folderName))
        ) {
          if (name) matched.push(name);
          totalScore += score;
        }
      }
      if (matched.length > 0) {
        stream.rankedRegexesMatched = matched;
        stream.regexScore = totalScore;
      }
    }

    logger.debug(
      {
        matched: streams.filter((s) => s.rankedRegexesMatched?.length).length,
        streams: streams.length,
        took: Date.now() - start,
      },
      'ranked regex patterns computed'
    );
    return Date.now() - start;
  }

  /**
   * Precompute preferred regex, keyword, and stream expression matches.
   */
  private async precomputePreferredRegexMatches(
    streams: ParsedStream[]
  ): Promise<number> {
    const start = Date.now();
    const preferredRegexPatterns =
      (await RegexAccess.isRegexAllowed(
        this.userData,
        this.userData.preferredRegexPatterns?.map(
          (pattern) => pattern.pattern
        ) ?? []
      )) && this.userData.preferredRegexPatterns
        ? await Promise.all(
            this.userData.preferredRegexPatterns.map(async (pattern) => {
              return {
                name: pattern.name,
                negate: parseRegex(pattern.pattern).flags.includes('n'),
                pattern: await compileRegex(pattern.pattern),
              };
            })
          )
        : undefined;
    const preferredKeywordsPatterns = this.userData.preferredKeywords
      ? await formRegexFromKeywords(this.userData.preferredKeywords)
      : undefined;

    if (
      !preferredRegexPatterns &&
      !preferredKeywordsPatterns &&
      !this.userData.preferredStreamExpressions?.length
    ) {
      return 0;
    }

    if (preferredKeywordsPatterns) {
      streams.forEach((stream) => {
        stream.keywordMatched =
          preferredKeywordsPatterns.test(stream.filename || '') ||
          preferredKeywordsPatterns.test(stream.folderName || '') ||
          preferredKeywordsPatterns.test(
            stream.parsedFile?.releaseGroup || ''
          ) ||
          preferredKeywordsPatterns.test(stream.indexer || '');
      });
    }
    const determineMatch = (
      stream: ParsedStream,
      regexPattern: { pattern: RegExp; negate: boolean },
      attribute?: string
    ) => {
      return attribute ? regexPattern.pattern.test(attribute) : false;
    };
    if (preferredRegexPatterns) {
      streams.forEach((stream) => {
        for (let i = 0; i < preferredRegexPatterns.length; i++) {
          // if negate, then the pattern must not match any of the attributes
          // and if the attribute is undefined, then we can consider that as a non-match so true
          const regexPattern = preferredRegexPatterns[i];
          const filenameMatch = determineMatch(
            stream,
            regexPattern,
            stream.filename
          );
          const folderNameMatch = determineMatch(
            stream,
            regexPattern,
            stream.folderName
          );
          const releaseGroupMatch = determineMatch(
            stream,
            regexPattern,
            stream.parsedFile?.releaseGroup
          );
          const indexerMatch = determineMatch(
            stream,
            regexPattern,
            stream.indexer
          );
          let match =
            filenameMatch ||
            folderNameMatch ||
            releaseGroupMatch ||
            indexerMatch;
          match = regexPattern.negate ? !match : match;
          if (match) {
            stream.regexMatched = {
              name: regexPattern.name,
              pattern: regexPattern.pattern.source,
              index: i,
            };
            break;
          }
        }
      });
    }
    return Date.now() - start;
  }

  private async precomputePreferredExpressionMatches(
    streams: ParsedStream[],
    context: StreamContext
  ): Promise<number> {
    const start = Date.now();
    if (this.userData.preferredStreamExpressions?.length) {
      const selector = new StreamSelector(context.toExpressionContext());
      const streamToConditionIndex = new Map<string, number>();

      // Go through each preferred filter condition, from highest to lowest priority.
      for (
        let i = 0;
        i < this.userData.preferredStreamExpressions.length;
        i++
      ) {
        const item = this.userData.preferredStreamExpressions[i];
        const { expression, enabled } = item;
        if (!enabled) continue;

        // From the streams that haven't been matched to a higher-priority condition yet...
        const availableStreams = streams.filter(
          (stream) => !streamToConditionIndex.has(stream.id)
        );

        // ...select the ones that match the current condition.
        try {
          const selectedStreams = await selector.select(
            availableStreams,
            expression
          );

          // And for each of those, record that this is the best condition they've matched so far.
          for (const stream of selectedStreams) {
            streamToConditionIndex.set(stream.id, i);
          }
        } catch (error) {
          logger.error(
            {
              expression,
              err: error instanceof Error ? error.message : String(error),
            },
            'failed to apply preferred stream expression'
          );
        }
      }

      // Now, apply the results to the original streams list.
      for (const stream of streams) {
        const conditionIndex = streamToConditionIndex.get(stream.id);
        if (conditionIndex !== undefined) {
          const expression =
            this.userData.preferredStreamExpressions[conditionIndex].expression;
          stream.streamExpressionMatched = {
            index: conditionIndex,
            name: extractNamesFromExpression(expression)?.[0],
          };
        }
      }
    }
    return Date.now() - start;
  }
}

export default StreamPrecomputer;
