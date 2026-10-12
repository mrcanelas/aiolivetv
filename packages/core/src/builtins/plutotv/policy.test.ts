import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
  enabled: true,
  disabledReason: 'Disabled by this instance administrator',
};

vi.mock('../../config/index.js', () => ({
  config: {
    builtins: {
      plutotv: {
        get enabled() {
          return state.enabled;
        },
        get disabledReason() {
          return state.disabledReason;
        },
      },
    },
  },
}));

const {
  assertPlutoTvEnabled,
  formatPlutoTvDisabledReason,
  getPlutoTvInstancePolicy,
  PlutoTvPolicyError,
} = await import('./policy.js');

describe('Pluto TV instance policy', () => {
  beforeEach(() => {
    state.enabled = true;
    state.disabledReason = 'Disabled by this instance administrator';
  });

  it('formats admin disable reasons in English', () => {
    expect(formatPlutoTvDisabledReason('LAN only')).toBe(
      'Disabled by this instance administrator. LAN only'
    );
  });

  it('disables the provider from builtins config', () => {
    state.enabled = false;
    expect(getPlutoTvInstancePolicy().enabled).toBe(false);
    expect(() => assertPlutoTvEnabled()).toThrow(PlutoTvPolicyError);
  });
});
