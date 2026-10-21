import { expect, test } from '@playwright/test';
import type { GetChannelsResponse } from '../../web/src/generated/types.gen.ts';
import { knownIssuesFor } from './knownIssues.ts';
import { watchPageHealth } from './pageHealth.ts';
import { readFixtureIds } from './routes.ts';

for (const dark of [false, true]) {
  test(`mobile channel card actions stay separate in ${dark ? 'dark' : 'light'} mode`, async ({
    page,
  }, testInfo) => {
    const channelId = readFixtureIds().channelIds[0];
    if (channelId === undefined) throw new Error('Fixture channel missing');
    await page.setViewportSize({ width: 390, height: 900 });
    await page.route('**/api/channels', async (route) => {
      const response = await route.fetch();
      const channels = (await response.json()) as GetChannelsResponse;
      await route.fulfill({
        response,
        json: channels.map((channel) =>
          channel.id === channelId
            ? {
                ...channel,
                name: 'E2E Card Actions',
                sessions: [
                  {
                    type: 'hls',
                    state: 'started',
                    numConnections: 1,
                    connections: [],
                  },
                ],
              }
            : channel,
        ),
      });
    });
    const health = watchPageHealth(page, knownIssuesFor('/channels'));
    await page.goto('/web/channels');
    await expect(
      page.getByRole('button', { name: /Enable (light|dark) Mode/ }),
    ).toBeVisible();
    const toggle = page.getByRole('button', {
      name: dark ? 'Enable dark Mode' : 'Enable light Mode',
      exact: true,
    });
    if (await toggle.isVisible()) await toggle.click();
    await expect(
      page.getByRole('button', {
        name: dark ? 'Enable light Mode' : 'Enable dark Mode',
        exact: true,
      }),
    ).toBeVisible();

    const navigation = page.getByRole('button', {
      name: 'Open channel E2E Card Actions',
      exact: true,
    });
    const options = page.getByRole('button', {
      name: 'Options for E2E Card Actions',
      exact: true,
    });
    const sessions = page.getByRole('button', {
      name: 'View sessions for E2E Card Actions',
      exact: true,
    });
    await expect(navigation).toBeVisible();
    await expect(page.locator('button button')).toHaveCount(0);
    await expect(page.getByText('1–3 of 3')).toBeVisible();
    const titlePositions = await page
      .getByRole('button', { name: /^Open channel / })
      .locator('h6')
      .evaluateAll((headings) =>
        headings.map((heading) => heading.getBoundingClientRect().left),
      );
    expect(titlePositions).toHaveLength(3);
    expect(new Set(titlePositions).size).toBe(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath('channel-cards.png'),
      fullPage: true,
    });

    await navigation.focus();
    await page.keyboard.press('Tab');
    await expect(options).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(options).toBeFocused();
    await expect(page).toHaveURL(/\/web\/channels$/);

    await sessions.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('"E2E Card Actions" Sessions');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/web\/channels$/);

    if (dark) {
      await navigation.focus();
      await page.keyboard.press('Space');
    } else {
      await navigation.click();
    }
    await expect(page).toHaveURL(new RegExp(`/web/channels/${channelId}$`));
    await health.settle();
    expect(health.problems).toEqual([]);
  });
}
