import type { PreviewInput } from '../state';
import { AdvancedFields, FieldGrid, TextField } from '../fields';

const ADVANCED = ['live.channelId', 'live.canonicalName', 'live.logo'];

export function ChannelTab({
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
          field="live.channelName"
          label="Channel name"
          value={input.channelName}
          onChange={(channelName) => patch({ channelName })}
          placeholder="AXN"
        />
        <TextField
          field="live.tvgId"
          label="tvg-id"
          value={input.tvgId}
          onChange={(tvgId) => patch({ tvgId })}
          placeholder="AXN.br"
        />
        <TextField
          field="live.group"
          label="Group"
          value={input.group}
          onChange={(group) => patch({ group })}
          placeholder="Filmes e Séries"
        />
        <TextField
          field="live.country"
          label="Country"
          value={input.country}
          onChange={(country) => patch({ country })}
          placeholder="BR"
        />
        <TextField
          field="live.language"
          label="Language"
          value={input.language}
          onChange={(language) => patch({ language })}
          placeholder="Portuguese (Brazil)"
        />
      </FieldGrid>
      <AdvancedFields fields={ADVANCED}>
        <FieldGrid>
          <TextField
            field="live.channelId"
            label="Channel id"
            value={input.channelId}
            onChange={(channelId) => patch({ channelId })}
          />
          <TextField
            field="live.canonicalName"
            label="Canonical name"
            value={input.canonicalName}
            onChange={(canonicalName) => patch({ canonicalName })}
          />
          <TextField
            field="live.logo"
            label="Logo URL"
            value={input.logo}
            onChange={(logo) => patch({ logo })}
          />
        </FieldGrid>
      </AdvancedFields>
    </div>
  );
}
