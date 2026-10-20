import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { api } from '../fixture/api.ts';
import { readFixtureIds } from './routes.ts';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const ids = readFixtureIds();
  await api('POST', `/channels/${ids.channelIds[1]}/programming`, {
    type: 'time',
    programs: [ids.movieId, ids.episodeId],
    schedule: {
      type: 'time',
      flexPreference: 'end',
      latenessMs: 0,
      maxDays: 1,
      padMs: 1000,
      period: 'day',
      timeZoneOffset: 0,
      slots: [
        {
          id: randomUUID(),
          type: 'custom-show',
          customShowId: ids.customShowId,
          order: 'next',
          startTime: 0,
        },
        {
          id: randomUUID(),
          type: 'smart-collection',
          smartCollectionId: ids.smartCollectionId,
          order: 'next',
          startTime: 43_200_000,
        },
      ],
    },
  });
});

for (const [path, count, channels] of [
  ['fillers', 1, ['E2E Mixed']],
  ['custom-shows', 2, ['E2E Mixed', 'E2E Episodes']],
  ['smart_collections', 1, ['E2E Episodes']],
] as const) {
  test(`${path} shows references and warns by channel name before deletion`, async ({
    page,
  }) => {
    mkdirSync('/private/tmp/tunarr-p3-screenshots', { recursive: true });
    for (const width of [390, 1440]) {
      for (const darkMode of [false, true]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(`/web/library/${path}`);
        await expect(page.getByRole('button', { name: /Enable (light|dark) Mode/ })).toBeVisible();
        const toggle = page.getByRole('button', {
          name: darkMode ? 'Enable dark Mode' : 'Enable light Mode',
          exact: true,
        });
        if (await toggle.isVisible()) await toggle.click();
        await expect(
          page.getByRole('button', {
            name: darkMode ? 'Enable light Mode' : 'Enable dark Mode',
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByText(
            `Used by ${count} ${count === 1 ? 'channel' : 'channels'}`,
            { exact: true },
          ),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        await page
          .getByText(
            `Used by ${count} ${count === 1 ? 'channel' : 'channels'}`,
            { exact: true },
          )
          .scrollIntoViewIfNeeded();
        const filename = `${path}-${width}-${darkMode ? 'dark' : 'light'}`;
        await page.screenshot({
          path: `/private/tmp/tunarr-p3-screenshots/${filename}.png`,
          fullPage: true,
          animations: 'disabled',
        });
        await page
          .getByRole('button', { name: 'Delete', exact: true })
          .first()
          .click();
        const dialog = page.getByRole('dialog');
        for (const channel of channels)
          await expect(dialog.getByText(new RegExp(channel))).toBeVisible();
        await expect(
          dialog.getByRole('button', { name: 'Delete', exact: true }),
        ).toBeEnabled();
        await page.screenshot({
          path: `/private/tmp/tunarr-p3-screenshots/${filename}-delete.png`,
          fullPage: true,
          animations: 'disabled',
        });
        await dialog
          .getByRole('button', { name: 'Cancel', exact: true })
          .click();
      }
    }
  });
}
