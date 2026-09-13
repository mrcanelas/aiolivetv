import type { PreviewInput } from '../state';
import {
  AdvancedFields,
  FieldGrid,
  ListField,
  NumberField,
  TextField,
} from '../fields';

const ADVANCED = ['stream.rankedRegexMatched', 'stream.rseMatched'];

export function ScoringTab({
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
          field="stream.regexMatched"
          label="Regex matched"
          value={input.regexMatched}
          onChange={(regexMatched) => patch({ regexMatched })}
          placeholder="e.g. 1080p"
        />
        <NumberField
          field="stream.regexScore"
          label="Regex score"
          value={input.regexScore}
          onChange={(regexScore) => patch({ regexScore })}
          min={-1_000_000}
          max={1_000_000}
          step={5}
        />
        <NumberField
          field="stream.nRegexScore"
          label="Max regex score"
          value={input.maxRegexScore}
          onChange={(maxRegexScore) => patch({ maxRegexScore })}
          min={1}
          step={10}
        />
        <TextField
          field="stream.seMatched"
          label="Expression matched"
          value={input.seMatched}
          onChange={(seMatched) => patch({ seMatched })}
          placeholder="e.g. high-quality"
        />
        <NumberField
          field="stream.seScore"
          label="Expression score"
          value={input.seScore}
          onChange={(seScore) => patch({ seScore })}
          min={-1_000_000}
          max={1_000_000}
          step={10}
        />
        <NumberField
          field="stream.nSeScore"
          label="Max expression score"
          value={input.maxSeScore}
          onChange={(maxSeScore) => patch({ maxSeScore })}
          min={1}
          step={25}
        />
      </FieldGrid>

      <AdvancedFields fields={ADVANCED}>
        <FieldGrid>
          <ListField
            field="stream.rankedRegexMatched"
            label="Ranked regexes"
            value={input.rankedRegexMatched}
            onChange={(rankedRegexMatched) => patch({ rankedRegexMatched })}
            placeholder="1080p, HDR"
          />
          <ListField
            field="stream.rseMatched"
            label="Ranked expressions"
            value={input.rseMatched}
            onChange={(rseMatched) => patch({ rseMatched })}
            placeholder="high-quality, best-match"
          />
        </FieldGrid>
      </AdvancedFields>
    </div>
  );
}
