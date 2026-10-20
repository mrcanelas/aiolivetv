import { afterEach, describe, expect, it, vi } from 'vitest';
import { createXtreamClient, loadXtreamChannels } from './client.js';
import { XtreamConfigSchema } from './config.js';

const config = XtreamConfigSchema.parse({
  url: 'http://example.invalid',
  username: 'fixture',
  password: 'fixture',
  timeout: 5000,
});
const channel = {
  stream_id: 123456,
  name: 'Schema Test',
  category_id: '157',
  stream_icon: '',
  epg_channel_id: '',
  added: '0',
  num: 1,
  tv_archive: 0,
  tv_archive_duration: 0,
};

afterEach(() => vi.unstubAllGlobals());

function provider(records: unknown[]) {
  const fetch = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes('action=get_profile')
            ? { user_info: { allowed_output_formats: ['ts'] } }
            : records
        )
      )
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('Xtream provider compatibility', () => {
  it.each([
    ['singular', channel, ['157']],
    ['plural', { ...channel, category_ids: [157, 158] }, ['157', '158']],
    ['string array', { ...channel, category_ids: ['157'] }, ['157']],
    ['missing', { ...channel, category_id: undefined }, []],
    ['null', { ...channel, category_id: null, category_ids: null }, []],
    ['empty array', { ...channel, category_ids: [] }, []],
  ])(
    'normalizes %s categories before the real serializer',
    async (_label, record, expected) => {
      provider([record]);
      const result = await loadXtreamChannels(createXtreamClient(config));
      expect(result[0].categoryIds).toEqual(expected);
      expect(result[0].id).toBe('123456');
    }
  );

  it('fetches 33k channels in one live-stream request', async () => {
    const fetch = provider(
      Array.from({ length: 32920 }, (_, id) => ({ ...channel, stream_id: id }))
    );
    const result = await loadXtreamChannels(createXtreamClient(config));
    expect(result).toHaveLength(32920);
    expect(
      fetch.mock.calls.filter(([url]) =>
        url.includes('action=get_live_streams')
      )
    ).toHaveLength(1);
  });

  it('fetches selected categories once each and deduplicates overlapping channels', async () => {
    const fetch = provider([channel]);
    expect(
      await loadXtreamChannels(createXtreamClient(config), ['157', '158'])
    ).toHaveLength(1);
    expect(
      fetch.mock.calls.filter(([url]) =>
        url.includes('action=get_live_streams')
      )
    ).toHaveLength(2);
  });
});
