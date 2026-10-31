import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, fetchTmdbLanguages } from '../api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('dashboard API caching', () => {
  it('uses fresh URLs for dashboard reads and preserves query parameters', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () =>
        Response.json({ success: true, data: { keys: [] } })
      );
    vi.stubGlobal('fetch', fetchMock);
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValueOnce(1000).mockReturnValueOnce(2000);

    await api('/dashboard/settings');
    await api('/dashboard/logs?limit=10');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/dashboard/settings?_=1000',
      expect.objectContaining({ cache: 'no-store', credentials: 'include' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/dashboard/logs?limit=10&_=2000',
      expect.objectContaining({ cache: 'no-store' })
    );
  });

  it('preserves mutation URLs and other API caching options', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () =>
        Response.json({ success: true, data: {} })
      );
    vi.stubGlobal('fetch', fetchMock);

    await api('PATCH /dashboard/settings', { body: { key: 'value' } });
    await api('/status', { cache: 'force-cache' });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/dashboard/settings',
      expect.objectContaining({ method: 'PATCH', body: '{"key":"value"}' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/status',
      expect.objectContaining({ cache: 'force-cache' })
    );
  });
});

describe('TMDB language response validation', () => {
  it('accepts names returned by the API without caching the HTTP response', async () => {
    const languages = [
      { code: 'aa', name: 'Afar' },
      { code: 'pt-BR', name: 'Portuguese (Brazil)' },
    ];
    const request = vi
      .fn()
      .mockResolvedValue(Response.json({ success: true, data: { languages } }));
    vi.stubGlobal('fetch', request);
    expect(await fetchTmdbLanguages({})).toEqual(languages);
    expect(request).toHaveBeenCalledWith(
      '/api/v1/catalogs/tmdb/languages',
      expect.objectContaining({ method: 'POST', cache: 'no-store', body: '{}' })
    );
  });

  it.each([
    ['aa', 'ab'],
    [{ code: 'aa' }],
    [{ name: 'Afar' }],
    [{ code: 'aa', name: '' }],
    [],
  ])(
    'rejects malformed options instead of displaying undefined: %j',
    async (...languages) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            Response.json({ success: true, data: { languages } })
          )
      );
      await expect(fetchTmdbLanguages({})).rejects.toThrow();
    }
  );
});
