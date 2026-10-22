import { ParsedStream, SortCriterion, UserData } from '../db/schemas.js';
import { createLogger, constants } from '../utils/index.js';
import { StreamContext } from './index.js';

const logger = createLogger('sorter');

class StreamSorter {
  private userData: UserData;

  constructor(userData: UserData) {
    this.userData = userData;
  }

  public async sort(
    allStreams: ParsedStream[],
    context: StreamContext
  ): Promise<ParsedStream[]> {
    const pinnedToTopStreams = allStreams.filter(
      (stream) => stream.addon.pinPosition === 'top'
    );
    const pinnedToBottomStreams = allStreams.filter(
      (stream) => stream.addon.pinPosition === 'bottom'
    );
    const streams = allStreams.filter((stream) => !stream.addon.pinPosition);

    const start = Date.now();
    const criteria = constants.getLiveTvSortCriteria(
      this.userData.sortCriteria.global
    );
    const sortedStreams = streams.slice().sort((a, b) => {
      const aKey = this.dynamicSortKey(a, criteria);
      const bKey = this.dynamicSortKey(b, criteria);
      for (let i = 0; i < aKey.length; i++) {
        if (aKey[i] < bKey[i]) return -1;
        if (aKey[i] > bKey[i]) return 1;
      }
      return 0;
    });

    const pinnedParts = [];
    if (pinnedToTopStreams.length > 0) {
      pinnedParts.push(`${pinnedToTopStreams.length} pinned to top`);
    }
    if (pinnedToBottomStreams.length > 0) {
      pinnedParts.push(`${pinnedToBottomStreams.length} pinned to bottom`);
    }
    logger.debug(
      {
        sorted: sortedStreams.length,
        pinnedTop: pinnedToTopStreams.length,
        pinnedBottom: pinnedToBottomStreams.length,
        took: Date.now() - start,
      },
      'sort complete'
    );
    return [...pinnedToTopStreams, ...sortedStreams, ...pinnedToBottomStreams];
  }

  private dynamicSortKey(
    stream: ParsedStream,
    sortCriteria: SortCriterion[]
  ): any[] {
    function keyValue(sortCriterion: SortCriterion, userData: UserData) {
      const { key, direction } = sortCriterion;
      const multiplier = direction === 'asc' ? 1 : -1;
      switch (key) {
        case 'bitrate':
          return multiplier * (stream.bitrate ?? 0);
        case 'encode': {
          if (!userData.preferredEncodes) {
            return 0;
          }

          const index = userData.preferredEncodes?.findIndex(
            (encode) => encode === (stream.parsedFile?.encode || 'Unknown')
          );
          return multiplier * -(index === -1 ? Infinity : index);
        }
        case 'addon':
          // find the first occurence of the stream.addon.id in the addons array
          if (!userData.presets) {
            return 0;
          }

          const idx = userData.presets.findIndex(
            (p) => p.instanceId === stream.addon.preset.id
          );
          return multiplier * -(idx === -1 ? Infinity : idx);

        case 'resolution': {
          if (!userData.preferredResolutions) {
            return 0;
          }

          const index = userData.preferredResolutions?.findIndex(
            (resolution) =>
              resolution === (stream.parsedFile?.resolution || 'Unknown')
          );
          return multiplier * -(index === -1 ? Infinity : index);
        }
        case 'visualTag': {
          if (!userData.preferredVisualTags) {
            return 0;
          }

          const effectiveVisualTags = stream.parsedFile?.visualTags.length
            ? stream.parsedFile.visualTags
            : ['Unknown'];

          if (
            effectiveVisualTags.every(
              (tag) => !userData.preferredVisualTags!.includes(tag as any)
            )
          ) {
            return multiplier * -Infinity;
          }

          let minIndex = userData.preferredVisualTags?.length;

          for (const tag of effectiveVisualTags) {
            if (constants.VISUAL_TAGS.includes(tag as any)) {
              const idx = userData.preferredVisualTags?.indexOf(tag as any);
              if (idx !== undefined && idx !== -1 && idx < minIndex) {
                minIndex = idx;
              }
            }
          }
          return multiplier * -minIndex;
        }
        case 'audioTag': {
          if (!userData.preferredAudioTags) {
            return 0;
          }

          const effectiveAudioTags = stream.parsedFile?.audioTags.length
            ? stream.parsedFile.audioTags
            : ['Unknown'];

          if (
            effectiveAudioTags.every(
              (tag) => !userData.preferredAudioTags!.includes(tag as any)
            )
          ) {
            return multiplier * -Infinity;
          }
          let minAudioIndex = userData.preferredAudioTags.length;

          for (const tag of effectiveAudioTags) {
            if (constants.AUDIO_TAGS.includes(tag as any)) {
              const idx = userData.preferredAudioTags?.indexOf(tag as any);
              if (idx !== undefined && idx !== -1 && idx < minAudioIndex) {
                minAudioIndex = idx;
              }
            }
          }
          return multiplier * -minAudioIndex;
        }
        case 'language': {
          let minLanguageIndex = userData.preferredLanguages?.length;
          if (minLanguageIndex === undefined) {
            return 0;
          }
          const effectiveLanguages = stream.parsedFile?.languages?.length
            ? stream.parsedFile.languages
            : ['Unknown'];
          for (const language of effectiveLanguages) {
            const idx = userData.preferredLanguages?.indexOf(language as any);
            if (idx !== undefined && idx !== -1 && idx < minLanguageIndex) {
              minLanguageIndex = idx;
            }
          }
          return multiplier * -minLanguageIndex;
        }
        default:
          return 0;
      }
    }

    return (
      sortCriteria.map((sortCriterion) =>
        keyValue(sortCriterion, this.userData)
      ) ?? []
    );
  }
}

export default StreamSorter;
