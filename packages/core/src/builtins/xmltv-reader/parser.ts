import { parseStringPromise } from 'xml2js';

export interface XmltvChannel {
  id: string;
  name: string;
  logo?: string;
  aliases?: string[];
  language?: string;
}

interface XmltvProgram {
  channelId: string;
  title: string;
  subtitle?: string;
  startTime: string;
  endTime: string;
  released?: string;
  runtime?: string;
  description?: string;
  thumbnail?: string;
  categories?: string[];
  cast?: string[];
  directors?: string[];
}

export interface XmltvData {
  channels: XmltvChannel[];
  programs: XmltvProgram[];
}

function value(input: unknown): string | undefined {
  if (typeof input === 'string') return input.trim() || undefined;
  if (input && typeof input === 'object' && '_' in input)
    return value((input as { _: unknown })._);
  return undefined;
}

function values(input: unknown): string[] {
  return (Array.isArray(input) ? input : input ? [input] : [])
    .map(value)
    .filter((entry): entry is string => Boolean(entry));
}

function parseXmltvDate(input: unknown): string | undefined {
  const raw = value(input);
  const match = raw?.match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s+([+-])(\d{2})(\d{2}))?/
  );
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second, sign, tzHour, tzMinute] =
    match;
  let timestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
  if (sign) {
    const offset = (Number(tzHour) * 60 + Number(tzMinute)) * 60_000;
    timestamp += sign === '+' ? -offset : offset;
  }
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function parseProgramDate(input: unknown): string | undefined {
  const raw = value(input);
  if (!raw) return undefined;
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    const year = Number(compact[1]);
    const month = Number(compact[2]) - 1;
    const day = Number(compact[3]);
    const date = new Date(Date.UTC(year, month, day));
    return date.getUTCFullYear() === year &&
      date.getUTCMonth() === month &&
      date.getUTCDate() === day
      ? date.toISOString()
      : undefined;
  }
  const timestamp = Date.parse(raw);
  return Number.isNaN(timestamp)
    ? undefined
    : new Date(timestamp).toISOString();
}

function programRuntime(startTime: string, endTime: string) {
  const minutes = Math.round(
    (Date.parse(endTime) - Date.parse(startTime)) / 60_000
  );
  return minutes > 0 ? `${minutes} min` : undefined;
}

export async function parseXmltvData(xml: string): Promise<XmltvData> {
  const document = await parseStringPromise(xml);
  const channels = Array.isArray(document?.tv?.channel)
    ? document.tv.channel
    : [];

  const parsedChannels = channels
    .map((channel: any): XmltvChannel | undefined => {
      const id = value(channel?.$?.id);
      const names: string[] = (channel?.['display-name'] ?? [])
        .map((entry: any) =>
          value(typeof entry === 'string' ? entry : entry?._)
        )
        .filter((entry: string | undefined): entry is string => Boolean(entry));
      const name = names[0];
      if (!id || !name) return undefined;
      return {
        id,
        name,
        logo: value(channel?.icon?.[0]?.$?.src),
        aliases: [...new Set(names.slice(1))],
        language: value(channel?.['display-name']?.[0]?.$?.lang),
      };
    })
    .filter((channel: XmltvChannel | undefined): channel is XmltvChannel =>
      Boolean(channel)
    )
    .sort((a: XmltvChannel, b: XmltvChannel) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );

  const programs = (
    Array.isArray(document?.tv?.programme) ? document.tv.programme : []
  )
    .map((program: any): XmltvProgram | undefined => {
      const channelId = value(program?.$?.channel);
      const title = value(program?.title?.[0]?._ ?? program?.title?.[0]);
      const startTime = parseXmltvDate(program?.$?.start);
      const endTime = parseXmltvDate(program?.$?.stop);
      if (
        !channelId ||
        !title ||
        !startTime ||
        !endTime ||
        endTime <= startTime
      )
        return undefined;
      return {
        channelId,
        title,
        subtitle: value(
          program?.['sub-title']?.[0]?._ ?? program?.['sub-title']?.[0]
        ),
        startTime,
        endTime,
        released: parseProgramDate(program?.date?.[0]),
        runtime: programRuntime(startTime, endTime),
        description: value(program?.desc?.[0]?._ ?? program?.desc?.[0]),
        thumbnail: value(program?.icon?.[0]?.$?.src),
        categories: values(program?.category),
        cast: values(program?.credits?.[0]?.actor),
        directors: values(program?.credits?.[0]?.director),
      };
    })
    .filter((program: XmltvProgram | undefined): program is XmltvProgram =>
      Boolean(program)
    );

  return { channels: parsedChannels, programs };
}

export async function parseXmltv(xml: string): Promise<XmltvChannel[]> {
  return (await parseXmltvData(xml)).channels;
}
