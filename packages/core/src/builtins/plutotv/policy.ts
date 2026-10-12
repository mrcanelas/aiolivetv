import { config as appConfig } from '../../config/index.js';

export type PlutoTvInstancePolicy = {
  enabled: boolean;
  disabledReason?: string;
};

export function getPlutoTvInstancePolicy(): PlutoTvInstancePolicy {
  const section = appConfig.builtins.plutotv;
  return {
    enabled: section.enabled,
    disabledReason: section.enabled
      ? undefined
      : section.disabledReason.trim() ||
        'Disabled by this instance administrator',
  };
}

export class PlutoTvPolicyError extends Error {
  readonly code = 'disabled' as const;

  constructor(message: string) {
    super(message);
    this.name = 'PlutoTvPolicyError';
  }
}

export function assertPlutoTvEnabled(): void {
  const policy = getPlutoTvInstancePolicy();
  if (!policy.enabled) {
    throw new PlutoTvPolicyError(
      policy.disabledReason || 'Disabled by this instance administrator'
    );
  }
}

export function formatPlutoTvDisabledReason(reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed) {
    return 'Disabled by this instance administrator';
  }
  if (
    trimmed.toLowerCase().startsWith('disabled by this instance administrator')
  ) {
    return trimmed;
  }
  return `Disabled by this instance administrator. ${trimmed}`;
}
