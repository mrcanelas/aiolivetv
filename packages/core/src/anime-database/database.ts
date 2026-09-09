/**
 * Anime lookup is not used by AIOLiveTV. Callers still exist in leftover VOD
 * code paths; they receive empty results and never download mapping datasets.
 */
import type { IdType } from '../utils/id-parser.js';
import type { AnimeEntry, IdValue } from './types.js';

export class AnimeDatabase {
  private static instance: AnimeDatabase | null = null;

  public static getInstance(): AnimeDatabase {
    if (!AnimeDatabase.instance) AnimeDatabase.instance = new AnimeDatabase();
    return AnimeDatabase.instance;
  }

  private constructor() {}

  public async initialise(): Promise<void> {}

  public isAnime(_id: string): boolean {
    return false;
  }

  public getEntryById(
    _idType: IdType,
    _idValue: IdValue,
    _season?: number,
    _episode?: number
  ): AnimeEntry | null {
    return null;
  }
}
