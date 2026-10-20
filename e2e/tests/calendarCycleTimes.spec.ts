import { expect, test } from '@playwright/test';
import type {
  GetApiChannelsByIdProgrammingResponse,
  GetChannelsByNumberV2Response,
} from '../../web/src/generated/types.gen.ts';
import { knownIssuesFor } from './knownIssues.ts';
import { watchPageHealth } from './pageHealth.ts';
import { readFixtureIds } from './routes.ts';

for (const { name, durations, phaseOffsetHours } of [
  { name: 'seven-hour', durations: [7], phaseOffsetHours: 0 },
  {
    name: 'appended program with stale saved duration',
    durations: [7, 1],
    phaseOffsetHours: 0,
  },
  {
    name: 'initial phase inside the final program',
    durations: [7, 1],
    phaseOffsetHours: 7.5,
  },
]) {
  test(`${name} calendar cycles show distinct start times without duplicate keys`, async ({
    page,
  }, testInfo) => {
    const channelId = readFixtureIds().channelIds[0];
    if (channelId === undefined) throw new Error('Fixture channel missing');
    const hour = 3_600_000;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay());
    start.setTime(+start - phaseOffsetHours * hour);
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
        let offset = 0;
        const startTimeOffsets = durations.map((duration) => {
          const startOffset = offset;
          offset += duration * hour;
          return startOffset;
        });
        await route.fulfill({
          response,
          json: {
            ...body,
            lineup: durations.map((duration) => ({
              ...movie,
              duration: duration * hour,
            })),
            startTimeOffsets,
            totalPrograms: durations.length,
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
        const allLabels = await cards.allTextContents();
        const labels =
          phaseOffsetHours === 0
            ? allLabels
            : allLabels.filter((label) => label.trim() !== title);
        expect(labels.length).toBeGreaterThan(3);
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
}
