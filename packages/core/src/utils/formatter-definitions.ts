export type FormatterDefinition = { name: string; description: string };

export const BUILTIN_FORMATTER_DEFINITIONS: Record<
  string,
  FormatterDefinition
> = {
  torrentio: {
    name: `{stream.proxied::istrue["🕵️‍♂️ "||""]}{live.channelName::exists["{live.channelName}"||"{addon.name}"]} {stream.resolution::exists["{stream.resolution}"||"LIVE"]}
{live.deliveryFormatKnown::istrue["{live.deliveryFormatLabel}"||""]}{stream.visualTags::exists[" | {stream.visualTags::join(' | ')}"||""]}`,
    description: `{stream.encode::exists["🎞️ {stream.encode} "||""]}{live.providerName::exists["📡 {live.providerName} "||""]}{live.epgProvider::istrue["📅 EPG "||""]}
{stream.languageEmojis::exists["{stream.languageEmojis::join(' / ')}"||""]}
{stream.message::exists["ℹ️ {stream.message}"||""]}
`,
  },
  torbox: {
    name: `{stream.proxied::istrue["🕵️‍♂️ "||""]}{live.channelName::exists["{live.channelName}"||"{addon.name}"]}{stream.resolution::exists[" ({stream.resolution})"||""]}`,
    description: `Channel: {live.channelName::exists["{live.channelName}"||"Unknown"]}
Source: {live.providerName::exists["{live.providerName}"||"{addon.name}"]}{live.providerType::exists[" ({live.providerType})"||""]}
Format: {live.deliveryFormatLabel::exists["{live.deliveryFormatLabel}"||"Unknown"]}{stream.encode::exists[" | {stream.encode}"||""]}
Languages: {stream.languages::exists["{stream.languages::join(', ')}"||""]}
{stream.message::exists["Message: {stream.message}"||""]}`,
  },
  gdrive: {
    name: `{stream.proxied::istrue["🕵️ "||""]}{live.channelName::exists["{live.channelName}"||"{addon.name}"]} {stream.resolution::exists["{stream.resolution}"||""]}{live.deliveryFormatKnown::istrue[" · {live.deliveryFormatLabel}"||""]}{stream.regexMatched::exists[" ({stream.regexMatched})"||""]}`,
    description: `{stream.encode::exists["🎞️ {stream.encode} "||""]}{stream.visualTags::exists["📺 {stream.visualTags::join(' | ')} "||""]}{stream.audioTags::exists["🎧 {stream.audioTags::join(' | ')} "||""]}{stream.audioChannels::exists["🔊 {stream.audioChannels::join(' | ')}"||""]}
{live.providerName::exists["📡 {live.providerName} "||""]}{live.providerType::exists["({live.providerType}) "||""]}{live.epgProvider::istrue["📅 EPG "||""]}{live.matchConfidence::exists["🎯 {live.matchConfidence}"||""]}
{stream.languages::exists["🌎 {stream.languages::join(' | ')}"||""]}{stream.subtitles::exists["📝 {stream.subtitles::join(' | ')}"||""]}
{stream.bitrate::>0["📊 {stream.bitrate::sbitrate} "||""]}
{stream.message::exists["ℹ️ {stream.message}"||""]}
      `,
  },
  lightgdrive: {
    name: `{stream.proxied::istrue["🕵️ "||""]}{live.channelName::exists["{live.channelName}"||"{addon.name}"]}{stream.resolution::exists[" {stream.resolution}"||""]}{live.deliveryFormatKnown::istrue[" · {live.deliveryFormatLabel}"||""]}{stream.regexMatched::exists[" ({stream.regexMatched})"||""]}`,
    description: `{live.providerName::exists["📡 {live.providerName}"||""]}{live.group::exists[" · {live.group}"||""]}
{stream.encode::exists["🎞️ {stream.encode} "||""]}{stream.visualTags::exists["📺 {stream.visualTags::join(' • ')} "||""]}{stream.audioChannels::exists["🔊 {stream.audioChannels::join(' • ')}"||""]}
{stream.languageEmojis::exists["🌐 {stream.languageEmojis::join(' / ')}"||""]}
{stream.message::exists["ℹ️ {stream.message}"||""]}`,
  },
  minimalisticgdrive: {
    name: `{stream.resolution::exists["{stream.resolution::replace('2160p','✨ 4K')::replace('1440p','📀 2K')::replace('1080p','🧿1080p')::replace('720p','💿720p')}"||"LIVE"]}{live.deliveryFormatKnown::istrue["  {live.deliveryFormatLabel}"||""]}
{live.channelName::exists["{live.channelName}"||"{addon.name}"]}
`,
    description: `{stream.encode::exists["🎞️ {stream.encode}  "||""]}{stream.visualTags::exists["🔆 {stream.visualTags::join(' • ')}  "||""]}
{stream.languages::exists["🌎 {stream.languages::join(' • ')}"||""]}
`,
  },
  prism: {
    name: `{stream.resolution::exists["{stream.resolution::replace('2160p', '🔥4K UHD')::replace('1440p','✨ QHD')::replace('1080p','🚀 FHD')::replace('720p','💿 HD')::replace('576p','💩 Low Quality')::replace('480p','💩 Low Quality')::replace('360p','💩 Low Quality')::replace('240p','💩 Low Quality')::replace('144p','💩 Low Quality')}"||"📺 LIVE"]}`,
    description: `{live.channelName::exists["📺 {live.channelName} "||""]}{live.deliveryFormatKnown::istrue["🎚️ {live.deliveryFormatLabel} "||""]}{stream.regexMatched::exists["🎚️ {stream.regexMatched} "||""]}
{stream.visualTags::exists["📺 {stream.visualTags::join(' | ')} "||""]}{stream.encode::exists["🎞️ {stream.encode} "||""]}
{stream.audioTags::exists["🎧 {stream.audioTags::join(' | ')} "||""]}{stream.audioChannels::exists["🔊 {stream.audioChannels::join(' | ')} "||""]}{stream.languages::exists["🗣️ {stream.languageEmojis::join(' / ')}"||""]}
{live.providerName::exists["📡 {live.providerName} "||""]}{live.group::exists["🎭 {live.group} "||""]}
{stream.type::=live["📺 Live "||""]}{stream.type::=http["💻 Web Link "||""]}{stream.proxied::istrue["🔒 Proxied "||""]}{live.epgProvider::istrue["📅 EPG "||""]}🔍{addon.name}
{stream.message::exists["ℹ️ {stream.message}"||""]}
`,
  },
  tamtaro: {
    name: `{stream.resolution::exists["{stream.resolution::replace('2160p','   4K ')::replace('1440p','    2K ')::replace('p','P')}‍"||"‍     "]}{stream.type::exists["‍{stream.type::replace('debrid','    ')::replace('p2p','⁽ᵖ²ᵖ⁾')::replace('live','⁽ˡᶦᵛᵉ⁾')::replace('http','⁽ʷᵉᵇ⁾')::replace('usenet','‍⁽ⁿᶻᵇ⁾‍')::replace('stremio-usenet','‏⁽ⁿᶻᵇ⁾')::replace('info','⁽ᶦⁿᶠᵒ⁾')::replace('statistic','⁽ˢᵗᵃᵗˢ⁾')::replace('external','⁽ᵉˣᵗ⁾')::replace('error','⁽ᵉʳʳᵒʳ⁾')::replace('youtube','⁽ʸᵗ⁾')}‍‍‍"||""]}{live.epgProvider::istrue["⚡"||""]}{live.channelName::exists["‍‍\n  〈{live.channelName::truncate(18)}〉‍     "||""]}`,
    description: `{live.providerName::exists["✎  {live.providerName::truncate(15)}"||""]}{live.deliveryFormatKnown::istrue["  {live.deliveryFormatLabel::smallcaps}"||""]}
{stream.encode::exists["▣  {stream.encode}  "||""]}{stream.visualTags::~DV::or::stream.visualTags::~HDR::or::stream.visualTags::~HDR10::or::stream.visualTags::~HDR10+::and::stream.visualTags::exists["✦  "||""]}{stream.visualTags::exists["{stream.visualTags::sort::join(' · ')::replace('HDR · HDR','HDR')} "||""]}
{stream.audioTags::exists["♬  {stream.audioTags::lsort::join(' · ')::replace('DD · DD','DD')::replace('DTS · DTS','DTS')}  "||""]}{stream.audioChannels::exists["♯  {stream.audioChannels::join(' · ')} "||""]}
{stream.bitrate::exists["◈  {stream.bitrate::sbitrate::replace('Mbps','ᴹᵇᵖˢ')::replace('Kbps','ᴷᵇᵖˢ')} "||""]}
{stream.proxied::istrue["⛊  "||"⛉  "]}{addon.name}{live.matchStatus::exists[" · {live.matchStatus::truncate(13)}"||""]}
{stream.uLanguages::exists["⛿  {stream.uSmallLanguageCodes::join(' · ')::replace('ꜰ','ғ')::replace('x','х')::replace('ꞯ','ϙ')::replace('ꜱ','s')::replace('ᴅᴜᴀʟ ᴀᴜᴅɪᴏ','ᴅᴜᴏ')::replace('ᴅᴜʙʙᴇᴅ','ᴅᴜʙ')}  "||""]}{stream.subbed::istrue::and::stream.uLanguages::exists["· sᴜʙ "||""]}{stream.subbed::istrue::and::stream.uLanguages::exists::isfalse["⛿  sᴜʙ "||""]}{stream.message::exists[" »  {stream.message::smallcaps}"||""]}`,
  },
};
