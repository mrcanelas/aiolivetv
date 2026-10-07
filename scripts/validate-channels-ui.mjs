import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const playwrightModule = process.env.PLAYWRIGHT_MODULE_PATH;
const { chromium } = await import(
  playwrightModule ? pathToFileURL(playwrightModule).href : 'playwright'
);
const root = resolve('packages/frontend/dist');
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file =
      pathname.startsWith('/stremio/') || pathname === '/'
        ? resolve(root, 'index.html')
        : resolve(root, '.' + pathname);
    if (!file.startsWith(root + sep)) throw new Error('Invalid asset path');
    const types = {
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.html': 'text/html',
      '.png': 'image/png',
      '.woff2': 'font/woff2',
      '.woff': 'font/woff',
    };
    res.setHeader(
      'Content-Type',
      types[extname(file)] ?? 'application/octet-stream'
    );
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  });
  const proxy = {
    enabled: null,
    id: null,
    url: null,
    publicUrl: null,
    publicIp: null,
    credentials: null,
    proxiedServices: null,
  };
  const status = {
    version: 'test',
    tag: 'test',
    channel: 'dev',
    commit: 'test',
    users: 0,
    settings: {
      addonName: 'AIOLiveTV',
      protected: false,
      alternateDesign: false,
      presets: [],
      services: {},
      limits: {},
      forced: { proxy: { ...proxy, disableProxiedAddons: false } },
      defaults: { proxy, timeout: null },
      regexAccess: { level: 'all', patterns: [], urls: [] },
      selSyncAccess: { level: 'all' },
      analyticsEnabled: false,
      userAnalyticsEnabled: false,
    },
  };
  const channels = Array.from({ length: 1287 }, (_, index) => ({
    id: 'channel:' + index,
    name:
      index === 1
        ? 'Channel 0001 International News and Documentaries HD'
        : 'Channel ' + String(index).padStart(4, '0'),
    canonicalAddonId: 'guide',
    sourceName: index < 700 ? 'Guide A' : 'Guide B',
    poster: '/favicon.png',
    enabled: true,
    epgProvider: true,
    mappings:
      index === 0
        ? [
            {
              id: 'weak',
              channelId: 'weak',
              addonId: 'weak-source',
              addonName: 'Weak source',
              name: 'Weak suggestion',
              confidence: 0.75,
              enabled: true,
              canStream: true,
              epgProvider: false,
            },
            {
              id: 'strong',
              channelId: 'strong',
              addonId: 'strong-source',
              addonName: 'Strong source',
              name: 'Strong suggestion',
              confidence: 0.8,
              enabled: true,
              canStream: true,
              epgProvider: false,
            },
          ]
        : [],
    rejectedStreams:
      index === 0 ? [{ addonId: 'streams', channelId: 'unrelated' }] : [],
    availableStreamSources: [],
  }));
  const userData = {
    presets: [],
    services: [],
    channelMappings: Array.from({ length: 1000 }, (_, index) => ({
      id: 'removed:' + index,
      name: 'Removed ' + index,
      hidden: true,
    })),
  };
  const output = resolve(process.env.UI_OUTPUT_DIR || 'testing/channels-ui');
  const streamCount = Number(process.env.UI_STREAM_COUNT || 10000);
  await mkdir(output, { recursive: true });
  for (const [name, viewport] of [
    ['desktop', { width: 1440, height: 1000 }],
    ['mobile', { width: 390, height: 844 }],
    ['mobile-narrow', { width: 320, height: 740 }],
  ]) {
    const context = await browser.newContext({ viewport });
    await context.addInitScript((draft) => {
      localStorage.setItem('aiolivetv-user-data', JSON.stringify(draft));
      localStorage.setItem('aiolivetv-first-time', 'false');
      localStorage.setItem('aiolivetv-mode', 'pro');
    }, userData);
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const errors = [];
    const scans = [];
    let releaseRefresh;
    const writes = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/v1/**', async (route) => {
      const url = new URL(route.request().url());
      if (
        route.request().method() !== 'GET' &&
        !url.pathname.endsWith('/catalogs/channels')
      ) {
        writes.push(url.pathname);
      }
      let data = null;
      if (url.pathname.endsWith('/status')) data = status;
      else if (url.pathname.endsWith('/catalogs/channels')) {
        const body = route.request().postDataJSON();
        scans.push(body);
        if (body.autoMatch)
          await new Promise((resolve) => {
            releaseRefresh = resolve;
          });
        data = {
          channels: body.alternativesFor
            ? [
                {
                  ...channels.find(
                    (channel) => channel.id === body.alternativesFor
                  ),
                  availableStreamSources: [
                    {
                      addonId: 'streams',
                      addonName: 'Streams',
                      channelId: 'unrelated',
                      name: 'Unrelated Sports',
                      confidence: 0,
                    },
                    {
                      addonId: 'streams',
                      addonName: 'Streams',
                      channelId: 'stream:0',
                      name: 'Channel 0000 HD',
                      confidence: 1,
                    },
                    ...Array.from({ length: streamCount }, (_, index) => ({
                      addonId: 'inventory',
                      addonName: 'Inventory',
                      channelId: `inventory:${index}`,
                      name: `Stream ${String(index).padStart(5, '0')}`,
                    })),
                  ],
                },
              ]
            : channels,
          sources: [],
          unmatchedStreams: [],
          unavailableStreams: [],
          duplicates: [],
          removedChannels: [],
          scan: { truncated: false, durationMs: 1, budgetMs: null },
        };
      }
      await route.fulfill({
        json: { success: true, detail: 'OK', data, error: null },
      });
    });
    await page.goto(base + '/stremio/configure?menu=channels');
    const list = page.locator('div[aria-label="Channels"]');
    await list.locator('li[data-index]').first().waitFor();
    if (viewport.width < 640) {
      assert.equal(
        await page
          .locator('[data-top-navbar]')
          .getByRole('button', { name: 'Previous', exact: true })
          .count(),
        1
      );
      assert.equal(
        await page
          .locator('[data-top-navbar]')
          .getByRole('button', { name: 'Next', exact: true })
          .count(),
        1
      );
      await page
        .getByRole('combobox', { name: 'Filter channels by status' })
        .click();
      await page
        .getByRole('option', { name: 'All (1287)', exact: true })
        .click();
    } else {
      assert.equal(
        await page
          .getByText('All (1287)', { exact: true })
          .evaluateAll(
            (items) =>
              items.filter((item) => item.getClientRects().length > 0).length
          ),
        1
      );
    }
    const headerLayout = await page
      .locator('[data-settings-card]')
      .first()
      .evaluate((card) => {
        const description = [...card.querySelectorAll('p, div')].find(
          (element) =>
            element.textContent.trim() ===
            'Manage channels, review mappings, and control stream priority.'
        );
        const toolbar = card.querySelector(
          '[title="Group by source"]'
        ).parentElement;
        const text = description.getBoundingClientRect();
        const actions = toolbar.getBoundingClientRect();
        const title = card.querySelector('h3').getBoundingClientRect();
        return {
          textWidth: text.width,
          cardWidth: card.getBoundingClientRect().width,
          textBottom: text.bottom,
          actionsTop: actions.top,
          actionsBottom: actions.bottom,
          textTop: text.top,
          titleTop: title.top,
          titleBottom: title.bottom,
          pageFits:
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        };
      });
    assert(
      headerLayout.pageFits,
      'Channels page must not overflow horizontally'
    );
    if (viewport.width < 640) {
      assert(
        headerLayout.textWidth > headerLayout.cardWidth * 0.75,
        'Description must use the mobile header width'
      );
      assert(
        headerLayout.textTop >= headerLayout.actionsBottom,
        'Mobile description must follow the actions'
      );
      assert(
        headerLayout.actionsTop < headerLayout.titleBottom &&
          headerLayout.actionsBottom > headerLayout.titleTop,
        'Title and actions must share the top row'
      );
    }
    const mounted = await list.locator('li[data-index]').count();
    assert(mounted > 0 && mounted < 60, 'List must mount only visible rows');
    assert(
      scans.every((scan) => !scan.alternativesFor),
      'Alternatives loaded eagerly'
    );
    await page.screenshot({
      path: resolve(output, name + '.png'),
      fullPage: true,
    });
    await list.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await list.getByText('Channel 1286', { exact: true }).waitFor();
    await list.evaluate((element) => {
      element.scrollTop = 0;
    });
    await list.getByText('Channel 0000', { exact: true }).waitFor();
    if (viewport.width < 640) {
      const actions = list.getByRole('button', {
        name: 'Actions for Channel 0000',
        exact: true,
      });
      const row = list
        .locator('li[data-index]')
        .filter({ hasText: 'Channel 0000' });
      assert.equal(
        await row.locator('button:visible').count(),
        1,
        'Mobile row must have one action button'
      );
      const label = await row
        .getByText('Channel 0000', { exact: true })
        .boundingBox();
      const availableWidth = await row
        .getByText('Channel 0000', { exact: true })
        .evaluate(
          (element) => element.parentElement.getBoundingClientRect().width
        );
      assert(
        label.width >= 80 && availableWidth >= 140,
        'Mobile channel names must retain readable width'
      );
      await actions.click();
      await page.getByRole('menu').waitFor();
      await page.waitForTimeout(250);
      await page.screenshot({
        path: resolve(output, name + '-actions.png'),
        fullPage: true,
      });
      await page
        .getByRole('menuitem', { name: 'Select channel', exact: true })
        .click();
      await actions.click();
      await page
        .getByRole('menuitem', { name: 'Deselect channel', exact: true })
        .click();
      await actions.click();
      await page
        .getByRole('menuitem', { name: 'Disable channel', exact: true })
        .click();
      await page.waitForFunction(() =>
        JSON.parse(
          localStorage.getItem('aiolivetv-user-data')
        ).channelMappings.some(
          (mapping) => mapping.id === 'channel:0' && mapping.enabled === false
        )
      );
      await actions.click();
      await page
        .getByRole('menuitem', { name: 'Enable channel', exact: true })
        .click();
      await actions.click();
      await page
        .getByRole('menuitem', { name: 'Edit channel', exact: true })
        .click();
      await page.getByRole('dialog').getByPlaceholder('Channel name').waitFor();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Cancel', exact: true })
        .click();
      await actions.click();
      await page
        .getByRole('menuitem', { name: 'Remove channel', exact: true })
        .click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Cancel', exact: true })
        .click();
      await list.getByText('Channel 0000', { exact: true }).waitFor();
      await actions.click();
      await page.getByRole('menuitem', { name: /^Mappings/ }).click();
    } else {
      await list.getByTitle('0 accepted, 1 to review').first().click();
    }
    const dialog = page.getByRole('dialog');
    await dialog.getByText('Strong suggestion', { exact: true }).waitFor();
    assert.equal(
      await dialog.getByText('Weak suggestion', { exact: true }).count(),
      0
    );
    await dialog
      .getByRole('button', { name: 'Accept all', exact: true })
      .click();
    await page.waitForFunction(() => {
      const mapping = JSON.parse(
        localStorage.getItem('aiolivetv-user-data')
      ).channelMappings.find((item) => item.id === 'channel:0');
      return (
        mapping.streams.some(
          (item) => item.channelId === 'strong' && item.confidence === 1
        ) && !mapping.streams.some((item) => item.channelId === 'weak')
      );
    });
    const openedAt = performance.now();
    await dialog.getByRole('combobox').click();
    const input = page.locator('[cmdk-input]');
    await page.locator('[cmdk-item]').first().waitFor();
    const openingMs = performance.now() - openedAt;
    const mountedOptions = await page.locator('[cmdk-item]').count();
    assert(
      mountedOptions < 50,
      'Stream select must not mount the full inventory'
    );
    await input.press('End');
    await page
      .locator('[cmdk-item][aria-selected="true"]')
      .filter({
        hasText: `Stream ${String(streamCount - 1).padStart(5, '0')}`,
      })
      .waitFor();
    await input.press('ArrowUp');
    await page
      .locator('[cmdk-item][aria-selected="true"]')
      .filter({
        hasText: `Stream ${String(streamCount - 2).padStart(5, '0')}`,
      })
      .waitFor();
    const searchAt = performance.now();
    await input.fill(`Stream ${String(streamCount - 1).padStart(5, '0')}`);
    await page
      .getByText(
        `Inventory · Stream ${String(streamCount - 1).padStart(5, '0')}`,
        { exact: true }
      )
      .waitFor();
    const searchMs = performance.now() - searchAt;
    await input.fill('no-such-stream-unique-fixture');
    await page.getByText('No stream channels found', { exact: true }).waitFor();
    await input.fill(`Stream ${String(streamCount - 1).padStart(5, '0')}`);
    await page
      .getByText(
        `Inventory · Stream ${String(streamCount - 1).padStart(5, '0')}`,
        { exact: true }
      )
      .waitFor();
    await input.press('Enter');
    await dialog
      .getByRole('combobox')
      .filter({ hasText: `Stream ${String(streamCount - 1).padStart(5, '0')}` })
      .waitFor();
    await dialog.getByRole('combobox').click();
    await input.fill('Unrelated Sports');
    await page.getByText('Streams · Unrelated Sports', { exact: true }).click();
    await dialog.getByRole('button', { name: 'Link', exact: true }).click();
    await page.waitForFunction(() => {
      const mapping = JSON.parse(
        localStorage.getItem('aiolivetv-user-data')
      ).channelMappings.find((item) => item.id === 'channel:0');
      return (
        mapping.streams.some(
          (item) => item.channelId === 'unrelated' && item.confidence === 0
        ) &&
        !mapping.rejectedStreams?.some((item) => item.channelId === 'unrelated')
      );
    });
    await dialog.getByRole('combobox').click();
    await page.getByText('Streams · Channel 0000 HD', { exact: true }).click();
    await dialog.getByRole('button', { name: 'Link', exact: true }).click();
    await page.waitForFunction(() => {
      const draft = JSON.parse(localStorage.getItem('aiolivetv-user-data'));
      return draft.channelMappings.some(
        (mapping) =>
          mapping.id === 'channel:0' &&
          mapping.streams?.some((stream) => stream.channelId === 'stream:0')
      );
    });
    const draft = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('aiolivetv-user-data'))
    );
    assert.equal(
      draft.channelMappings.filter((mapping) => mapping.hidden).length,
      1000
    );
    assert.deepEqual(writes, [], 'Draft edits must not save to the backend');
    assert(scans.some((scan) => scan.alternativesFor === 'channel:0'));
    await dialog.locator('.UI-Modal__close').click();
    await dialog.waitFor({ state: 'hidden' });
    const search = page.getByPlaceholder('Search channels...');
    await search.fill('1286');
    await list.getByText('Channel 1286', { exact: true }).waitFor();
    assert.equal(await list.locator('li[data-index]').count(), 1);
    await search.fill('');
    await page.getByTitle('Group by source').click();
    await list.getByText('Guide A (700)', { exact: true }).waitFor();
    const refresh = page.getByTitle('Scan stream sources and match channels');
    const idleSize = await refresh.boundingBox();
    await refresh.click();
    const spinner = refresh.locator('.UI-LoadingSpinner__icon');
    await spinner.waitFor();
    const alignment = await refresh.evaluate((button) => {
      const bounds = button.getBoundingClientRect();
      const icon = button.querySelector('svg').getBoundingClientRect();
      return {
        dx: Math.abs(bounds.x + bounds.width / 2 - icon.x - icon.width / 2),
        dy: Math.abs(bounds.y + bounds.height / 2 - icon.y - icon.height / 2),
        width: bounds.width,
        height: bounds.height,
      };
    });
    assert(
      alignment.dx <= 1 && alignment.dy <= 1,
      `Refresh spinner must stay centered: ${JSON.stringify(alignment)}`
    );
    assert.equal(alignment.width, idleSize.width);
    assert.equal(alignment.height, idleSize.height);
    await page.screenshot({
      path: resolve(output, name + '-refresh.png'),
      fullPage: true,
    });
    releaseRefresh();
    await spinner.waitFor({ state: 'hidden' });
    await page.getByText('Removed (1000)', { exact: true }).click();
    await list.locator('li[data-index]').first().waitFor();
    assert((await list.locator('li[data-index]').count()) < 60);
    assert.deepEqual(errors, [], 'Browser errors');
    console.log(
      JSON.stringify({
        viewport: name,
        channels: channels.length,
        mountedRows: mounted,
        lazyAlternatives: true,
        scrolling: true,
        search: true,
        groups: true,
        removedVirtualized: true,
        draftPersistence: true,
        mobileActions: viewport.width < 640,
        refreshCentered: true,
        streamOptions: streamCount + 2,
        mountedOptions,
        openingMs: Math.round(openingMs),
        searchMs: Math.round(searchMs),
        fullInventorySearch: true,
        virtualKeyboard: true,
      })
    );
    await context.close();
  }
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
