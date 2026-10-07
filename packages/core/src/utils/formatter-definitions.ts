export type FormatterDefinition = { name: string; description: string };

const CHANNEL =
  '{live.channelName::exists["{live.channelName}"||"{addon.name}"]}';
const QUALITY = '{stream.resolution::exists[" · {stream.resolution}"||""]}';
const FORMAT =
  '{live.deliveryFormatKnown::istrue[" · {live.deliveryFormatLabel}"||""]}';
const SOURCE = '{live.providerName::exists["Source: {live.providerName}"||""]}';
const LANGUAGE =
  '{stream.languages::exists["Language: {stream.languages::join(\', \')}"||"{live.language::exists[\"Language: {live.language}\"||\"\"]}"]}';
const MESSAGE = '{stream.message::exists["{stream.message}"||""]}';
const PROGRAM = `{live.isCurrentProgram::istrue::and::live.programTitle::exists["Now: {live.programTitle}"||""]}
{live.isCurrentProgram::istrue::and::live.programSubtitle::exists["{live.programSubtitle}"||""]}
{live.isCurrentProgram::istrue::and::live.programStart::exists::and::live.programEnd::exists["{live.programStart} / {live.programEnd}"||""]}
{live.isCurrentProgram::istrue::and::live.programProgress::exists["Progress: {live.programProgress}%"||""]}`;
const TECHNICAL = `{stream.encode::exists["Codec: {stream.encode}"||""]}
{stream.visualTags::exists["Video: {stream.visualTags::join(', ')}"||""]}
{stream.audioTags::exists["Audio: {stream.audioTags::join(', ')}"||""]}
{stream.audioChannels::exists["Audio channels: {stream.audioChannels::join(', ')}"||""]}
{stream.bitrate::>0["Bitrate: {stream.bitrate::sbitrate}"||""]}
${LANGUAGE}
{stream.subtitles::exists["Subtitles: {stream.subtitles::join(', ')}"||""]}`;

export const BUILTIN_FORMATTER_DEFINITIONS: Record<
  string,
  FormatterDefinition
> = {
  minimalisticgdrive: {
    name: CHANNEL + QUALITY,
    description: MESSAGE,
  },
  lightgdrive: {
    name: CHANNEL + QUALITY + FORMAT,
    description: `${SOURCE}
{live.group::exists["Group: {live.group}"||""]}
${LANGUAGE}
${MESSAGE}`,
  },
  gdrive: {
    name: CHANNEL + QUALITY + FORMAT,
    description: `${SOURCE}
{live.group::exists["Group: {live.group}"||""]}
{live.country::exists["Country: {live.country}"||""]}
${TECHNICAL}
{live.hasSchedule::istrue["EPG schedule available"||""]}
{stream.proxied::istrue["Proxied"||""]}
${MESSAGE}`,
  },
  torrentio: {
    name: CHANNEL + QUALITY + FORMAT,
    description: `${PROGRAM}
${SOURCE}
${LANGUAGE}
${MESSAGE}`,
  },
  torbox: {
    name: CHANNEL + QUALITY + FORMAT,
    description: `${SOURCE}{live.providerType::exists[" ({live.providerType})"||""]}
{live.providerType::=manual::isfalse::and::live.sourceChannelId::exists["Source channel: {live.sourceChannelId}"||""]}
{live.streamHost::exists["Host: {live.streamHost}"||""]}
{live.matchStatus::exists["Mapping: {live.matchStatus}"||""]}{live.matchConfidence::exists[" · confidence {live.matchConfidence}"||""]}
{live.priority::exists["Priority index: {live.priority}"||""]}
${TECHNICAL}
${MESSAGE}`,
  },
  prism: {
    name: '📺 ' + CHANNEL + QUALITY,
    description: `${SOURCE}${FORMAT}
${TECHNICAL}
{live.hasSchedule::istrue["📅 EPG"||""]}
${MESSAGE}`,
  },
  tamtaro: {
    name: CHANNEL + QUALITY + FORMAT,
    description: `{live.providerName::exists["{live.providerName::smallcaps}"||""]}
{stream.encode::exists["{stream.encode} "||""]}{stream.visualTags::exists["{stream.visualTags::join(' · ')}"||""]}
${LANGUAGE}
${MESSAGE}`,
  },
};
