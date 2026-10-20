import { expect, test } from '@playwright/test';
import type {
  GetApiChannelsByIdProgrammingResponse,
  GetChannelsByNumberV2Response,
} from '../../web/src/generated/types.gen.ts';
import { knownIssuesFor } from './knownIssues.ts';
import { watchPageHealth } from './pageHealth.ts';
import { readFixtureIds } from './routes.ts';

test('week calendar keeps all seven aligned days inside one scroll viewport', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const channelId = readFixtureIds().channelIds[0];
  if (channelId === undefined) throw new Error('Fixture channel missing');
  const day = 24 * 3_600_000;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay() + 2);
  let title = '';
  await page.route(`**/api/channels/${channelId}`, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as GetChannelsByNumberV2Response;
    await route.fulfill({
      response,
      json: { ...body, startTime: +start, duration: day },
    });
  });
  await page.route(
    `**/api/channels/${channelId}/programming*`,
    async (route) => {
      const response = await route.fetch();
      const body =
        (await response.json()) as GetApiChannelsByIdProgrammingResponse;
      const content = body.lineup.find((program) => program.type === 'content');
      if (content === undefined) throw new Error('Fixture content missing');
      title = body.programs[content.id]?.program.title ?? '';
      if (title.length === 0) throw new Error('Fixture title missing');
      await route.fulfill({
        response,
        json: {
          ...body,
          lineup: [{ ...content, duration: day }],
          startTimeOffsets: [0],
          totalPrograms: 1,
        },
      });
    },
  );
  const health = watchPageHealth(
    page,
    knownIssuesFor('/channels/$channelId/programming'),
  );
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const dark of [false, true]) {
      await page.goto(`/web/channels/${channelId}/programming`);
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
      await page.getByRole('button', { name: 'Week', exact: true }).click();
      await page.mouse.move(0, 0);
      await health.settle();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
      const viewport = page.getByRole('region', {
        name: 'Week calendar',
        exact: true,
      });
      await expect(viewport).toBeVisible();
      const hourTick = viewport.getByText('1 AM', { exact: true });
      const headers = viewport.locator('[data-week-header]');
      const columns = viewport.locator('[data-week-column]');
      await expect(headers).toHaveCount(7);
      await expect(columns).toHaveCount(7);
      const assertAligned = async () => {
        const headerBounds = await headers.evaluateAll((elements) =>
          elements.map((element) => ({
            x: element.getBoundingClientRect().x,
            width: element.getBoundingClientRect().width,
          })),
        );
        const columnBounds = await columns.evaluateAll((elements) =>
          elements.map((element) => ({
            x: element.getBoundingClientRect().x,
            width: element.getBoundingClientRect().width,
          })),
        );
        headerBounds.forEach((header, index) => {
          expect(header.x).toBeCloseTo(columnBounds[index].x, 0);
          expect(header.width).toBeCloseTo(columnBounds[index].width, 0);
        });
      };
      await assertAligned();
      if (width === 390) {
        await viewport.focus();
        await page.keyboard.press('ArrowRight');
        await expect
          .poll(() => viewport.evaluate((element) => element.scrollLeft))
          .toBeGreaterThan(0);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(hourTick).toBeInViewport();
      const tuesday = columns.nth(2);
      await tuesday.getByText(title, { exact: true }).scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(tuesday.getByText(title, { exact: true })).toBeInViewport();
      await assertAligned();
      await page.screenshot({
        path: testInfo.outputPath(
          `week-calendar-tuesday-${width}-${dark ? 'dark' : 'light'}.png`,
        ),
        fullPage: true,
        animations: 'disabled',
      });
      await viewport.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
      });
      await assertAligned();
      await expect(hourTick).toBeInViewport();
      const lastHeader = await headers.last().boundingBox();
      const lastColumn = await columns.last().boundingBox();
      const bounds = await viewport.boundingBox();
      if (lastHeader === null || lastColumn === null || bounds === null)
        throw new Error('Calendar geometry missing');
      expect(lastHeader.x + lastHeader.width).toBeLessThanOrEqual(
        bounds.x + bounds.width + 1,
      );
      expect(lastColumn.x).toBeGreaterThanOrEqual(bounds.x);
      await expect(
        columns.last().getByText(title, { exact: true }),
      ).toBeInViewport();
      await page.screenshot({
        path: testInfo.outputPath(
          `week-calendar-${width}-${dark ? 'dark' : 'light'}.png`,
        ),
        fullPage: true,
        animations: 'disabled',
      });
      await headers.last().locator('span').last().click();
      await expect(
        page.getByRole('button', { name: 'Day', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true');
    }
  }
  expect(health.problems).toEqual([]);
});
