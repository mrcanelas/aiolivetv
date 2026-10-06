const { createHash } = require('node:crypto');
const { sendMessage } = require('./notify-discord.cjs');

const HEALTH_URL =
  'https://94c8cb9f702d-aiolivetv.baby-beamup.club/api/v1/health';
const STATE_BRANCH = 'instance-status-state';
const STATE_PATH = 'instance-status.json';

function eventKey(monitorId, event) {
  return `${monitorId}:${event.datetime}:${event.type}`;
}

function createStatusPayload(monitorId, event, downSince) {
  const down = event.type === 1;
  const fields = [
    {
      name: down ? 'Detected / Detectado' : 'Recovered / Restabelecido',
      value: `<t:${event.datetime}:F>`,
    },
  ];
  if (down) {
    fields.push({
      name: 'Reason / Motivo',
      value: String(
        event.reason?.detail || 'Unavailable / Indispon\u00edvel'
      ).slice(0, 1024),
    });
  } else if (Number.isInteger(downSince) && downSince <= event.datetime) {
    const seconds = event.datetime - downSince;
    fields.push({
      name: 'Downtime / Dura\u00e7\u00e3o',
      value: `${Math.floor(seconds / 60)}m ${seconds % 60}s`,
    });
  }
  const key = eventKey(monitorId, event);
  return {
    embeds: [
      {
        title: down
          ? 'AIOLiveTV is offline / est\u00e1 indispon\u00edvel'
          : 'AIOLiveTV is back online / voltou ao ar',
        url: HEALTH_URL,
        description: down
          ? 'The public instance is unavailable. / A inst\u00e2ncia p\u00fablica est\u00e1 indispon\u00edvel.'
          : 'The public instance has recovered. / A inst\u00e2ncia p\u00fablica foi restabelecida.',
        color: down ? 15548997 : 5763719,
        fields,
        timestamp: new Date(event.datetime * 1000).toISOString(),
        footer: { text: 'AIOLiveTV Status \u2022 Monitored by UptimeRobot' },
      },
    ],
    allowed_mentions: { parse: [] },
    nonce: createHash('sha256').update(key).digest('hex').slice(0, 25),
    enforce_nonce: true,
  };
}

function validateState(state, monitorId) {
  if (
    state.monitorId !== monitorId ||
    !Number.isInteger(state.since) ||
    !Array.isArray(state.sent) ||
    !state.sent.every((key) => typeof key === 'string') ||
    !(state.downSince === null || Number.isInteger(state.downSince))
  ) {
    throw new Error('Invalid relay state; refusing to replay incidents.');
  }
}

async function relay(
  monitor,
  state,
  save,
  send,
  now = Math.floor(Date.now() / 1000)
) {
  if (monitor.url !== HEALTH_URL || !Array.isArray(monitor.logs)) {
    throw new Error('Unexpected monitor URL or missing incident logs.');
  }
  const monitorId = String(monitor.id);
  const events = monitor.logs
    .filter((event) => event.type === 1 || event.type === 2)
    .sort((a, b) => a.datetime - b.datetime || a.type - b.type);
  if (
    events.some(
      (event) => !Number.isInteger(event.datetime) || event.datetime > now
    )
  ) {
    throw new Error('Invalid incident timestamp.');
  }
  if (!state) {
    const last = events.at(-1);
    await save({
      monitorId,
      since: now,
      sent: events
        .filter((event) => event.datetime >= now)
        .map((event) => eventKey(monitorId, event)),
      downSince: last?.type === 1 ? last.datetime : null,
    });
    return;
  }
  validateState(state, monitorId);
  // Free-plan incident history is only 24 hours; fail instead of hiding a gap.
  if (now - state.since >= 24 * 60 * 60) {
    throw new Error(
      'Relay has missed 24 hours of history; manual reconciliation is required.'
    );
  }
  if (monitor.status === 0) return;
  for (const event of events) {
    const key = eventKey(monitorId, event);
    if (event.datetime < state.since || state.sent.includes(key)) continue;
    await send(createStatusPayload(monitorId, event, state.downSince));
    state = {
      ...state,
      sent: [...state.sent, key],
      downSince: event.type === 1 ? event.datetime : null,
    };
    await save(state);
  }
  // Keep an overlap to accommodate API publication delay and same-second events.
  if (now - state.since >= 6 * 3600) {
    const since = now - 3600;
    await save({
      ...state,
      since,
      sent: state.sent.filter((key) => Number(key.split(':')[1]) >= since),
    });
  }
}

