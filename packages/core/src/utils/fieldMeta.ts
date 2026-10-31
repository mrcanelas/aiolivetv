import type { UserData } from '../db/schemas.js';

export type FieldType = 'list' | 'scalar';
export type FieldGroup =
  | 'branding'
  | 'filters'
  | 'sorting'
  | 'formatter'
  | 'proxy'
  | 'metadata'
  | 'misc';

export const MENU_IDS = [
  'about',
  'services',
  'addons',
  'channels',
  'filters',
  'sorting',
  'formatter',
  'proxy',
  'miscellaneous',
  'stats',
  'save-install',
] as const;
export type MenuId = (typeof MENU_IDS)[number];

export const FILTER_TAB_IDS = [
  'cache',
  'resolution',
  'quality',
  'encode',
  'stream-type',
  'visual-tag',
  'audio-tag',
  'audio-channel',
  'language',
  'subtitle',
  'seeders',
  'age',
  'matching',
  'keyword',
  'release-group',
  'stream-expression',
  'regex',
  'size',
  'bitrate',
  'limit',
  'deduplicator',
  'miscellaneous',
] as const;
export type FilterTabId = (typeof FILTER_TAB_IDS)[number];

export interface FieldMeta {
  label: string;
  group: FieldGroup;
  type: FieldType;
  /** For object-array list fields, the property used as the identity key for extend merging */
  identityKey?: string;
  /** Top-level menu where this field lives (used for command palette navigation) */
  menu: MenuId;
  /** Sub-tab within the menu (filters, miscellaneous, services, addons all use sub-tabs) */
  subTab?: string;
  /** DOM id of the section/card to scroll to. Defaults to the field key when omitted. */
  sectionId?: string;
  /** Extra search keywords for the command palette */
  keywords?: string[];
  /** Exclude from the parent config field-overrides UI. Field appears in the command palette but cannot be individually overridden in the parent config modal. */
  ignoreForParentConfig?: boolean;
}

type IgnoredKeys =
  | 'uuid'
  | 'encryptedPassword'
  | 'trusted'
  | 'addons'
  | 'proxies'
  | 'ip'
  | 'addonCategories'
  | 'appliedTemplates';

