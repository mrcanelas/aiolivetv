// Vitest workers inherit vite's injected `BASE_URL=/`; env.ts validates env at
// import time, so define test-safe values before pulling in ExtrasParser.
process.env.BASE_URL = process.env.BASE_URL?.startsWith('http')
  ? process.env.BASE_URL
  : 'http://localhost:3000';
process.env.SECRET_KEY = process.env.SECRET_KEY ?? '0'.repeat(64);
process.env.DATABASE_URI = process.env.DATABASE_URI ?? 'sqlite://:memory:';

import { describe, expect, it } from 'vitest';

const { ExtrasParser } = await import('./extras.js');

describe('ExtrasParser', () => {
  it.each(['News & Sports', 'a=b=c', 'C++', '%26', 'News/Sports'])(
    'preserves %s through parsing and repeated serialization',
    (value) => {
      const first = new ExtrasParser(
        `genre=${encodeURIComponent(value)}&search=${encodeURIComponent(value)}&skip=25`
      );
      const second = new ExtrasParser(first.toString());
      for (const parser of [first, second]) {
        expect(parser.genre).toBe(value);
        expect(parser.search).toBe(value);
        expect(parser.skip).toBe(25);
      }
    }
  );

  it('keeps equals signs after the first parameter separator', () => {
    expect(new ExtrasParser('search=a=b=c').search).toBe('a=b=c');
  });
  it('decodes percent-encoded genre values once, yielding the plain string', () => {
    const parser = new ExtrasParser(
      'genre=' + encodeURIComponent('US: Sports')
    );
    expect(parser.genre).toBe('US: Sports');
  });

  it('treats + as a space for form-encoded genre options', () => {
    expect(new ExtrasParser('genre=US:+Sports').genre).toBe('US: Sports');
  });

  it('leaves single-word genres untouched', () => {
    expect(new ExtrasParser('genre=Events').genre).toBe('Events');
  });

  it('is lossless across repeated toString -> parse cycles', () => {
    const first = new ExtrasParser(
      'genre=US%3A%20Sports&skip=0&date=2026-10-10'
    );
    const second = new ExtrasParser(first.toString());
    const third = new ExtrasParser(second.toString());

    for (const parsed of [second, third]) {
      expect(parsed.genre).toBe('US: Sports');
      expect(parsed.date).toBe('2026-10-10');
    }
    expect(second.skip).toBe(0);
  });

  it('encodes values when serializing so they survive URL transport', () => {
    const parser = new ExtrasParser('genre=US%3A%20Sports');
    expect(parser.toString()).toBe('genre=US%3A%20Sports');
  });

  it('handles missing and malformed values without throwing', () => {
    expect(new ExtrasParser('genre').genre).toBeUndefined();
    expect(new ExtrasParser('genre=%ZZ').genre).toBe('%ZZ');
    expect(new ExtrasParser(undefined).toString()).toBe('');
  });
});
