import { describe, expect, it, vi } from 'vitest';
import type { UserData } from '@aiolivetv/core';
vi.mock('@/context/status', () => ({ useStatus: vi.fn() }));
import {
  appendDiscoveredXmltvPresets,
  applyMigrations,
  DefaultUserData,
} from '../userData';

it('starts with Live TV defaults and does not restore legacy fields when importing into a draft', () => {
  expect(Object.keys(DefaultUserData).sort()).toEqual([
    'formatter',
    'preferredResolutions',
    'presets',
    'sortCriteria',
  ]);
  const oldDraft = {
    ...DefaultUserData,
    enableSeadex: true,
    services: [],
    excludedQualities: ['CAM'],
  };
  const imported = applyMigrations({
    ...DefaultUserData,
    channelMappings: [{ id: 'disabled', enabled: false }],
  });
  const draft = applyMigrations({ ...oldDraft, ...imported });
  expect(draft).not.toHaveProperty('enableSeadex');
  expect(draft).not.toHaveProperty('services');
  expect(draft).not.toHaveProperty('excludedQualities');
  expect(draft.channelMappings).toEqual([{ id: 'disabled', enabled: false }]);
  expect(applyMigrations(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
});

describe('discovered XMLTV presets', () => {
  it('adds selected guides to a new draft without duplicating or enabling an existing guide', () => {
    const presets: UserData['presets'] = [
      {
        type: 'xmltv',
        instanceId: 'old',
        enabled: false,
        options: { sourceUrl: 'https://example.com:443/guide.xml' },
      },
    ];
    const result = appendDiscoveredXmltvPresets(
      presets,
      [
        'https://example.com/guide.xml',
        'https://example.com/new.xml',
        'https://example.com/new.xml',
        'file:///etc/passwd',
        'broken',
      ],
      5000
    );
    expect(presets).toHaveLength(1);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(presets[0]);
    expect(result[0].enabled).toBe(false);
    expect(result[1]).toMatchObject({
      type: 'xmltv',
      enabled: true,
      options: {
        sourceUrl: 'https://example.com/new.xml',
        timeout: 5000,
        resources: ['catalog', 'meta'],
      },
    });
    expect(result[1].instanceId).not.toBe(result[0].instanceId);
  });
});