// prettier-ignore
export const FIELD_META: Omit<Record<keyof UserData, FieldMeta>, IgnoredKeys> = {
  excludedResolutions: { label: 'Excluded Resolutions', group: 'filters', type: 'list', menu: 'filters', subTab: 'resolution' },
  includedResolutions: { label: 'Included Resolutions', group: 'filters', type: 'list', menu: 'filters', subTab: 'resolution' },
  requiredResolutions: { label: 'Required Resolutions', group: 'filters', type: 'list', menu: 'filters', subTab: 'resolution' },
  preferredResolutions: { label: 'Preferred Resolutions', group: 'sorting', type: 'list', menu: 'sorting', sectionId: 'preferredValues' },

  excludedLanguages: { label: 'Excluded Languages', group: 'filters', type: 'list', menu: 'filters', subTab: 'language' },
  includedLanguages: { label: 'Included Languages', group: 'filters', type: 'list', menu: 'filters', subTab: 'language' },
  requiredLanguages: { label: 'Required Languages', group: 'filters', type: 'list', menu: 'filters', subTab: 'language' },
  preferredLanguages: { label: 'Preferred Languages', group: 'sorting', type: 'list', menu: 'sorting', sectionId: 'preferredValues' },

  excludedSubtitles: { label: 'Excluded Subtitles', group: 'filters', type: 'list', menu: 'filters', subTab: 'subtitle', keywords: ['subs'] },
  includedSubtitles: { label: 'Included Subtitles', group: 'filters', type: 'list', menu: 'filters', subTab: 'subtitle', keywords: ['subs'] },
  requiredSubtitles: { label: 'Required Subtitles', group: 'filters', type: 'list', menu: 'filters', subTab: 'subtitle', keywords: ['subs'] },
  preferredSubtitles: { label: 'Preferred Subtitles', group: 'filters', type: 'list', menu: 'filters', subTab: 'subtitle', keywords: ['subs'] },

  excludedVisualTags: { label: 'Excluded Visual Tags', group: 'filters', type: 'list', menu: 'filters', subTab: 'visual-tag', keywords: ['hdr', 'dolby vision', 'dv'] },
  includedVisualTags: { label: 'Included Visual Tags', group: 'filters', type: 'list', menu: 'filters', subTab: 'visual-tag', keywords: ['hdr', 'dolby vision', 'dv'] },
  requiredVisualTags: { label: 'Required Visual Tags', group: 'filters', type: 'list', menu: 'filters', subTab: 'visual-tag', keywords: ['hdr', 'dolby vision', 'dv'] },
  preferredVisualTags: { label: 'Preferred Visual Tags', group: 'sorting', type: 'list', menu: 'sorting', sectionId: 'preferredValues', keywords: ['hdr', 'dolby vision', 'dv'] },

  excludedAudioTags: { label: 'Excluded Audio Tags', group: 'filters', type: 'list', menu: 'filters', subTab: 'audio-tag', keywords: ['atmos', 'dts', 'truehd'] },
  includedAudioTags: { label: 'Included Audio Tags', group: 'filters', type: 'list', menu: 'filters', subTab: 'audio-tag', keywords: ['atmos', 'dts', 'truehd'] },
  requiredAudioTags: { label: 'Required Audio Tags', group: 'filters', type: 'list', menu: 'filters', subTab: 'audio-tag', keywords: ['atmos', 'dts', 'truehd'] },
  preferredAudioTags: { label: 'Preferred Audio Tags', group: 'sorting', type: 'list', menu: 'sorting', sectionId: 'preferredValues', keywords: ['atmos', 'dts', 'truehd'] },

  excludedAudioChannels: { label: 'Excluded Audio Channels', group: 'filters', type: 'list', menu: 'filters', subTab: 'audio-channel' },
  includedAudioChannels: { label: 'Included Audio Channels', group: 'filters', type: 'list', menu: 'filters', subTab: 'audio-channel' },
  requiredAudioChannels: { label: 'Required Audio Channels', group: 'filters', type: 'list', menu: 'filters', subTab: 'audio-channel' },
  preferredAudioChannels: { label: 'Preferred Audio Channels', group: 'sorting', type: 'list', menu: 'sorting', sectionId: 'preferredValues' },

  excludedStreamTypes: { label: 'Excluded Stream Types', group: 'filters', type: 'list', menu: 'filters', subTab: 'stream-type' },
  includedStreamTypes: { label: 'Included Stream Types', group: 'filters', type: 'list', menu: 'filters', subTab: 'stream-type' },
  requiredStreamTypes: { label: 'Required Stream Types', group: 'filters', type: 'list', menu: 'filters', subTab: 'stream-type' },
  preferredStreamTypes: { label: 'Preferred Stream Types', group: 'filters', type: 'list', menu: 'filters', subTab: 'stream-type' },

  excludedEncodes: { label: 'Excluded Encodes', group: 'filters', type: 'list', menu: 'filters', subTab: 'encode' },
  includedEncodes: { label: 'Included Encodes', group: 'filters', type: 'list', menu: 'filters', subTab: 'encode' },
  requiredEncodes: { label: 'Required Encodes', group: 'filters', type: 'list', menu: 'filters', subTab: 'encode' },
  preferredEncodes: { label: 'Preferred Encodes', group: 'sorting', type: 'list', menu: 'sorting', sectionId: 'preferredValues' },

  excludedKeywords: { label: 'Excluded Keywords', group: 'filters', type: 'list', menu: 'filters', subTab: 'keyword' },
  includedKeywords: { label: 'Included Keywords', group: 'filters', type: 'list', menu: 'filters', subTab: 'keyword' },
  requiredKeywords: { label: 'Required Keywords', group: 'filters', type: 'list', menu: 'filters', subTab: 'keyword' },
  preferredKeywords: { label: 'Preferred Keywords', group: 'filters', type: 'list', menu: 'filters', subTab: 'keyword' },

  excludedRegexPatterns: { label: 'Excluded Regex Patterns', group: 'filters', type: 'list', menu: 'filters', subTab: 'regex' },
  includedRegexPatterns: { label: 'Included Regex Patterns', group: 'filters', type: 'list', menu: 'filters', subTab: 'regex' },
  requiredRegexPatterns: { label: 'Required Regex Patterns', group: 'filters', type: 'list', menu: 'filters', subTab: 'regex' },
  preferredRegexPatterns: { label: 'Preferred Regex Patterns', group: 'filters', type: 'list', identityKey: 'pattern', menu: 'filters', subTab: 'regex' },
  rankedRegexPatterns: { label: 'Ranked Regex Patterns', group: 'filters', type: 'list', identityKey: 'pattern', menu: 'filters', subTab: 'regex' },
  regexOverrides: { label: 'Regex Overrides', group: 'filters', type: 'list', identityKey: 'pattern', menu: 'filters', subTab: 'regex' },
  syncedExcludedRegexUrls: { label: 'Synced Excluded Regex URLs', group: 'filters', type: 'list', menu: 'filters', subTab: 'regex' },
  syncedIncludedRegexUrls: { label: 'Synced Included Regex URLs', group: 'filters', type: 'list', menu: 'filters', subTab: 'regex' },
  syncedRequiredRegexUrls: { label: 'Synced Required Regex URLs', group: 'filters', type: 'list', menu: 'filters', subTab: 'regex' },
  syncedPreferredRegexUrls: { label: 'Synced Preferred Regex URLs', group: 'filters', type: 'list', menu: 'filters', subTab: 'regex' },
  syncedRankedRegexUrls: { label: 'Synced Ranked Regex URLs', group: 'filters', type: 'list', menu: 'filters', subTab: 'regex' },

  excludedStreamExpressions: { label: 'Excluded Stream Expressions', group: 'filters', type: 'list', identityKey: 'expression', menu: 'filters', subTab: 'stream-expression', keywords: ['sel'] },
  includedStreamExpressions: { label: 'Included Stream Expressions', group: 'filters', type: 'list', identityKey: 'expression', menu: 'filters', subTab: 'stream-expression', keywords: ['sel'] },
  requiredStreamExpressions: { label: 'Required Stream Expressions', group: 'filters', type: 'list', identityKey: 'expression', menu: 'filters', subTab: 'stream-expression', keywords: ['sel'] },
  preferredStreamExpressions: { label: 'Preferred Stream Expressions', group: 'filters', type: 'list', identityKey: 'expression', menu: 'filters', subTab: 'stream-expression', keywords: ['sel'] },
  rankedStreamExpressions: { label: 'Ranked Stream Expressions', group: 'filters', type: 'list', identityKey: 'expression', menu: 'filters', subTab: 'stream-expression', keywords: ['sel'] },
  selOverrides: { label: 'Stream Expression Overrides', group: 'filters', type: 'list', identityKey: 'expression', menu: 'filters', subTab: 'stream-expression' },
  syncedExcludedStreamExpressionUrls: { label: 'Synced Excluded Expression URLs', group: 'filters', type: 'list', menu: 'filters', subTab: 'stream-expression' },
  syncedIncludedStreamExpressionUrls: { label: 'Synced Included Expression URLs', group: 'filters', type: 'list', menu: 'filters', subTab: 'stream-expression' },
  syncedRequiredStreamExpressionUrls: { label: 'Synced Required Expression URLs', group: 'filters', type: 'list', menu: 'filters', subTab: 'stream-expression' },
  syncedPreferredStreamExpressionUrls: { label: 'Synced Preferred Expression URLs', group: 'filters', type: 'list', menu: 'filters', subTab: 'stream-expression' },
  syncedRankedStreamExpressionUrls: { label: 'Synced Ranked Expression URLs', group: 'filters', type: 'list', menu: 'filters', subTab: 'stream-expression' },
  bitrate: { label: 'Bitrate Filter', group: 'filters', type: 'scalar', menu: 'filters', subTab: 'bitrate' },

  sortCriteria: { label: 'Sort Criteria', group: 'sorting', type: 'scalar', menu: 'sorting' },
  deduplicator: { label: 'Deduplicator', group: 'sorting', type: 'scalar', menu: 'filters', subTab: 'deduplicator' },
  resultLimits: { label: 'Result Limits', group: 'sorting', type: 'scalar', menu: 'filters', subTab: 'limit' },

  formatter: { label: 'Formatter', group: 'formatter', type: 'scalar', menu: 'formatter' },

  proxy: { label: 'Proxy', group: 'proxy', type: 'scalar', menu: 'proxy' },

  tmdbApiKey: { label: 'TMDB API Key', group: 'metadata', type: 'scalar', menu: 'services', sectionId: 'tmdb' },
  epgMetadataLanguage: { label: 'EPG metadata language', group: 'metadata', type: 'scalar', menu: 'services', sectionId: 'tmdb' },
  tmdbAccessToken: { label: 'TMDB Access Token', group: 'metadata', type: 'scalar', menu: 'services', sectionId : 'tmdb' },
  tvdbApiKey: { label: 'TVDB API Key', group: 'metadata', type: 'scalar', menu: 'services', subTab: 'metadata' },
  rpdbApiKey: { label: 'RPDB API Key', group: 'metadata', type: 'scalar', menu: 'services', subTab: 'posters' },
  topPosterApiKey: { label: 'TopPoster API Key', group: 'metadata', type: 'scalar', menu: 'services', subTab: 'posters' },
  aioratingsApiKey: { label: 'AIOratings API Key', group: 'metadata', type: 'scalar', menu: 'services', subTab: 'posters' },
  aioratingsProfileId: { label: 'AIOratings Profile ID', group: 'metadata', type: 'scalar', menu: 'services', subTab: 'posters' },
  openposterdbApiKey: { label: 'OpenPosterDB API Key', group: 'metadata', type: 'scalar', menu: 'services', subTab: 'posters' },
  openposterdbUrl: { label: 'OpenPosterDB URL', group: 'metadata', type: 'scalar', menu: 'services', subTab: 'posters' },
  openposterdbParameters: { label: 'OpenPosterDB Custom Parameters', group: 'metadata', type: 'scalar', menu: 'services', subTab: 'posters' },
  posterService: { label: 'Poster Service', group: 'metadata', type: 'scalar', menu: 'services', subTab: 'posters' },
  usePosterRedirectApi: { label: 'Use Poster Redirect API', group: 'metadata', type: 'scalar', menu: 'services', subTab: 'posters' },
  usePosterServiceForMeta: { label: 'Use Poster Service for Meta', group: 'metadata', type: 'scalar', menu: 'services', subTab: 'posters' },
  statistics: { label: 'Statistics', group: 'misc', type: 'scalar', menu: 'miscellaneous', subTab: 'display' },
  hideErrors: { label: 'Hide Errors', group: 'misc', type: 'scalar', menu: 'miscellaneous', subTab: 'display' },
  hideErrorsForResources: { label: 'Hide Errors for Resources', group: 'misc', type: 'list', menu: 'miscellaneous', subTab: 'display', sectionId: 'hideErrors' },
  streamProbe: { label: 'Stream Probe (ffprobe)', group: 'misc', type: 'scalar', menu: 'miscellaneous', subTab: 'playback', keywords: ['ffprobe', 'live tv', 'codec', 'resolution', 'notWebReady', 'web'] },

  dynamicAddonFetching: { label: 'Dynamic Addon Fetching', group: 'misc', type: 'scalar', menu: 'addons', subTab: 'addons', sectionId: 'fetchStrategy', keywords: ['exit condition', 'dynamic fetching', 'fetch strategy'] },
  addonCategoryColors: { label: 'Addon Category Colors', group: 'misc', type: 'scalar', menu: 'addons', subTab: 'addons' },
  catalogModifications: { label: 'Catalog Modifications', group: 'misc', type: 'scalar', menu: 'channels' },
  channelMappings: { label: 'Channel Mappings', group: 'metadata', type: 'list', identityKey: 'id', menu: 'channels', keywords: ['live tv', 'm3u', 'xmltv'] },
  mergedCatalogs: { label: 'Merged Catalogs', group: 'misc', type: 'scalar', menu: 'channels' },

  accessKey: { label: 'Config Access Key', group: 'misc', type: 'scalar', menu: 'save-install' },
  showChanges: { label: 'Show Changes', group: 'misc', type: 'scalar', menu: 'save-install' },

  addonName: { label: 'Addon Name', group: 'branding', type: 'scalar', menu: 'about', keywords: ['branding'] },
  addonLogo: { label: 'Addon Logo', group: 'branding', type: 'scalar', menu: 'about', keywords: ['branding'] },
  addonBackground: { label: 'Addon Background', group: 'branding', type: 'scalar', menu: 'about', keywords: ['branding'] },
  addonDescription: { label: 'Addon Description', group: 'branding', type: 'scalar', menu: 'about', keywords: ['branding'] },


  presets: { label: 'Addons', group: 'misc', type: 'list', identityKey: 'instanceId', menu: 'addons', subTab: 'addons', keywords: ['addons', 'presets'], ignoreForParentConfig: true },
  services: { label: 'Services', group: 'misc', type: 'list', identityKey: 'id', menu: 'services', subTab: 'services', ignoreForParentConfig: true },
  parentConfig: { label: 'Parent Config', group: 'misc', type: 'scalar', menu: 'miscellaneous', subTab: 'parent', sectionId: 'parentConfig', keywords: ['inherit', 'link', 'parent'], ignoreForParentConfig: true },
  groups: { label: 'Groups', group: 'misc', type: 'scalar', menu: 'addons', subTab: 'addons', keywords: ['groupings'], ignoreForParentConfig: true, sectionId: 'fetchStrategy' },
};
