import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/index.js', () => ({
  Cache: {
    getInstance: () => ({
      get: vi.fn(),
      set: vi.fn(),
    }),
  },
  decodeHtmlEntities: (value: string) =>
    value.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' '),
  fromUrlSafeBase64: (value: string) =>
    Buffer.from(value, 'base64url').toString(),
  makeRequest: vi.fn(),
  toUrlSafeBase64: (value: string) => Buffer.from(value).toString('base64url'),
}));

const {
  MiTvAddon,
  parseMiTvClock,
  parseMiTvListings,
  parseMiTvSitemap,
} = await import('./addon.js');
const { makeRequest } = await import('../../utils/index.js');

const SITEMAP_HTML = `
  <a href="/br/canais/rede-globo">Globo</a>
  <a href="/br/canais/a-e">A&amp;E</a>
  <a href="/br/canais/broken">$nameFromProvider</a>
`;

const LISTINGS_HTML = `
<div id="listings">
  <ul class="broadcasts time24">
    <li>
      <a class="program-link">
        <div class="image-parent">
          <div class="image" style="background-image: url('https://cdn.mitvstatic.com/programs/globo.jpg')"></div>
        </div>
        <div class="content">
          <span class="time">20:30</span>
          <h2>Jornal Nacional</h2>
          <span class="sub-title">Noticiário</span>
          <p class="synopsis">As notícias do dia.</p>
        </div>
      </a>
    </li>
    <li class="native"><div id="ad"></div></li>
    <li>
      <a class="program-link">
        <div class="content">
          <span class="time">21:25</span>
          <h2>Novela</h2>
          <span class="sub-title">Temporada 2 Episódio 14 - O Encontro</span>
          <p class="synopsis">Capítulo da noite.</p>
        </div>
      </a>
    </li>
    <li>
      <a class="program-link">
        <div class="content">
          <span class="time">00:15</span>
          <h2>Filme da madrugada</h2>
        </div>
      </a>
    </li>
  </ul>
</div>
`;

describe('Mi.tv builtin', () => {
  it('exposes catalog and EPG metadata for the selected country', () => {
    const addon = new MiTvAddon({ timeout: 1000, country: 'ar' });
    expect(addon.getManifest().behaviorHints?.epgProvider).toBe(true);
    expect(addon.getManifest().name).toBe('Mi.tv (Argentina)');
    expect(addon.getManifest().catalogs[0].extra).toEqual([
      { name: 'skip' },
      { name: 'date' },
    ]);
  });

  it('parses sitemap channels and skips placeholder names', () => {
    const channels = parseMiTvSitemap(SITEMAP_HTML, 'br');
    expect(channels.map((channel) => channel.slug)).toEqual([
      'a-e',
      'rede-globo',
    ]);
    expect(channels[0]).toMatchObject({
      name: 'A&E',
      logo: 'https://cdn.mitvstatic.com/channels/br_a-e_m.png',
    });
  });

  it('parses 12-hour and 24-hour clocks', () => {
    expect(parseMiTvClock('05:40')).toEqual({ hours: 5, minutes: 40 });
    expect(parseMiTvClock('5:45am')).toEqual({ hours: 5, minutes: 45 });
    expect(parseMiTvClock('12:00pm')).toEqual({ hours: 12, minutes: 0 });
    expect(parseMiTvClock('12:15am')).toEqual({ hours: 0, minutes: 15 });
  });

  it('parses listings, skips ads and rolls past midnight', () => {
    const programs = parseMiTvListings(LISTINGS_HTML, '2026-09-11');
    expect(programs).toHaveLength(3);
    expect(programs[0]).toMatchObject({
      title: 'Jornal Nacional',
      subtitle: 'Noticiário',
      startTime: '2026-09-11T20:30:00.000Z',
      endTime: '2026-09-11T21:25:00.000Z',
    });
    expect(programs[1]).toMatchObject({
      title: 'Novela',
      subtitle: 'O Encontro',
      season: 2,
      episode: 14,
    });
    expect(programs[2]?.title).toBe('Filme da madrugada');
    expect(programs[2]?.startTime).toBe('2026-09-12T00:15:00.000Z');
  });

  it('maps catalog channels from the sitemap', async () => {
    vi.mocked(makeRequest).mockResolvedValueOnce({
      ok: true,
      text: async () => SITEMAP_HTML,
    } as unknown as Awaited<ReturnType<typeof makeRequest>>);

    const addon = new MiTvAddon({ timeout: 1000, country: 'br' });
    const catalog = await addon.getCatalog();

    expect(catalog).toHaveLength(2);
    expect(catalog[1]).toMatchObject({
      name: 'Globo',
      type: 'tv',
      tvgId: 'Globo',
      country: 'BR',
      language: 'pt',
      poster: 'https://cdn.mitvstatic.com/channels/br_rede-globo_m.png',
    });
  });

  it('returns channel programs from listings HTML', async () => {
    vi.mocked(makeRequest).mockImplementation(async (url: string) => {
      if (url.includes('/sitemap')) {
        return {
          ok: true,
          text: async () => SITEMAP_HTML,
        } as never;
      }
      return {
        ok: true,
        text: async () => LISTINGS_HTML,
      } as never;
    });

    const addon = new MiTvAddon({ timeout: 1000, country: 'br' });
    const catalog = await addon.getCatalog();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-11T20:00:00.000Z'));
    const meta = await addon.getMeta(catalog[1]!.id);
    vi.useRealTimers();

    expect(meta.name).toBe('Globo');
    expect(meta.videos?.[0]).toMatchObject({
      title: 'Jornal Nacional',
      overview: 'As notícias do dia.',
    });
    expect(meta.videos?.[1]).toMatchObject({
      title: 'Novela',
      season: 2,
      episode: 14,
    });
  });
});
