import { expect, test } from '@playwright/test';
import type { GetApiChannelsAllLineupsResponse } from '../../web/src/generated/types.gen.ts';
import { readFixtureIds } from './routes.ts';

test('guide uses redirect names, shows mobile times and themes compact dividers', async ({
  page,
}, testInfo) => {
  const ids = readFixtureIds();
  const [channelId, targetId] = ids.channelIds;
  if (channelId === undefined || targetId === undefined)
    throw new Error('Fixture needs two channels');
  await page.route('**/api/channels/all/lineups**', async (route) => {
    const url = new URL(route.request().url());
    const start = Date.parse(url.searchParams.get('from') ?? '');
    const end = Date.parse(url.searchParams.get('to') ?? '');
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      throw new Error('Expected guide window');
    const redirectEnd = start + (end - start) * 0.75;
    const sliverEnd = redirectEnd + (end - start) / 240;
    const fixture = {
      id: channelId,
      name: 'E2E Mixed',
      number: 1,
      programs: [
        {
          type: 'redirect',
          channel: targetId,
          channelName: 'E2E Episodes',
          channelNumber: 2,
          duration: redirectEnd - start,
          start,
          stop: redirectEnd,
          isPaused: false,
        },
        {
          type: 'flex',
          title: 'Short break',
          duration: sliverEnd - redirectEnd,
          start: redirectEnd,
          stop: sliverEnd,
          isPaused: false,
        },
        {
          type: 'flex',
          title: 'Later break',
          duration: end - sliverEnd,
          start: sliverEnd,
          stop: end,
          isPaused: false,
        },
      ],
    } satisfies GetApiChannelsAllLineupsResponse[number];
    const response = await route.fetch();
    const body: unknown = await response.json();
    if (!Array.isArray(body)) throw new Error('Expected channel lineups');
    const lineups: unknown[] = body;
    await route.fulfill({
      response,
      json: lineups.map((lineup) =>
        lineup !== null &&
        typeof lineup === 'object' &&
        'id' in lineup &&
        lineup.id === channelId
          ? fixture
          : lineup,
      ),
    });
  });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const shadows: string[] = [];
    for (const dark of [false, true]) {
      await page.goto('/web/guide');
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
      const duration = page.getByRole('group', { name: 'Guide duration' });
      const minus = duration.getByRole('button', {
        name: 'Show one hour less',
      });
      const plus = duration.getByRole('button', { name: 'Show one hour more' });
      if (await duration.getByText('2 hours', { exact: true }).isVisible()) {
        await plus.click();
      }
      await expect(
        duration.getByText('3 hours', { exact: true }),
      ).toBeVisible();
      await minus.click();
      await expect(
        duration.getByText('2 hours', { exact: true }),
      ).toBeVisible();
      await plus.click();
      await expect(
        duration.getByText('3 hours', { exact: true }),
      ).toBeVisible();
      const controls = await duration
        .locator(':scope > *')
        .evaluateAll((elements) =>
          elements.map(
            (element) =>
              element.getAttribute('aria-label') ?? element.textContent,
          ),
        );
      expect(controls).toEqual([
        'Show one hour less',
        '3 hours',
        'Show one hour more',
      ]);
      const title = page.getByText('Redirect to Channel E2E Episodes', {
        exact: true,
      });
      await expect(title).toBeVisible();
      await expect(
        page.getByText(`Redirect to Channel ${targetId}`, { exact: true }),
      ).toHaveCount(0);
      const cell = title.locator('..').locator('..');
      await expect(
        cell.getByText(/\d{1,2}:\d{2}.* - \d{1,2}:\d{2}/),
      ).toBeVisible();
      await expect(cell.getByText(/left$/)).toBeVisible();
      const sliver = page.getByTitle('Short break', { exact: true });
      await expect(sliver).toBeVisible();
      shadows.push(
        await sliver.evaluate((element) => getComputedStyle(element).boxShadow),
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(
          `guide-${width}-${dark ? 'dark' : 'light'}.png`,
        ),
        fullPage: true,
        animations: 'disabled',
      });
    }
    expect(shadows[0]).not.toBe(shadows[1]);
  }
});
