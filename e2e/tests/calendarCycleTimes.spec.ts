import { expect, test } from '@playwright/test';
import type {
  GetApiChannelsByIdProgrammingResponse,
  GetChannelsByNumberV2Response,
} from '../../web/src/generated/types.gen.ts';
import { knownIssuesFor } from './knownIssues.ts';
import { watchPageHealth } from './pageHealth.ts';
import { readFixtureIds } from './routes.ts';

test('seven-hour calendar cycles show distinct start times without duplicate keys', async ({
  page,
}, testInfo) => {
  const channelId = readFixtureIds().channelIds[0];
  if (channelId === undefined) throw new Error('Fixture channel missing');
  const hour = 3_600_000;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  let title = '';
  await page.route(`**/api/channels/${channelId}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = (await response.json()) as GetChannelsByNumberV2Response;
    await route.fulfill({
      response,
      json: { ...body, startTime: +start, duration: 7 * hour },
    });
  });
  await page.route(
    `**/api/channels/${channelId}/programming*`,
    async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const body =
        (await response.json()) as GetApiChannelsByIdProgrammingResponse;
      const movie = body.lineup.find(
        (program) =>
          program.type === 'content' &&
          body.programs[program.id]?.program.type === 'movie',
      );
      if (movie === undefined || movie.type !== 'content')
        throw new Error('Fixture movie missing');
      title = body.programs[movie.id]?.program.title ?? '';
      if (title.length === 0) throw new Error('Fixture movie title missing');
      await route.fulfill({
        response,
        json: {
          ...body,
          lineup: [{ ...movie, duration: 7 * hour }],
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
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/web/channels/${channelId}/programming`);
  for (const view of ['Day', 'Week']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    await health.settle();
    const cards = page
      .locator('.MuiPaper-root')
      .filter({ hasText: title })
      .filter({ hasNot: page.locator('.MuiPaper-root') });
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThan(3);
    if (view === 'Day') {
      const labels = await cards.allTextContents();
      expect(new Set(labels).size).toBe(labels.length);
    }
    await page.screenshot({
      path: testInfo.outputPath(`calendar-cycle-${view.toLowerCase()}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
  expect(health.problems).toEqual([]);
});
