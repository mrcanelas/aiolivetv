import { describe, expect, it } from 'vitest';
import type { UserData } from '@aiolivetv/core';
import { applyScenario, buildPreviewStream, tabHasUsedField } from '../state';
import { getTemplates } from '../../templates';
import { BUILTIN_FORMATTER_DEFINITIONS } from '../../../../../../../core/src/utils/formatter-definitions';

describe('formatter preview', () => {
  it('calculates programme progress from the EPG scenario using the delivery helper', () => {
    const now = Date.parse('2026-10-07T10:30:00Z');
    const input = applyScenario('epg-m3u', now);
    expect(buildPreviewStream(input, now).live).toMatchObject({
      programTitle: 'Evening News',
      programProgress: 50,
      isCurrentProgram: true,
    });
    expect(
      buildPreviewStream(input, now + 60 * 60_000).live?.isCurrentProgram
    ).toBeUndefined();
    expect(
      buildPreviewStream(applyScenario('bare'), now).live?.programTitle
    ).toBeUndefined();
  });

  it('keeps programme and source fields visible when referenced by templates', () => {
    expect(tabHasUsedField('channel', new Set(['live.programTitle']))).toBe(
      true
    );
    expect(tabHasUsedField('source', new Set(['live.sourceChannelId']))).toBe(
      true
    );
  });

  it('shares preset definitions without replacing custom, saved or overridden templates', () => {
    for (const [id, definition] of Object.entries(
      BUILTIN_FORMATTER_DEFINITIONS
    )) {
      expect(getTemplates({ formatter: { id: id as UserData['formatter']['id'] } })).toEqual(
        definition
      );
    }
    const custom = {
      name: 'Custom channel',
      description: 'User-defined layout',
    };
    expect(
      getTemplates({
        formatter: { id: 'custom', definitions: { custom } },
      })
    ).toEqual(custom);
    expect(
      getTemplates({
        formatter: {
          id: 'custom',
          selectedSaved: 'Saved',
          definitions: { saved: { Saved: custom } },
        },
      })
    ).toEqual(custom);
    expect(
      getTemplates({
        formatter: {
          id: 'gdrive',
          definitions: { overrides: { gdrive: custom } },
        },
      })
    ).toEqual(custom);
  });
});
