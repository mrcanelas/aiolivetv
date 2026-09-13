import * as constants from '../../../../../../../core/src/utils/constants';
import type { PreviewInput } from '../state';
import { declaredSummary } from '../state';
import { FieldGrid, FieldNote, ListField, SelectField, TextField } from '../fields';

const LANGUAGE_FIELDS = [
  'stream.languages',
  'stream.uLanguages',
  'stream.languageEmojis',
  'stream.languageCodes',
  'stream.uLanguageCodes',
  'stream.smallLanguageCodes',
  'stream.uSmallLanguageCodes',
] as const;

const FROM_LABEL = '__from_label__';

export function ParsedTab({
  input,
  patch,
}: {
  input: PreviewInput;
  patch: (partial: Partial<PreviewInput>) => void;
}) {
  const summary = declaredSummary(input);
  return (
    <div className="space-y-4">
      <TextField
        field="stream.filename"
        label="Stream label"
        value={input.streamName}
        onChange={(streamName) => patch({ streamName })}
        placeholder="AXN H265 FHD LEG"
        always
        help="Parsed the same way live stream names are in the pipeline."
      />
      {summary ? (
        <FieldNote>Declared metadata: {summary}</FieldNote>
      ) : (
        <FieldNote>
          Empty overrides keep whatever the stream label parsed. Fill a field to
          force it.
        </FieldNote>
      )}
      <FieldGrid>
        <SelectField
          field="stream.resolution"
          label="Resolution"
          value={input.resolution || FROM_LABEL}
          onChange={(resolution) =>
            patch({ resolution: resolution === FROM_LABEL ? '' : resolution })
          }
          options={[
            { label: 'From label', value: FROM_LABEL },
            ...constants.RESOLUTIONS.map((resolution) => ({
              label: resolution,
              value: resolution,
            })),
          ]}
        />
        <SelectField
          field="stream.encode"
          label="Encode"
          value={input.encode || FROM_LABEL}
          onChange={(encode) =>
            patch({ encode: encode === FROM_LABEL ? '' : encode })
          }
          options={[
            { label: 'From label', value: FROM_LABEL },
            ...constants.ENCODES.map((encode) => ({
              label: encode,
              value: encode,
            })),
          ]}
        />
        <ListField
          field={LANGUAGE_FIELDS}
          label="Languages"
          value={input.languages}
          onChange={(languages) => patch({ languages })}
          placeholder="Portuguese, English"
        />
        <ListField
          field="stream.visualTags"
          label="Visual tags"
          value={input.visualTags}
          onChange={(visualTags) => patch({ visualTags })}
          placeholder="HDR, DV"
        />
        <ListField
          field="stream.audioTags"
          label="Audio tags"
          value={input.audioTags}
          onChange={(audioTags) => patch({ audioTags })}
          placeholder="DTS, Atmos"
        />
        <ListField
          field="stream.audioChannels"
          label="Audio channels"
          value={input.audioChannels}
          onChange={(audioChannels) => patch({ audioChannels })}
          placeholder="5.1, 2.0"
        />
        <ListField
          field="stream.subtitles"
          label="Subtitles"
          value={input.subtitles}
          onChange={(subtitles) => patch({ subtitles })}
          placeholder="Portuguese"
        />
      </FieldGrid>
    </div>
  );
}
