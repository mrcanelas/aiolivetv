import type { PreviewInput } from '../state';
import {
  AdvancedFields,
  FieldGrid,
  NumberField,
  SelectField,
  SwitchField,
  SwitchRow,
  TextField,
} from '../fields';

const PROVIDER_TYPES: PreviewInput['providerType'][] = [
  'm3u',
  'xtream',
  'xmltv',
  'vivo',
  'claro',
  'mitv',
  'addon',
  'manual',
];

const MATCH_STATUSES: PreviewInput['matchStatus'][] = [
  'canonical',
  'auto',
  'suggested',
  'manual',
  'fallback',
];

const ADVANCED = ['live.priority', 'addon.presetId', 'addon.manifestUrl'];

export function SourceTab({
  input,
  patch,
}: {
  input: PreviewInput;
  patch: (partial: Partial<PreviewInput>) => void;
}) {
  return (
    <div className="space-y-4">
      <FieldGrid>
        <TextField
          field="live.providerName"
          label="Provider"
          value={input.providerName}
          onChange={(providerName) => patch({ providerName })}
        />
        <SelectField
          field="live.providerType"
          label="Provider type"
          value={input.providerType}
          onChange={(providerType) =>
            patch({ providerType: providerType as PreviewInput['providerType'] })
          }
          options={PROVIDER_TYPES.map((type) => ({
            label: type,
            value: type,
          }))}
        />
        <TextField
          field="addon.name"
          label="Addon name"
          value={input.addonName}
          onChange={(addonName) => patch({ addonName })}
        />
        <SelectField
          field="live.matchStatus"
          label="Match status"
          value={input.matchStatus}
          onChange={(matchStatus) =>
            patch({ matchStatus: matchStatus as PreviewInput['matchStatus'] })
          }
          options={MATCH_STATUSES.map((status) => ({
            label: status,
            value: status,
          }))}
        />
        <NumberField
          field="live.matchConfidence"
          label="Match confidence"
          value={input.matchConfidence}
          onChange={(matchConfidence) => patch({ matchConfidence })}
          min={0}
          max={1}
          step={0.05}
        />
      </FieldGrid>

      <SwitchRow>
        <SwitchField
          field="live.epgProvider"
          label="EPG provider"
          value={input.epgProvider}
          onChange={(epgProvider) => patch({ epgProvider })}
        />
        <SwitchField
          field="live.hasSchedule"
          label="Has schedule"
          value={input.hasSchedule}
          onChange={(hasSchedule) => patch({ hasSchedule })}
        />
      </SwitchRow>

      <AdvancedFields fields={ADVANCED}>
        <FieldGrid>
          <NumberField
            field="live.priority"
            label="Priority"
            value={input.priority}
            onChange={(priority) => patch({ priority })}
            min={0}
            step={1}
          />
          <TextField
            field="addon.presetId"
            label="Preset id"
            value={input.presetId}
            onChange={(presetId) => patch({ presetId })}
          />
          <TextField
            field="addon.manifestUrl"
            label="Manifest URL"
            value={input.manifestUrl}
            onChange={(manifestUrl) => patch({ manifestUrl })}
          />
        </FieldGrid>
      </AdvancedFields>
    </div>
  );
}
