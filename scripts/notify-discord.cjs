const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');

const LOGO_URL =
  'https://raw.githubusercontent.com/mrcanelas/aiolivetv/main/packages/frontend/public/favicon.png';

function linkButtons(links) {
  return [
    {
      type: 1,
      components: links.map(([label, url]) => ({
        type: 2,
        style: 5,
        label,
        url,
      })),
    },
  ];
}

function createPayload(kind, env, release = {}) {
  const repository = env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) {
    throw new Error(
      'GITHUB_REPOSITORY must identify the owner and repository.'
    );
  }
  const base = `https://github.com/${repository}`;
  const version = kind === 'release' ? release.tag_name : env.RELEASE_REF;
  const prerelease = release.prerelease || Boolean(version?.includes('-'));
  let embed;
  let links;
  if (kind === 'release') {
    if (!version) throw new Error('The release event must include a tag.');
    embed = {
      title: `${prerelease ? 'Prerelease' : 'Release'} ${version}`.slice(
        0,
        256
      ),
      url: `${base}/releases/tag/${encodeURIComponent(version)}`,
      description: (
        release.body || 'A new AIOLiveTV release is available.'
      ).slice(0, 3500),
      color: prerelease ? 15844367 : 5763719,
    };
    links = [['View on GitHub', embed.url]];
  } else if (kind === 'build') {
    if (!version || !env.TAGS?.trim())
      throw new Error('Build notifications require RELEASE_REF and TAGS.');
    const channel = prerelease ? 'prerelease' : env.CHANNEL || 'stable';
    embed = {
      title: `${prerelease ? 'Prerelease' : 'Stable Release'} - Docker Images Published`,
      description:
        'New multi-platform Docker images are available on GHCR and Docker Hub.',
      color: prerelease ? 15844367 : 5763719,
      fields: [
        { name: 'Channel', value: channel, inline: true },
        {
          name: 'Tags Published',
          value: env.TAGS.trim()
            .split(/\s+/)
            .map((tag) => `- \`${tag}\``)
            .join('\n')
            .slice(0, 1024),
        },
      ],
    };
    links = [
      ['View Build', `${base}/actions/runs/${env.GITHUB_RUN_ID}`],
      ['GHCR', `${base}/pkgs/container/aiolivetv`],
      ['Docker Hub', `https://hub.docker.com/r/${repository}`],
    ];
  } else if (kind === 'test') {
    embed = {
      title: 'AIOLiveTV bot connection test',
      description:
        'The bot can publish notifications from GitHub Actions. This is not a release or deployment announcement.',
      color: 3447003,
    };
    links = [['View on GitHub', base]];
  } else {
    throw new Error(`Unknown notification kind: ${kind}`);
  }
  embed.footer = { text: 'AIOLiveTV CI' };
  embed.thumbnail = { url: LOGO_URL };
  return {
    embeds: [embed],
    components: linkButtons(links),
    allowed_mentions: { parse: [] },
    // Discord deduplicates retries of the same workflow run and notification kind.
    nonce: createHash('sha256')
      .update(`${repository}:${env.GITHUB_RUN_ID}:${kind}`)
      .digest('hex')
      .slice(0, 25),
    enforce_nonce: true,
  };
}

async function sendMessage(
  token,
  channelId,
  payload,
  fetchFn = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
) {
  if (!/^\d{17,20}$/.test(channelId || ''))
    throw new Error('The Discord channel ID must be a numeric snowflake.');
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetchFn(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bot ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      }
    );
    if (response.ok) return;
    if (attempt < 2 && response.status === 429) {
      const { retry_after } = await response.json();
      if (
        Number.isFinite(retry_after) &&
        retry_after >= 0 &&
        retry_after <= 30
      ) {
        await sleep(Math.ceil(retry_after * 1000));
        continue;
      }
    }
    if (attempt < 2 && response.status >= 500) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    throw new Error(
      `Discord rejected the notification (HTTP ${response.status}). Check the bot token and channel permissions.`
    );
  }
}

async function main(env = process.env) {
  const kind = process.argv[2] || 'build';
  const dryRun = process.argv.includes('--dry-run');
  if (!dryRun && !env.DISCORD_BOT_TOKEN) {
    console.log('DISCORD_BOT_TOKEN is not set; skipping notification.');
    return;
  }
  const release =
    kind === 'release'
      ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')).release
      : {};
  const payload = createPayload(kind, env, release);
  if (dryRun) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  const channelId =
    kind === 'release'
      ? env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID
      : env.DISCORD_BUILDS_CHANNEL_ID;
  await sendMessage(env.DISCORD_BOT_TOKEN, channelId, payload);
  console.log('Discord notification sent as the AIOLiveTV bot.');
}

module.exports = { createPayload, sendMessage, LOGO_URL, linkButtons };
if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
