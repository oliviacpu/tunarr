import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { knownIssuesFor } from './knownIssues.ts';
import { watchPageHealth } from './pageHealth.ts';
import { readFixtureIds } from './routes.ts';

const pages = [
  ['welcome', '/welcome', 'Welcome to Tunarr!'],
  ['channels', '/channels', 'Channels'],
  ['guide', '/guide', 'Guide'],
  ['library', '/library', 'Library'],
  ['fillers', '/library/fillers', 'Filler Lists'],
  ['custom-shows', '/library/custom-shows', 'Custom Shows'],
  ['smart-collections', '/library/smart_collections', 'Smart Collections'],
  ['trash', '/library/trash', 'Trash'],
  ['media-sources', '/media_sources', 'Media Sources'],
  ['search', '/search', 'Search'],
  ['settings-general', '/settings/general', 'Settings', 'General'],
  ['settings-playback', '/settings/playback', 'Settings', 'Playback'],
  [
    'settings-captions-audio',
    '/settings/captions-audio',
    'Settings',
    'Captions & audio',
  ],
  ['settings-guide', '/settings/guide', 'Settings', 'Guide'],
  ['settings-tuner', '/settings/tuner', 'Settings', 'Tuner'],
  ['settings-library', '/settings/library', 'Settings', 'Library'],
  [
    'settings-experimental',
    '/settings/experimental',
    'Settings',
    'Experimental',
  ],
  ['system', '/system', 'System', 'System Health'],
  ['tasks', '/system/tasks', 'System', 'Tasks'],
] as const;

async function setTheme(page: Page, scheme: 'light' | 'dark') {
  await expect(
    page.getByRole('button', { name: /Enable (light|dark) Mode/ }),
  ).toBeVisible();
  const toggle = page.getByRole('button', {
    name: scheme === 'dark' ? 'Enable dark Mode' : 'Enable light Mode',
    exact: true,
  });
  if (await toggle.isVisible()) await toggle.click();
  await expect(
    page.getByRole('button', {
      name: scheme === 'dark' ? 'Enable light Mode' : 'Enable dark Mode',
      exact: true,
    }),
  ).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          ['finished', 'idle'].includes(animation.playState) ||
          animation.effect?.getTiming().iterations === Infinity,
      ),
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
  await expect(page.getByText('Looks like something went wrong.')).toHaveCount(
    0,
  );
  await expect(
    page.getByRole('heading', { name: 'Not found', exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

for (const [slug, url, title, section] of pages) {
  for (const width of [390, 1440]) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`gallery ${slug} ${width} ${scheme}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 1000 });
        const health = watchPageHealth(page, knownIssuesFor(url));
        await page.goto(`/web${url}`);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
        if (section !== undefined) {
          await expect(
            page.getByRole('heading', { name: section, exact: true, level: 2 }),
          ).toBeVisible();
        }
        if (url.startsWith('/settings/')) {
          const tab = page.getByRole('tab', { name: section, exact: true });
          await tab.scrollIntoViewIfNeeded();
          await expect(tab).toHaveAttribute('aria-selected', 'true');
        }
        if (url.startsWith('/system')) {
          const tab = page.getByRole('tab', { selected: true });
          await tab.scrollIntoViewIfNeeded();
          await expect(tab).toBeInViewport();
        }
        if (url === '/search') {
          await expect(
            page.getByText('Type to search your libraries'),
          ).toBeVisible();
        }
        await setTheme(page, scheme);
        await health.settle();
        await capture(page, testInfo, `${slug}-${width}-${scheme}`);
        expect(health.problems).toEqual([]);
      });
    }
  }
}

test('documentation channel forms', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const health = watchPageHealth(
    page,
    knownIssuesFor('/channels/$channelId/edit'),
  );
  await page.goto('/web/channels/new');
  await page.getByLabel('Channel name', { exact: true }).fill('Example Cinema');
  await setTheme(page, 'light');
  await health.settle();
  await capture(page, testInfo, 'channel-properties');

  // A fresh document discards the unsaved example without changing the seed.
  await page.goto('about:blank');
  const id = readFixtureIds().channelIds[0];
  if (id === undefined) throw new Error('Fixture needs a channel');
  await page.goto(`/web/channels/${id}/edit/flex`);
  await expect(
    page.getByRole('tabpanel', { name: 'Flex', exact: true }),
  ).toBeVisible();
  await health.settle();
  await capture(page, testInfo, 'flex-filler-content');
  const fillerPath = testInfo.outputPath('channels-flex-filler.png');
  await page
    .getByText('Filler Content', { exact: true })
    .locator('..')
    .screenshot({
      path: fillerPath,
      animations: 'disabled',
    });
  await testInfo.attach('channels-flex-filler', {
    path: fillerPath,
    contentType: 'image/png',
  });
  await page.getByRole('tab', { name: 'Watermark', exact: true }).click();
  await page.getByLabel('Enable watermark', { exact: true }).check();
  await health.settle();
  await capture(page, testInfo, 'watermark_form');
  expect(health.problems).toEqual([]);
});

test('documentation transcode sections', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const health = watchPageHealth(
    page,
    knownIssuesFor('/settings/playback/$configId'),
  );
  await page.goto(
    `/web/settings/playback/${readFixtureIds().transcodeConfigId}`,
  );
  await expect(
    page.getByRole('textbox', { name: 'Threads', exact: true }),
  ).toBeVisible();
  await setTheme(page, 'light');
  await health.settle();
  for (const [section, suffix] of [
    ['Video Options', 'video'],
    ['Audio Options', 'audio'],
    ['Error Options', 'error'],
  ]) {
    const heading = page.getByRole('heading', {
      level: 2,
      name: section,
      exact: true,
    });
    await expect(heading).toBeVisible();
    const path = testInfo.outputPath(`transcode_configs_${suffix}.png`);
    await heading.locator('..').screenshot({ path, animations: 'disabled' });
    await testInfo.attach(`transcode_configs_${suffix}`, {
      path,
      contentType: 'image/png',
    });
  }
  expect(health.problems).toEqual([]);
});
