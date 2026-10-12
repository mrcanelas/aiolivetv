import { describe, expect, it, vi, beforeEach } from 'vitest';

const state = {
  enabled: true,
  disabledReason: 'Custom reason',
  proxyEnabled: false,
  allowPrivateUrls: false,
  disabledAddons: {} as Record<string, string>,
};

vi.mock('../../config/index.js', () => ({
  config: {
    bootstrap: {
      get allowPrivateUrls() {
        return state.allowPrivateUrls;
      },
    },
    builtins: {
      tvheadend: {
        get enabled() {
          return state.enabled;
        },
        get disabledReason() {
          return state.disabledReason;
        },
        get proxyEnabled() {
          return state.proxyEnabled;
        },
      },
    },
    userLimits: {
      disabled: {
        get addons() {
          return state.disabledAddons;
        },
        removedAddons: {},
        hosts: {},
        services: {},
        streamTypes: [],
      },
    },
  },
}));

const {
  assertTvheadendEnabled,
  assertTvheadendProxyAllowed,
  assertTvheadendUrlAllowed,
  formatTvheadendDisabledReason,
  getTvheadendInstancePolicy,
  TvheadendPolicyError,
} = await import('./policy.js');

describe('TVHeadend instance policy', () => {
  beforeEach(() => {
    state.enabled = true;
    state.disabledReason = 'Custom reason';
    state.proxyEnabled = false;
    state.allowPrivateUrls = false;
    state.disabledAddons = {};
  });

  it('formats admin disable reasons in English', () => {
    expect(formatTvheadendDisabledReason('LAN only')).toBe(
      'Disabled by this instance administrator. LAN only'
    );
    expect(
      formatTvheadendDisabledReason(
        'Disabled by this instance administrator'
      )
    ).toBe('Disabled by this instance administrator');
  });

  it('disables the provider from builtins config', () => {
    state.enabled = false;
    const policy = getTvheadendInstancePolicy();
    expect(policy.enabled).toBe(false);
    expect(() => assertTvheadendEnabled()).toThrow(TvheadendPolicyError);
  });

  it('blocks proxy when not enabled by admin', () => {
    expect(() => assertTvheadendProxyAllowed()).toThrow(/proxy/i);
    state.proxyEnabled = true;
    expect(() => assertTvheadendProxyAllowed()).not.toThrow();
  });

  it('allows private URLs only when HTTP_ALLOW_PRIVATE_URLS is on', async () => {
    await expect(
      assertTvheadendUrlAllowed('http://192.168.1.50:9981')
    ).rejects.toBeInstanceOf(TvheadendPolicyError);

    state.allowPrivateUrls = true;
    await expect(
      assertTvheadendUrlAllowed('http://192.168.1.50:9981')
    ).resolves.toBeInstanceOf(URL);
  });
});
