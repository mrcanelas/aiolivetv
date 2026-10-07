const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPayload, sendMessage } = require('./notify-discord.cjs');

const env = {
  GITHUB_REPOSITORY: 'mrcanelas/aiolivetv',
  GITHUB_RUN_ID: '12345',
  RELEASE_REF: 'v0.7.0',
  CHANNEL: 'stable',
  TAGS: 'v0.7.0 latest',
};
const channel = '1557042471077285968';

test('release and build cards include the logo and native link buttons', () => {
  const release = createPayload('release', env, { tag_name: 'v0.7.0' });
  const build = createPayload('build', env);
  for (const payload of [release, build]) {
    assert.match(payload.embeds[0].thumbnail.url, /favicon\.png$/);
    assert.equal(payload.flags, undefined);
    assert.equal(payload.components[0].type, 1);
    for (const button of payload.components[0].components) {
      assert.equal(button.type, 2);
      assert.equal(button.style, 5);
      assert.equal(button.custom_id, undefined);
      assert.equal(new URL(button.url).protocol, 'https:');
    }
  }
  assert.equal(release.components[0].components[0].label, 'View on GitHub');
  assert.equal(release.components[0].components[0].url, release.embeds[0].url);
  assert.deepEqual(
    build.components[0].components.map((button) => button.label),
    ['View Build', 'GHCR', 'Docker Hub']
  );
});

test('build embeds preserve tags and block all mentions', () => {
  const payload = createPayload('build', env);
  assert.match(payload.embeds[0].title, /Stable Release/);
  assert.equal(payload.embeds[0].fields[1].value, '- `v0.7.0`\n- `latest`');
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.equal(payload.nonce.length, 25);
  assert.equal(payload.enforce_nonce, true);
  assert.equal(
    JSON.parse(JSON.stringify(payload)).embeds[0].fields[1].value,
    payload.embeds[0].fields[1].value
  );
});

test('beta builds are not advertised as stable', () => {
  const payload = createPayload('build', {
    ...env,
    RELEASE_REF: 'v0.7.0-beta',
    TAGS: 'v0.7.0-beta',
  });
  assert.match(payload.embeds[0].title, /Prerelease/);
  assert.equal(payload.embeds[0].fields[0].value, 'prerelease');
});

test('release notes are bounded, JSON-safe and cannot ping members', () => {
  const payload = createPayload('release', env, {
    tag_name: 'v0.7.0-beta',
    prerelease: true,
    body: '"Quoted"\n@everyone\n' + 'a'.repeat(5000),
  });
  assert.equal(payload.embeds[0].description.length, 3500);
  assert.match(payload.embeds[0].title, /Prerelease/);
  assert.deepEqual(payload.allowed_mentions.parse, []);
  assert.notEqual(payload.nonce, createPayload('build', env).nonce);
});

test('test posts explicitly identify themselves as tests', () => {
  assert.match(
    createPayload('test', env).embeds[0].description,
    /not a release or deployment/
  );
});

test('invalid notification inputs fail before sending', () => {
  assert.throws(() => createPayload('build', { ...env, TAGS: '' }), /require/);
  assert.throws(() => createPayload('release', env), /tag/);
  assert.throws(() => createPayload('other', env), /Unknown/);
  assert.throws(() => createPayload('test', {}), /GITHUB_REPOSITORY/);
});

test('posts with bot authentication and no personal account credentials', async () => {
  let request;
  await sendMessage(
    'test-token',
    channel,
    createPayload('test', env),
    async (url, options) => {
      request = { url, options };
      return { ok: true };
    }
  );
  assert.equal(
    request.url,
    `https://discord.com/api/v10/channels/${channel}/messages`
  );
  assert.equal(request.options.headers.Authorization, 'Bot test-token');
  assert.equal(request.options.method, 'POST');
});

test('invalid channel IDs and forbidden responses are not retried', async () => {
  await assert.rejects(
    sendMessage('test-token', 'invalid', {}, async () =>
      assert.fail('must not send')
    ),
    /channel ID/
  );
  let calls = 0;
  await assert.rejects(
    sendMessage('test-token', channel, {}, async () => {
      calls++;
      return { ok: false, status: 403 };
    }),
    /HTTP 403/
  );
  assert.equal(calls, 1);
});

test('rate limits are retried using Discord delay and unchanged nonce', async () => {
  const bodies = [];
  const delays = [];
  await sendMessage(
    'test-token',
    channel,
    createPayload('test', env),
    async (_url, options) => {
      bodies.push(options.body);
      return bodies.length === 1
        ? { ok: false, status: 429, json: async () => ({ retry_after: 0.5 }) }
        : { ok: true };
    },
    async (ms) => delays.push(ms)
  );
  assert.deepEqual(delays, [500]);
  assert.equal(bodies[0], bodies[1]);
});

test('transient server failures have bounded retries', async () => {
  let calls = 0;
  await assert.rejects(
    sendMessage(
      'test-token',
      channel,
      {},
      async () => {
        calls++;
        return { ok: false, status: 503 };
      },
      async () => {}
    ),
    /HTTP 503/
  );
  assert.equal(calls, 3);
});
