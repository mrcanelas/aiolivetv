import type { PreviewInput } from '../state';
import { inferredDeliveryLabel } from '../state';
import { sanitiseStreamUrl } from '../../../../../../../core/src/streams/url-format';
import {
  AdvancedFields,
  FieldGrid,
  FieldNote,
  SelectField,
  SwitchField,
  SwitchRow,
  TextField,
} from '../fields';

const STREAM_TYPES: PreviewInput['type'][] = ['live', 'http'];

const ADVANCED = [
  'live.protocol',
  'live.extension',
  'live.adaptive',
  'live.isHls',
  'live.isMpegTs',
  'live.isDash',
  'stream.message',
];

export function StreamTab({
  input,
  patch,
}: {
  input: PreviewInput;
  patch: (partial: Partial<PreviewInput>) => void;
}) {
  const delivery = inferredDeliveryLabel(input);
  const urlSafe = sanitiseStreamUrl(input.streamUrl);
  return (
    <div className="space-y-4">
      <FieldGrid>
        <TextField
          field="live.streamUrl"
          label="Stream URL"
          value={input.streamUrl}
          onChange={(streamUrl) => patch({ streamUrl })}
          placeholder="https://example.com/live.m3u8"
          always
          help="Preview input only. Prefer live.streamUrlSafe or live.streamHost in templates — live.streamUrl can leak tokens."
        />
        <TextField
          field="live.streamUrlSafe"
          label="Safe URL"
          value={urlSafe.streamUrlSafe ?? ''}
          onChange={() => undefined}
          disabled
          help="Host and redacted path for templates. Does not include credentials or query tokens."
        />
        <SelectField
          field="stream.type"
          label="Type"
          value={input.type}
          onChange={(type) => patch({ type: type as PreviewInput['type'] })}
          options={STREAM_TYPES.map((type) => ({
            label: type === 'live' ? 'Live' : 'HTTP',
            value: type,
          }))}
        />
        <TextField
          field="live.deliveryFormatLabel"
          label="Delivery format"
          value={delivery}
          onChange={() => undefined}
          disabled
          help="Inferred from the stream URL (HLS, MPEG-TS, DASH, …)."
        />
        <TextField
          field="live.streamName"
          label="Stream name"
          value={input.streamName}
          onChange={(streamName) => patch({ streamName })}
        />
      </FieldGrid>

      <SwitchRow>
        <SwitchField
          field="stream.proxied"
          label="Proxied"
          value={input.proxied}
          onChange={(proxied) => patch({ proxied })}
        />
      </SwitchRow>

      <FieldNote>
        Format flags such as HLS / MPEG-TS / DASH follow the URL. They are not
        confirmed with ffprobe in the preview. Do not put live.streamUrl in a
        template — use live.streamUrlSafe or live.streamHost.
      </FieldNote>

      <AdvancedFields fields={ADVANCED}>
        <FieldGrid>
          <TextField
            field="live.protocol"
            label="Protocol"
            value={urlProtocol(input.streamUrl)}
            onChange={() => undefined}
            disabled
          />
          <TextField
            field="stream.message"
            label="Message"
            value={input.message}
            onChange={(message) => patch({ message })}
          />
        </FieldGrid>
      </AdvancedFields>
    </div>
  );
}

function urlProtocol(url: string): string {
  try {
    return new URL(url).protocol.replace(':', '');
  } catch {
    return '';
  }
}
