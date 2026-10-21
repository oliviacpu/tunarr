import { expect, test, type Locator } from '@playwright/test';
import type { GetApiTrashStatusResponse } from '../../web/src/generated/types.gen.ts';
import { knownIssuesFor } from './knownIssues.ts';
import { watchPageHealth } from './pageHealth.ts';

const mediaTypes = [
  'Movies',
  'Episodes',
  'Tracks',
  'Other Videos',
  'Music Videos',
] as const;

async function expectWithinPage(control: Locator, width: number) {
  await expect(control).toBeVisible();
  const bounds = await control.boundingBox();
  if (bounds === null) throw new Error('Trash control did not render');
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
}

for (const width of [390, 1440]) {
  for (const dark of [false, true]) {
    test(`${width}px ${dark ? 'dark' : 'light'} Trash controls fit and remain usable`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      let status: GetApiTrashStatusResponse = {
        state: 'idle',
        total: 0,
        deleted: 0,
        startedAt: null,
        finishedAt: null,
        error: null,
      };
      let starts = 0;
      let cancellations = 0;
      // Exercise the real controls without deleting or changing seeded programs.
      await page.route('**/api/trash/status', (route) =>
        route.fulfill({ json: status }),
      );
      await page.route('**/api/trash', async (route) => {
        if (route.request().method() !== 'DELETE') return route.continue();
        starts++;
        status = {
          ...status,
          state: 'running',
          total: 3,
          deleted: 1,
          startedAt: 1,
        };
        await route.fulfill({ status: 202, json: status });
      });
      await page.route('**/api/trash/cancel', async (route) => {
        cancellations++;
        status = { ...status, state: 'idle', finishedAt: 2 };
        await route.fulfill({ json: status });
      });
      const health = watchPageHealth(page, knownIssuesFor('/library/trash'));
      await page.goto('/web/library/trash');
      await expect(
        page.getByRole('button', { name: /Enable (light|dark) Mode/ }),
      ).toBeVisible();
      const themeToggle = page.getByRole('button', {
        name: dark ? 'Enable dark Mode' : 'Enable light Mode',
        exact: true,
      });
      if (await themeToggle.isVisible()) await themeToggle.click();
      await expect(
        page.getByRole('button', {
          name: dark ? 'Enable light Mode' : 'Enable dark Mode',
          exact: true,
        }),
      ).toBeVisible();
      await health.settle();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      for (const name of mediaTypes) {
        const filter = page.getByRole('button', { name, exact: true });
        await expectWithinPage(filter, width);
        await filter.click();
        await expect(filter).toHaveAttribute('aria-pressed', 'true');
      }
      for (const name of mediaTypes) {
        await expect(
          page.getByRole('button', { name, exact: true }),
        ).toHaveAttribute('aria-pressed', 'true');
      }
      const movies = page.getByRole('button', { name: 'Movies', exact: true });
      await movies.click();
      await expect(movies).toHaveAttribute('aria-pressed', 'false');
      await expect(
        page.getByRole('button', { name: 'Music Videos', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true');
      const empty = page.getByRole('button', {
        name: 'Empty Trash',
        exact: true,
      });
      await expectWithinPage(empty, width);
      await page.screenshot({
        path: testInfo.outputPath('trash-idle.png'),
        fullPage: true,
        animations: 'disabled',
      });
      await empty.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(
        'This permanently deletes all trashed items.',
      );
      await expect(dialog).toContainText('will be replaced with flex.');
      expect(starts).toBe(0);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(starts).toBe(0);
      await empty.click();
      await dialog
        .getByRole('button', { name: 'Empty trash', exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      await expect(
        page.getByText('Emptying trash: 1 / 3', { exact: true }),
      ).toBeVisible();
      expect(starts).toBe(1);
      await expect(empty).toBeDisabled();
      const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
      await expectWithinPage(cancel, width);
      await expectWithinPage(empty, width);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: testInfo.outputPath('trash-running.png'),
        fullPage: true,
        animations: 'disabled',
      });
      await cancel.click();
      await expect(cancel).toHaveCount(0);
      await expect(empty).toBeEnabled();
      expect(cancellations).toBe(1);
      await health.settle();
      expect(health.problems).toEqual([]);
    });
  }
}
