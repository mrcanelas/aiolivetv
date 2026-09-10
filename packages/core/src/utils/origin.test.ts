import { describe, expect, it } from 'vitest';
import { sameOrigin } from './origin.js';

describe('sameOrigin', () => {
  it('treats implicit port 80 as the same origin as http://localhost:80', () => {
    const serialised = new URL(
      'http://localhost:80/builtins/live-tv/vivo-tv/cfg/manifest.json'
    ).toString();
    expect(serialised.startsWith('http://localhost:80')).toBe(false);
    expect(sameOrigin(serialised, 'http://localhost:80')).toBe(true);
  });

  it('matches https default port 443', () => {
    expect(
      sameOrigin('https://example.com/builtins/x', 'https://example.com:443')
    ).toBe(true);
  });

  it('does not match a different host or port', () => {
    expect(sameOrigin('http://localhost:3000/a', 'http://localhost:80')).toBe(
      false
    );
    expect(sameOrigin('http://127.0.0.1:80/a', 'http://localhost:80')).toBe(
      false
    );
  });
});
