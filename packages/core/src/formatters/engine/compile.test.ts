import { describe, expect, it } from 'vitest';
import { compileTemplate } from './compile.js';
import { comparatorFunctions } from './comparators.js';

type ParseValue = {
  stream?: { resolution?: string | null; type?: string | null };
  addon?: { name?: string | null };
};

function compile(template: string) {
  return compileTemplate<ParseValue>(template, {
    resolveVariable: (source, parseValue) => {
      const [section, property] = source.split('.');
      const value = (parseValue as Record<string, Record<string, unknown>>)?.[
        section
      ]?.[property];
      return value == null ? undefined : String(value);
    },
    comparators: comparatorFunctions,
  });
}

describe('formatter engine', () => {
  it('keeps the previous exists/conditional syntax', () => {
    const render = compile(
      '{addon.name} {stream.resolution::exists["{stream.resolution}"||"Unknown"]}'
    );
    expect(
      render({
        addon: { name: 'Vivo TV' },
        stream: { resolution: '1080p' },
      })
    ).toBe('Vivo TV 1080p');
    expect(
      render({
        addon: { name: 'Vivo TV' },
        stream: { resolution: null },
      })
    ).toBe('Vivo TV Unknown');
  });

  it('drops optional groups when a field is missing', () => {
    const render = compile('{addon.name}{? · {stream.resolution} ?}');
    expect(
      render({
        addon: { name: 'Claro TV' },
        stream: { resolution: '720p' },
      })
    ).toBe('Claro TV · 720p ');
    expect(
      render({
        addon: { name: 'Claro TV' },
        stream: { resolution: null },
      })
    ).toBe('Claro TV');
  });

  it('uses default when a live stream field is absent', () => {
    const render = compile("{stream.resolution::default('SD')}");
    expect(render({ stream: { resolution: null } })).toBe('SD');
    expect(render({ stream: { resolution: '4K' } })).toBe('4K');
  });
});
