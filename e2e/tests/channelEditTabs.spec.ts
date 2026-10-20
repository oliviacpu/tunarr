import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { SERVER_URL } from '../fixture/env.ts';
import { api } from '../fixture/api.ts';
import type { GetChannelsByNumberV2Response as Channel } from '../../web/src/generated/types.gen.ts';
import { knownIssuesFor } from './knownIssues.ts';
import { watchPageHealth } from './pageHealth.ts';
import { readFixtureIds } from './routes.ts';

const tabs = [
  ['properties', 'Properties'],
  ['flex', 'Flex'],
  ['guide', 'Guide'],
  ['streaming', 'Streaming'],
  ['watermark', 'Watermark'],
] as const;

function channelId(index = 0) {
  const id = readFixtureIds().channelIds[index];
  if (id === undefined) throw new Error('Fixture needs channels');
  return id;
}

const saveButton = (page: Page) =>
  page.getByRole('button', { name: 'Save', exact: true });
const watermarkUrl = (page: Page) =>
  page
    .locator('label')
    .filter({ hasText: /^Watermark image URL$/ })
    .locator('..')
    .getByRole('textbox');

test('all five deep links select their tab, breadcrumb and Channels navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const [path, label] of tabs) {
    await page.goto(`/web/channels/${channelId()}/edit/${path}`);
    await expect(
      page.getByRole('tab', { name: label, exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(
      page.getByRole('tabpanel', { name: label, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'breadcrumbs' }),
    ).toContainText(label);
    await expect(
      page
        .locator('nav .MuiListItemButton-root')
        .filter({ hasText: /^Channels$/ }),
    ).toHaveClass(/Mui-selected/);
    await expect(saveButton(page)).toBeDisabled();
    if (path === 'streaming')
      await expect(page.getByLabel('Enable watermark')).not.toBeVisible();
    if (path === 'watermark')
      await expect(page.getByLabel('Enable watermark')).toBeVisible();
  }
});

test('legacy tab links redirect to canonical routes', async ({ page }) => {
  for (const [legacy, canonical] of [
    ['', 'properties'],
    ['properties', 'properties'],
    ['flex', 'flex'],
    ['epg', 'guide'],
    ['ffmpeg', 'streaming'],
    ['watermark', 'watermark'],
  ]) {
    await page.goto(
      `/web/channels/${channelId()}/edit${legacy ? `?tab=${legacy}` : ''}`,
    );
    await expect(page).toHaveURL(new RegExp(`/edit/${canonical}$`));
    await expect(
      page.getByRole('tab', {
        name: tabs.find(([path]) => path === canonical)?.[1],
        exact: true,
      }),
    ).toHaveAttribute('aria-selected', 'true');
  }
});

test('one form preserves drafts through tabs and browser history, then saves every tab', async ({
  page,
}) => {
  const id = channelId();
  const path = `/channels/${id}`;
  const before = await api<Channel>('GET', path);
  try {
    const name = 'P5 Saved routed channel';
    await page.goto(`/web/channels/${id}/edit/properties`);
    await page.getByLabel('Channel name', { exact: true }).fill(name);
    await page.getByRole('tab', { name: 'Watermark', exact: true }).click();
    await page.getByLabel('Enable watermark', { exact: true }).check();
    await watermarkUrl(page).fill(`${SERVER_URL}/images/tunarr.png`);
    await page.getByRole('tab', { name: 'Guide', exact: true }).click();
    await page
      .getByLabel('Guide title for flex', { exact: true })
      .fill('P5 route guide');
    await page.goBack();
    await expect(watermarkUrl(page)).toHaveValue(
      `${SERVER_URL}/images/tunarr.png`,
    );
    await page.goBack();
    await expect(page.getByLabel('Channel name', { exact: true })).toHaveValue(
      name,
    );
    await page.goForward();
    await expect(
      page.getByLabel('Enable watermark', { exact: true }),
    ).toBeChecked();
    await page.getByRole('tab', { name: 'Guide', exact: true }).click();
    await expect(
      page.getByLabel('Guide title for flex', { exact: true }),
    ).toHaveValue('P5 route guide');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    const saved = page.waitForResponse(
      (response) =>
        response.url() === `${SERVER_URL}/api/channels/${id}` &&
        response.request().method() === 'PUT',
    );
    await saveButton(page).click();
    expect((await saved).ok()).toBe(true);
    await expect(saveButton(page)).toBeDisabled();
    const persisted: unknown = await (
      await page.request.get(`${SERVER_URL}/api/channels/${id}`)
    ).json();
    expect(persisted).toMatchObject({
      name,
      guideFlexTitle: 'P5 route guide',
      watermark: { enabled: true, url: `${SERVER_URL}/images/tunarr.png` },
    });
    await page.reload();
    await expect(
      page.getByRole('tab', { name: 'Guide', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(
      page.getByLabel('Guide title for flex', { exact: true }),
    ).toHaveValue('P5 route guide');
    await expect(saveButton(page)).toBeDisabled();
  } finally {
    const {
      startTime: _startTime,
      onDemand: _onDemand,
      fallback: _fallback,
      programCount: _programCount,
      sessions: _sessions,
      ...current
    } = await api<Channel>('GET', path);
    await api('PUT', path, {
      ...current,
      name: before.name,
      guideFlexTitle: before.guideFlexTitle ?? '',
      // Missing optional fields are not cleared by the channel update API.
      watermark: before.watermark ?? {
        enabled: false,
        url: '',
        position: 'bottom-right',
        width: 10,
        horizontalMargin: 1,
        verticalMargin: 1,
        duration: 0,
      },
    });
  }
});

test('leaving the editor asks once, Cancel keeps drafts and Proceed discards them', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/web/channels/${channelId()}/edit/properties`);
  await page
    .getByLabel('Channel name', { exact: true })
    .fill('P5 Unsaved draft');
  const channels = page
    .locator('nav .MuiListItemButton-root')
    .filter({ hasText: /^Channels$/ });
  await channels.click();
  const dialog = page.getByRole('dialog', {
    name: 'You have unsaved changes!',
  });
  await expect(dialog).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Channel name', { exact: true })).toHaveValue(
    'P5 Unsaved draft',
  );
  await channels.click();
  await dialog.getByRole('button', { name: 'Proceed', exact: true }).click();
  await expect(page).toHaveURL(/\/web\/channels$/);
  await page.goto(`/web/channels/${channelId()}/edit/properties`);
  await expect(
    page.getByLabel('Channel name', { exact: true }),
  ).not.toHaveValue('P5 Unsaved draft');
});

test('all routed tabs fit phone and desktop in both themes', async ({
  page,
}, testInfo) => {
  const health = watchPageHealth(
    page,
    knownIssuesFor('/channels/$channelId/edit'),
  );
  await page.goto(`/web/channels/${channelId(2)}/edit/properties`);
  for (const colorScheme of ['light', 'dark'] as const) {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(
        page.getByRole('button', { name: /Enable (light|dark) Mode/ }),
      ).toBeVisible();
      const themeToggle = page.getByRole('button', {
        name: colorScheme === 'dark' ? 'Enable dark Mode' : 'Enable light Mode',
        exact: true,
      });
      if (await themeToggle.isVisible()) await themeToggle.click();
      await expect(
        page.getByRole('button', {
          name:
            colorScheme === 'dark' ? 'Enable light Mode' : 'Enable dark Mode',
          exact: true,
        }),
      ).toBeVisible();
      for (const [path, label] of tabs) {
        await page.getByRole('tab', { name: label, exact: true }).click();
        await expect(
          page.getByRole('tabpanel', { name: label, exact: true }),
        ).toBeVisible();
        if (path === 'watermark')
          await page.getByLabel('Enable watermark', { exact: true }).check();
        await health.settle();
        await page.waitForFunction(() =>
          document
            .getAnimations()
            .every(
              (animation) =>
                ['finished', 'idle'].includes(animation.playState) ||
                animation.effect?.getTiming().iterations === Infinity,
            ),
        );
        await page.screenshot({
          path: testInfo.outputPath(`${path}-${colorScheme}-${width}.png`),
          fullPage: true,
          animations: 'disabled',
        });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
      }
    }
  }
  expect(health.problems).toEqual([]);
});
