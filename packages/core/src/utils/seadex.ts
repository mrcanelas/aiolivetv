export interface SeaDexResult {
  bestHashes: Set<string>;
  allHashes: Set<string>;
  bestGroups: Set<string>;
  allGroups: Set<string>;
}

export interface SeaDexTagResult {
  isBest: boolean;
  isSeadex: boolean;
}

/** SeaDex is not used by AIOLiveTV. Callers receive empty sets. */
export async function getSeaDexInfoHashes(
  _anilistId: number
): Promise<SeaDexResult> {
  return {
    bestHashes: new Set(),
    allHashes: new Set(),
    bestGroups: new Set(),
    allGroups: new Set(),
  };
}

export default getSeaDexInfoHashes;
