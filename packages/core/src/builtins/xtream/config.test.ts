import { describe, expect, it } from 'vitest';
import { XtreamConfigSchema } from './config.js';

const config = { username: 'user', password: 'secret', timeout: 7000 };

describe('Xtream server URL validation', () => {
  it.each([
    'http://example.com:8080',
    'https://example.com',
    'example.com:8080',
    ' localhost:8080 ',
  ])('accepts supported server addresses: %s', (url) => {
    expect(XtreamConfigSchema.parse({ ...config, url }).url).toBe(url.trim());
  });

  it.each([
    'http://user:secret@example.com',
    'https://user@example.com',
    'user:secret@example.com:8080',
  ])('rejects credentials before any request: %s', (url) => {
    const result = XtreamConfigSchema.safeParse({ ...config, url });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['url'],
          message: expect.stringContaining('Username and Password fields'),
        })
      );
      expect(result.error.message).not.toContain('secret');
    }
  });

  it.each([
    'ftp://example.com',
    'file:///tmp/server',
    'http://',
    'example.com:badport',
    ' ',
  ])('rejects unsupported or malformed addresses: %s', (url) => {
    expect(XtreamConfigSchema.safeParse({ ...config, url }).success).toBe(
      false
    );
  });
});
