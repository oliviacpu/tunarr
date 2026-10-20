import { expect, test } from '@playwright/test';
import type {
  GetApiChannelsByIdProgrammingResponse,
  GetChannelsByNumberV2Response,
} from '../../web/src/generated/types.gen.ts';
import { knownIssuesFor } from './knownIssues.ts';
import { watchPageHealth } from './pageHealth.ts';
import { readFixtureIds } from './routes.ts';

test('lineup, mid-roll and calendar colours follow both schemes with tabular times', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const ids = readFixtureIds();
  const [channelId, targetId] = ids.channelIds;
  if (channelId === undefined || targetId === undefined)
    throw new Error('Fixture needs two channels');
  const hour = 3_600_000;
  const duration = 24 * hour;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  let movieTitle = '';
  await page.route(`**/api/channels/${channelId}`, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as GetChannelsByNumberV2Response;
    await route.fulfill({
      response,
      json: { ...body, startTime: +start, duration },
    });
  });
  await page.route(
    `**/api/channels/${channelId}/programming*`,
    async (route) => {
      const response = await route.fetch();
      const body =
        (await response.json()) as GetApiChannelsByIdProgrammingResponse;
      const [first, second] = body.lineup.filter(
        (program) => program.type === 'content',
      );
      const custom = body.lineup.find((program) => program.type === 'custom');
      if (first === undefined || second === undefined || custom === undefined)
        throw new Error('Fixture needs movies and a custom episode');
      movieTitle = body.programs[first.id]?.program.title ?? '';
      if (movieTitle.length === 0) throw new Error('Fixture movie missing');
      const lineup: typeof body.lineup = [
        { ...first, duration: 4 * hour, startOffsetMs: 0 },
        {
          type: 'flex',
          duration: hour,
          fillerConfig: { origin: 'midroll' },
        },
        { ...first, duration: 4 * hour, startOffsetMs: 4 * hour },
        { ...second, duration: 6 * hour },
        { ...custom, duration: 4 * hour },
        {
          type: 'redirect',
          channel: targetId,
          channelNumber: 2,
          channelName: 'E2E Episodes',
          duration: 4 * hour,
        },
        { type: 'flex', duration: hour },
      ];
      let offset = 0;
      const startTimeOffsets = lineup.map((program) => {
        const result = offset;
        offset += program.duration;
        return result;
      });
      await route.fulfill({
        response,
        json: {
          ...body,
          lineup,
          startTimeOffsets,
          totalPrograms: lineup.length,
        },
      });
    },
  );
  const health = watchPageHealth(
    page,
    knownIssuesFor('/channels/$channelId/programming'),
  );
  const schemeFills = new Map<number, string[]>();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const fills: string[] = [];
    for (const dark of [false, true]) {
      await page.goto(`/web/channels/${channelId}/programming`);
      const toggle = page.getByRole('button', {
        name: dark ? 'Enable dark Mode' : 'Enable light Mode',
        exact: true,
      });
      await expect(
        page.getByRole('button', { name: /Enable (light|dark) Mode/ }),
      ).toBeVisible();
      if (await toggle.isVisible()) await toggle.click();
      await expect(
        page.getByRole('button', {
          name: dark ? 'Enable light Mode' : 'Enable dark Mode',
          exact: true,
        }),
      ).toBeVisible();
      await health.settle();
      const group = page
        .locator('.MuiListItem-root')
        .filter({ has: page.getByText('1 break', { exact: true }) });
      await expect(group).toHaveCount(1);
      await expect(group).toHaveCSS('font-variant-numeric', 'tabular-nums');
      await group.click();
      await page.mouse.move(0, 0);
      const groupFill = await group.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      const customRow = page
        .locator('.MuiListItem-root')
        .filter({ hasText: 'E2E Reruns' });
      await expect(customRow).toHaveCount(1);
      const customBackground = await customRow.evaluate(
        (element) => getComputedStyle(element).backgroundImage,
      );
      const customFill = [...customBackground.matchAll(/rgba?\([^)]+\)/g)].at(
        -1,
      )?.[0];
      if (customFill === undefined)
        throw new Error('Custom-show row fill missing');
      fills.push(groupFill);
      await page.screenshot({
        path: testInfo.outputPath(
          `lineup-midroll-${width}-${dark ? 'dark' : 'light'}.png`,
        ),
        fullPage: true,
        animations: 'disabled',
      });

      for (const view of ['Day', 'Week']) {
        await page.getByRole('button', { name: view, exact: true }).click();
        await health.settle();
        const cards = page
          .locator('.MuiPaper-root')
          .filter({ hasText: movieTitle })
          .filter({ hasNot: page.locator('.MuiPaper-root') });
        await expect(cards.first()).toBeVisible();
        await expect(cards.first()).toHaveCSS('background-color', groupFill);
        await expect(cards.first()).toHaveCSS(
          'font-variant-numeric',
          'tabular-nums',
        );
        const calendarFills = await page
          .locator('.MuiPaper-root')
          .filter({ hasNot: page.locator('.MuiPaper-root') })
          .evaluateAll((elements) =>
            elements.map(
              (element) => getComputedStyle(element).backgroundColor,
            ),
          );
        expect(calendarFills).toContain(customFill);
        await page.screenshot({
          path: testInfo.outputPath(
            `calendar-${view.toLowerCase()}-${width}-${dark ? 'dark' : 'light'}.png`,
          ),
          fullPage: true,
          animations: 'disabled',
        });
      }
    }
    schemeFills.set(width, fills);
    expect(fills[0]).not.toBe(fills[1]);
  }
  expect(schemeFills.get(390)).toEqual(schemeFills.get(1440));
  expect(health.problems).toEqual([]);
});
