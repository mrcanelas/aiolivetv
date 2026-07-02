import { useUserData } from '@/context/userData';
import { SettingsCard } from '../../../shared/settings-card';
import { Switch } from '../../../ui/switch';
import { NumberInput } from '../../../ui/number-input/number-input';
import { Alert } from '../../../ui/alert';

export function StreamProbeSettings() {
  const { userData, setUserData } = useUserData();
  const enabled = userData.streamProbe?.enabled ?? false;

  return (
    <SettingsCard
      title="Stream Probe (ffprobe)"
      id="streamProbe"
      description="Enrich Live TV streams with real codec and resolution data read from the stream URL."
    >
      <Alert intent="warning">
        Enabling this can increase stream response time considerably. Each
        playable URL may be probed with ffprobe before results are returned.
        Requires FFmpeg/ffprobe on the server (
        <code>FFPROBE_PATH</code> optional).
      </Alert>

      <Switch
        label="Enable stream probing"
        side="right"
        value={enabled}
        onValueChange={(value) => {
          setUserData((prev) => ({
            ...prev,
            streamProbe: {
              ...prev.streamProbe,
              enabled: value,
            },
          }));
        }}
        help="When enabled, declared label metadata is merged with ffprobe results for live and HTTP streams."
      />

      <NumberInput
        label="Probe timeout (ms)"
        value={userData.streamProbe?.timeoutMs ?? 15_000}
        onValueChange={(value) => {
          setUserData((prev) => ({
            ...prev,
            streamProbe: {
              ...prev.streamProbe,
              timeoutMs: value ?? 15_000,
            },
          }));
        }}
        min={1000}
        max={60_000}
        step={1000}
        disabled={!enabled}
        help="Maximum time to wait for each ffprobe call."
      />
    </SettingsCard>
  );
}
