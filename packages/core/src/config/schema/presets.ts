import {
  applyNullableUserAgentTemplate,
  nullableUserAgentString,
  optionalPositiveInt,
  positiveInt,
  urlOrUrlList,
} from './helpers.js';
import type { RuntimeConfigField, RuntimeConfigSection } from '../types.js';

interface PresetFieldOptions {
  label: string;
  default: string | string[] | null;
  envBase: string;
  description?: string;
}

function urlField({
  label,
  default: def,
  envBase,
  description,
}: PresetFieldOptions): RuntimeConfigField<string[]> {
  const coerced: string[] = Array.isArray(def) ? def : def ? [def] : [];
  return {
    schema: urlOrUrlList,
    default: coerced,
    label: `${label} URL(s)`,
    description: description ?? `Upstream URL(s) for the ${label} addon.`,
    env: envBase,
    requiresRestart: false,
    secret: false,
    ui: { kind: 'list' },
  };
}

function timeoutField(
  label: string,
  env: string
): RuntimeConfigField<number | null> {
  return {
    schema: optionalPositiveInt,
    default: null,
    label: `Default ${label} timeout (ms)`,
    description: `Default timeout for the ${label} addon (milliseconds). Falls back to the global default when unset.`,
    env,
    requiresRestart: false,
    secret: false,
  };
}

function userAgentField(
  label: string,
  env: string
): RuntimeConfigField<string | null> {
  return {
    schema: nullableUserAgentString,
    transform: applyNullableUserAgentTemplate,
    default: null,
    label: `Default ${label} user agent`,
    description: `Default User-Agent for the ${label} addon. Supports \`{version}\`/\`{random}\` placeholders.`,
    env,
    requiresRestart: false,
    secret: false,
  };
}

type BasicPresetShape = {
  url: RuntimeConfigField<string[]>;
  defaultTimeout: RuntimeConfigField<number | null>;
  defaultUserAgent: RuntimeConfigField<string | null>;
};

function basicPreset(opts: {
  label: string;
  default: string | string[] | null;
  envBase: string;
  timeoutEnv: string;
  userAgentEnv: string;
}): BasicPresetShape {
  return {
    url: urlField({
      label: opts.label,
      default: opts.default,
      envBase: opts.envBase,
    }),
    defaultTimeout: timeoutField(opts.label, opts.timeoutEnv),
    defaultUserAgent: userAgentField(opts.label, opts.userAgentEnv),
  };
}

export const presetsSchema = {
  defaultTimeout: {
    schema: positiveInt,
    default: 7000,
    label: 'Default preset timeout (ms)',
    description:
      'Fallback timeout for preset stream fetching when a preset does not set its own (milliseconds).',
    env: 'DEFAULT_TIMEOUT',
    requiresRestart: false,
    secret: false,
  },
  debridioTv: basicPreset({
    label: 'Debridio TV',
    default: ['https://tv.lb.debridio.com'],
    envBase: 'DEBRIDIO_TV_URL',
    timeoutEnv: 'DEFAULT_DEBRIDIO_TV_TIMEOUT',
    userAgentEnv: 'DEFAULT_DEBRIDIO_TV_USER_AGENT',
  }),
  usaTv: basicPreset({
    label: 'USA TV',
    default: ['https://848b3516657c-usatv.baby-beamup.club'],
    envBase: 'USA_TV_URL',
    timeoutEnv: 'DEFAULT_USA_TV_TIMEOUT',
    userAgentEnv: 'DEFAULT_USA_TV_USER_AGENT',
  }),
  argentinaTv: basicPreset({
    label: 'Argentina TV',
    default: ['https://848b3516657c-argentinatv.baby-beamup.club'],
    envBase: 'ARGENTINA_TV_URL',
    timeoutEnv: 'DEFAULT_ARGENTINA_TV_TIMEOUT',
    userAgentEnv: 'DEFAULT_ARGENTINA_TV_USER_AGENT',
  }),
  frostView: basicPreset({
    label: 'FrostView TV',
    default: ['https://frostview.cloutteam.com'],
    envBase: 'FROSTVIEW_URL',
    timeoutEnv: 'DEFAULT_FROSTVIEW_TIMEOUT',
    userAgentEnv: 'DEFAULT_FROSTVIEW_USER_AGENT',
  }),
  minhaTv: basicPreset({
    label: 'Minha TV',
    default: ['https://da5f663b4690-minhatv.baby-beamup.club'],
    envBase: 'MINHA_TV_URL',
    timeoutEnv: 'DEFAULT_MINHA_TV_TIMEOUT',
    userAgentEnv: 'DEFAULT_MINHA_TV_USER_AGENT',
  }),
} as const satisfies RuntimeConfigSection;
