import { describe, expect, it } from 'vitest';
import { validateTemplate } from '../formatters/engine/parser.js';
import { compileTemplate } from '../formatters/engine/compile.js';
import { comparatorFunctions } from '../formatters/engine/comparators.js';
import { BUILTIN_FORMATTER_DEFINITIONS } from './formatter-definitions.js';

const ERROR_CATEGORIES = new Set([
  'unterminated',
  'unterminated-group',
  'unparseable',
  'unknown-field',
]);

function compile(template: string) {
  return compileTemplate<{
    live?: { channelName?: string | null; deliveryFormatLabel?: string | null };
    stream?: { resolution?: string | null };
    addon?: { name?: string | null };
  }>(template, {
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

describe('live TV formatter builtins', () => {
  for (const [id, definition] of Object.entries(BUILTIN_FORMATTER_DEFINITIONS)) {
    it(`${id} name and description parse without unknown live fields`, () => {
      for (const template of [definition.name, definition.description]) {
        const errors = validateTemplate(template).filter((diagnostic) =>
          ERROR_CATEGORIES.has(diagnostic.category)
        );
        expect(errors, JSON.stringify(errors, null, 2)).toEqual([]);
      }
    });
  }

  it('Detailed and Tamtaro render live.channelName without seeders', () => {
    const value = {
      live: { channelName: 'AXN', deliveryFormatLabel: 'HLS' },
      stream: { resolution: '1080p' },
      addon: { name: 'M3U Brasil' },
    };
    expect(compile(BUILTIN_FORMATTER_DEFINITIONS.gdrive.name)(value)).toContain(
      'AXN'
    );
    expect(
      compile(BUILTIN_FORMATTER_DEFINITIONS.tamtaro.name)(value)
    ).toContain('AXN');
  });
});
