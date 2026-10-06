const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createStatusPayload,
  relay,
  getMonitor,
  sendStatusMessage,
  createStateStore,
} = require('./notify-instance-status.cjs');

const now = 10000;
const down = {
  type: 1,
  datetime: 9900,
  reason: { detail: 'Connection timeout' },
};
const up = { type: 2, datetime: 9960, duration: 30 };
const monitor = {
  id: 804194980,
  status: 2,
  url: 'https://94c8cb9f702d-aiolivetv.baby-beamup.club/api/v1/health',
  logs: [up, down],
};
const initial = () => ({
  monitorId: String(monitor.id),
  since: 9800,
  sent: [],
  downSince: null,
});

test('state branch creation and writes preserve the latest file SHA', async () => {
  let writes = 0;
  const store = await createStateStore(
    {
      GITHUB_REPOSITORY: 'mrcanelas/aiolivetv',
      GITHUB_TOKEN: 'test-token',
      GITHUB_SHA: 'initial-commit',
    },
    async (url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      if (options.method === 'GET') return { status: 404 };
      const body = JSON.parse(options.body);
      if (options.method === 'POST') {
        assert.equal(body.ref, 'refs/heads/instance-status-state');
        assert.equal(body.sha, 'initial-commit');
        return { ok: true, json: async () => ({ ref: body.ref }) };
      }
      writes++;
      assert.equal(body.branch, 'instance-status-state');
      assert.equal(body.sha, writes === 1 ? undefined : 'file-1');
      assert.deepEqual(
        JSON.parse(Buffer.from(body.content, 'base64').toString()),
        initial()
      );
      return {
        ok: true,
        json: async () => ({ content: { sha: `file-${writes}` } }),
      };
    }
  );
  assert.equal(store.state, null);
  await store.save(initial());
  await store.save(initial());
  assert.equal(writes, 2);
});

test('first run establishes a baseline without replaying old incidents', async () => {
  let saved;
  await relay(
    monitor,
    null,
    async (state) => {
      saved = state;
    },
    async () => assert.fail('old alert'),
    now
  );
  assert.equal(saved.since, now);
  assert.equal(saved.downSince, null);
});

test('down and recovery between polls are sent in order, once', async () => {
  let saved = initial();
  const payloads = [];
  const save = async (state) => {
    saved = structuredClone(state);
  };
  const send = async (payload) => payloads.push(payload);
  await relay(monitor, saved, save, send, now);
  await relay(monitor, saved, save, send, now + 300);
  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].embeds[0].color, 15548997);
  assert.equal(payloads[1].embeds[0].color, 5763719);
  assert.equal(payloads[1].embeds[0].fields[1].value, '1m 0s');
  assert.deepEqual(payloads[0].allowed_mentions, { parse: [] });
  assert.notEqual(payloads[0].nonce, payloads[1].nonce);
});

test('failed send does not mark an event as delivered', async () => {
  let saves = 0;
  await assert.rejects(
    relay(
      monitor,
      initial(),
      async () => saves++,
      async () => {
        throw new Error('Discord unavailable');
      },
      now
    ),
    /Discord unavailable/
  );
  assert.equal(saves, 0);
});

test('a state write failure after a send is reconciled against Discord history', async () => {
  const env = {
    DISCORD_BOT_TOKEN: 'test',
    DISCORD_INSTANCE_STATUS_CHANNEL_ID: '1557042531571597434',
  };
  const payload = createStatusPayload(String(monitor.id), down, null);
  let posted = 0;
  const fetchFn = async (_url, options) => {
    if (options.method === 'POST') {
      posted++;
      return { ok: true };
    }
    return {
      ok: true,
      json: async () =>
        posted ? [{ author: { bot: true }, embeds: payload.embeds }] : [],
    };
  };
  await assert.rejects(
    relay(
      { ...monitor, logs: [down] },
      initial(),
      async () => {
        throw new Error('state unavailable');
      },
      (body) => sendStatusMessage(env, body, fetchFn),
      now
    ),
    /state unavailable/
  );
  await relay(
    { ...monitor, logs: [down] },
    initial(),
    async () => {},
    (body) => sendStatusMessage(env, body, fetchFn),
    now
  );
  assert.equal(posted, 1);
});

test('paused monitors and unchanged status produce no messages or state churn', async () => {
  await relay(
    { ...monitor, status: 0 },
    initial(),
    async () => assert.fail('save'),
    async () => assert.fail('send'),
    now
  );
  await relay(
    { ...monitor, logs: [] },
    initial(),
    async () => assert.fail('save'),
    async () => assert.fail('send'),
    now
  );
});

test('invalid state, wrong endpoint and retention gaps fail closed', async () => {
  const noop = async () => {};
  await assert.rejects(
    relay(monitor, { ...initial(), monitorId: 'other' }, noop, noop, now),
    /Invalid relay state/
  );
  await assert.rejects(
    relay(
      { ...monitor, url: 'https://example.com' },
      initial(),
      noop,
      noop,
      now
    ),
    /Unexpected monitor/
  );
  await assert.rejects(
    relay(monitor, initial(), noop, noop, now + 86400),
    /24 hours/
  );
});

test('API request uses the specific monitor, full logs and a body-only key', async () => {
  await getMonitor(
    {
      UPTIMEROBOT_API_KEY: 'test-key',
      UPTIMEROBOT_MONITOR_ID: String(monitor.id),
    },
    async (url, options) => {
      assert.equal(url, 'https://api.uptimerobot.com/v2/getMonitors');
      assert.equal(options.body.get('api_key'), 'test-key');
      assert.equal(options.body.get('logs'), '1');
      assert.equal(options.body.get('monitors'), String(monitor.id));
      assert.equal(options.body.has('logs_limit'), false);
      return {
        ok: true,
        json: async () => ({ stat: 'ok', monitors: [monitor] }),
      };
    }
  );
  await assert.rejects(
    getMonitor(
      {
        UPTIMEROBOT_API_KEY: 'test',
        UPTIMEROBOT_MONITOR_ID: String(monitor.id),
      },
      async () => ({ ok: true, json: async () => ({ stat: 'fail' }) })
    ),
    /configured monitor/
  );
});
