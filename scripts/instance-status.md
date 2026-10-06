# Discord Instance Status

The separate `instance-status.yml` workflow polls UptimeRobot every five minutes
(at minutes 2, 7, 12, etc.) and sends red downtime and green recovery embeds using
the existing AIOLiveTV bot. GitHub Actions schedules can be delayed or skipped;
this is not a real-time alert transport.

## Configuration

- Keep `INSTANCE_STATUS_ENABLED` unset until the fixed health URL consistently
  bypasses external cache and the UptimeRobot monitor can be resumed.
- Add the GitHub Actions secret `UPTIMEROBOT_API_KEY`, preferably a monitor-specific
  read-only key for monitor `804194980`. Never put keys in source files or logs.
- Reuse the existing `DISCORD_BOT_TOKEN` secret. The bot needs View Channel,
  Read Message History, Send Messages and Embed Links in `instance-status`
  (`1557042531571597434`). Do not broaden server-wide permissions.
- After validating cache, resume the UptimeRobot monitor, set the repository
  variable `INSTANCE_STATUS_ENABLED` to `true`, and run the workflow manually to
  establish its initial baseline. It does not replay historical incidents.
- Once the relay is verified, detach the native Discord integration from this
  monitor to avoid duplicate notifications. Keep the integration itself.

The job uses the documented v2 `getMonitors` endpoint, which supports
monitor-specific keys and incident logs. It sends the key in the POST body and
does not change the monitor. Reference: https://uptimerobot.com/api/legacy/

## State And Recovery

The workflow creates the `instance-status-state` branch and stores only the
monitor ID, polling watermark, delivered event keys and start of the active
outage in `instance-status.json`. Its token needs `contents: write` for this
branch. Protecting this branch against workflow writes prevents persistence.
Runs are serialized; the main branch is not modified by the relay.

Each event is saved after Discord confirms delivery. Discord nonces remain
stable across retries. The relay also checks the last 100 channel messages for
the nonce or matching bot embed before sending, to recover from a failed state write. This bounds
duplicate prevention: if a send succeeded but its state write failed and its
message is no longer in the last 100 messages, a retry can duplicate it.

State housekeeping runs roughly every five hours rather than committing on
every poll. The free API retains only 24 hours of incident history. A relay gap
of 24 hours stops the workflow with an error rather than claiming no incidents.
Reconcile missing incidents before manually resetting the state. Do not delete
or reset it as routine maintenance.

Monitor pause/start events do not generate alerts. Recovery duration comes from
the recorded downtime and recovery timestamps, not the duration of the healthy
period. Delivery failure preserves the unprocessed event for retry.

The relay does not improve the health endpoint's cache, SSL-check settings or
HTTP status criteria. Five-minute checks may miss short outages and measure
application/database health, not playback of every TV channel.

## Local Verification

```sh
node --test scripts/notify-discord.test.cjs scripts/notify-instance-status.test.cjs
```

Tests mock UptimeRobot, Discord and persistence. They send no production alerts.