async function sendStatusMessage(env, payload, fetchFn = fetch) {
  // Reconcile a successful send whose subsequent state write failed.
  const response = await fetchFn(
    `https://discord.com/api/v10/channels/${env.DISCORD_INSTANCE_STATUS_CHANNEL_ID}/messages?limit=100`,
    {
      headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
      signal: AbortSignal.timeout(10000),
    }
  );
  if (!response.ok)
    throw new Error(
      `Discord history request failed (HTTP ${response.status}).`
    );
  const messages = await response.json();
  if (!Array.isArray(messages))
    throw new Error('Invalid Discord message history.');
  const expected = payload.embeds[0];
  if (
    messages.some(
      (message) =>
        String(message.nonce) === payload.nonce ||
        (message.author?.bot &&
          !message.webhook_id &&
          message.embeds?.some(
            (embed) =>
              embed.title === expected.title &&
              embed.url === expected.url &&
              Date.parse(embed.timestamp) === Date.parse(expected.timestamp) &&
              embed.footer?.text === expected.footer.text
          ))
    )
  )
    return;
  await sendMessage(
    env.DISCORD_BOT_TOKEN,
    env.DISCORD_INSTANCE_STATUS_CHANNEL_ID,
    payload,
    fetchFn
  );
}

async function getMonitor(env, fetchFn = fetch) {
  const response = await fetchFn('https://api.uptimerobot.com/v2/getMonitors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      api_key: env.UPTIMEROBOT_API_KEY,
      format: 'json',
      monitors: env.UPTIMEROBOT_MONITOR_ID,
      logs: '1',
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(`UptimeRobot request failed (HTTP ${response.status}).`);
  const data = await response.json();
  if (
    data.stat !== 'ok' ||
    data.monitors?.length !== 1 ||
    String(data.monitors[0].id) !== env.UPTIMEROBOT_MONITOR_ID
  ) {
    throw new Error('UptimeRobot did not return the configured monitor.');
  }
  return data.monitors[0];
}

async function createStateStore(env, fetchFn = fetch) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY || '')) {
    throw new Error('Invalid GITHUB_REPOSITORY.');
  }
  const base = `https://api.github.com/repos/${env.GITHUB_REPOSITORY}`;
  async function request(path, method = 'GET', body) {
    const response = await fetchFn(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 404 && method === 'GET') return null;
    if (!response.ok)
      throw new Error(`GitHub state request failed (HTTP ${response.status}).`);
    return response.json();
  }
  let branch = await request(`/git/ref/heads/${STATE_BRANCH}`);
  if (!branch) {
    branch = await request('/git/refs', 'POST', {
      ref: `refs/heads/${STATE_BRANCH}`,
      sha: env.GITHUB_SHA,
    });
  }
  const file = await request(`/contents/${STATE_PATH}?ref=${STATE_BRANCH}`);
  let sha = file?.sha;
  return {
    state: file
      ? JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'))
      : null,
    async save(state) {
      const result = await request(`/contents/${STATE_PATH}`, 'PUT', {
        message: 'chore: persist instance status relay state',
        branch: STATE_BRANCH,
        content: Buffer.from(JSON.stringify(state, null, 2) + '\n').toString(
          'base64'
        ),
        ...(sha ? { sha } : {}),
      });
      sha = result.content.sha;
    },
  };
}

async function main(env = process.env) {
  for (const name of [
    'UPTIMEROBOT_API_KEY',
    'UPTIMEROBOT_MONITOR_ID',
    'DISCORD_BOT_TOKEN',
    'DISCORD_INSTANCE_STATUS_CHANNEL_ID',
    'GITHUB_TOKEN',
  ]) {
    if (!env[name]) throw new Error(`${name} is required.`);
  }
  const monitor = await getMonitor(env);
  if (env.INSTANCE_STATUS_MODE === 'verify' || env.INSTANCE_STATUS_MODE === 'test') {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${env.DISCORD_INSTANCE_STATUS_CHANNEL_ID}/messages?limit=1`,
      {
        headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!response.ok) throw new Error(`Discord verification failed (HTTP ${response.status}).`);
    console.log(`Verified UptimeRobot monitor ${monitor.id} and Discord channel access; monitor status=${monitor.status}.`);
    if (env.INSTANCE_STATUS_MODE === 'test') {
      const now = Math.floor(Date.now() / 1000);
      for (const type of [1, 2]) {
        const event = { type, datetime: now, reason: { detail: 'Delivery test / Teste de entrega' } };
        const payload = createStatusPayload(`test-${env.GITHUB_RUN_ID}`, event, now - 60);
        payload.embeds[0].title = `TEST / TESTE: ${payload.embeds[0].title}`;
        payload.embeds[0].description = 'Delivery test only; this is not a real incident. / Apenas teste de entrega; este n\u00e3o \u00e9 um incidente real.';
        await sendStatusMessage(env, payload);
      }
      console.log('Labeled downtime and recovery test embeds sent.');
    }
    return;
  }
  if (monitor.status === 0) {
    console.log('Monitor is paused; no notifications sent.');
    return;
  }
  const store = await createStateStore(env);
  await relay(monitor, store.state, store.save, (payload) =>
    sendStatusMessage(env, payload)
  );
  console.log('Instance status relay completed.');
}

module.exports = {
  createStatusPayload,
  relay,
  getMonitor,
  sendStatusMessage,
  createStateStore,
};
if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
