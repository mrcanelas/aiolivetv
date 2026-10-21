import { describe, expect, it, vi } from 'vitest';
import type { UserData } from '@aiolivetv/core';
vi.mock('@/context/status', () => ({ useStatus: vi.fn() }));
import { appendDiscoveredXmltvPresets } from '../userData';

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
