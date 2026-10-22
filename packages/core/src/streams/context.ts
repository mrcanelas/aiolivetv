import type { ParsedStream, UserData } from '../db/schemas.js';

export interface ExpressionContext {
  type?: string;
  id?: string;
  isAnime?: boolean;
  queryType?: string;
  season?: number;
  episode?: number;
  // Metadata fields
  title?: string;
  titles?: string[];
  year?: number;
  yearEnd?: number;
  genres?: string[];
  runtime?: number;
  absoluteEpisode?: number;
  relativeAbsoluteEpisode?: number; // Episode number within current AniDB entry (for split entries)
  originalLanguage?: string;
  daysSinceRelease?: number; // age in days of the movie / **episode**
  hasNextEpisode?: boolean;
  daysUntilNextEpisode?: number;
  daysSinceFirstAired?: number;
  daysSinceLastAired?: number;
  latestSeason?: number;
  // Anime entry data
  anilistId?: number;
  malId?: number;
  // SeaDex availability
  hasSeaDex?: boolean;
}
export class StreamContext {
  public get queryType(): string {
    return this.type;
  }
  private constructor(
    public readonly type: string,
    public readonly id: string,
    private readonly userData: UserData
  ) {}

  public static create(
    type: string,
    id: string,
    userData: UserData
  ): StreamContext {
    return new StreamContext(type, id, userData);
  }

  public toFormatterContext(
    streams?: ParsedStream[]
  ): import('../formatters/base.js').FormatterContext {
    const maxScore = (key: 'streamExpressionScore' | 'regexScore') => {
      const scores = (streams ?? []).flatMap((stream) =>
        typeof stream[key] === 'number' ? [stream[key]] : []
      );
      return scores.length ? Math.max(...scores) : undefined;
    };
    return {
      userData: this.userData,
      type: this.type,
      queryType: this.type,
      maxSeScore: maxScore('streamExpressionScore'),
      maxRegexScore: maxScore('regexScore'),
    };
  }

  public toExpressionContext(): ExpressionContext {
    return { type: this.type, id: this.id, queryType: this.type };
  }
}
