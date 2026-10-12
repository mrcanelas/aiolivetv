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
        'Desabilitado pelo administrador desta instância',
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
      policy.disabledReason ||
        'Desabilitado pelo administrador desta instância'
    );
  }
}

export function formatPlutoTvDisabledReason(reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed) {
    return 'Desabilitado pelo administrador desta instância';
  }
  if (
    trimmed
      .toLowerCase()
      .startsWith('desabilitado pelo administrador desta instância')
  ) {
    return trimmed;
  }
  return `Desabilitado pelo administrador desta instância. ${trimmed}`;
}
