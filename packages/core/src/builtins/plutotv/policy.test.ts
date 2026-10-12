import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
  enabled: true,
  disabledReason: 'Desabilitado pelo administrador desta instância',
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
    state.disabledReason = 'Desabilitado pelo administrador desta instância';
  });

  it('formats admin disable reasons in Portuguese', () => {
    expect(formatPlutoTvDisabledReason('LAN only')).toBe(
      'Desabilitado pelo administrador desta instância. LAN only'
    );
  });

  it('disables the provider from builtins config', () => {
    state.enabled = false;
    expect(getPlutoTvInstancePolicy().enabled).toBe(false);
    expect(() => assertPlutoTvEnabled()).toThrow(PlutoTvPolicyError);
  });
});
