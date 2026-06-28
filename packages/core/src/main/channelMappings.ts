import type { UserData } from '../db/index.js';

export function getChannelMapping(userData: UserData, channelId: string) {
  return userData.channelMappings?.find((channel) => channel.id === channelId);
}

export function isChannelAddonEnabled(
  userData: UserData,
  channelId: string,
  addonId: string
) {
  return (
    getChannelMapping(userData, channelId)?.streams?.find(
      (stream) => stream.addonId === addonId
    )?.enabled !== false
  );
}
