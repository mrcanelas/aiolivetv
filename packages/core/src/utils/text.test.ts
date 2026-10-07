import { describe, expect, it } from 'vitest';
import { decodeHtmlEntities } from './text.js';

describe('decodeHtmlEntities', () => {
  it('decodes named, decimal and hexadecimal entities', () => {
    expect(decodeHtmlEntities('A&amp;E &#65; &#x1F4FA; &#X41;')).toBe(
      'A&E A \u{1F4FA} A'
    );
  });

  it.each([
    '&#1114112;',
    '&#999999999;',
    '&#x110000;',
    '&#55296;',
    '&unknown;',
  ])('preserves invalid or unknown entity %s', (entity) => {
    expect(decodeHtmlEntities(`News ${entity}`)).toBe(`News ${entity}`);
  });
});
