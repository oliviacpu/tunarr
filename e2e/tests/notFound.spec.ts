import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { WEB_URL } from '../fixture/env.ts';
import { readFixtureIds } from './routes.ts';

// An address that leads nowhere shows the not-found page inside the app shell,
// both when no route matches and when a route's loader finds that what it
// loads is gone.

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

const notFoundHeading = (page: Page) =>
  page.getByRole('heading', { name: 'Not found', exact: true });

test('an address no route matches shows the not-found page', async ({
  page,
}) => {
  await page.goto('/web/does-not-exist');

  await expect(notFoundHeading(page)).toBeVisible();
  await page.getByRole('link', { name: 'Go to Channels' }).click();
  await expect(page).toHaveURL(/\/web\/channels$/);
});

for (const path of [
  `/channels/${MISSING_ID}`,
  `/library/smart_collections/${MISSING_ID}`,
  `/media_sources/${MISSING_ID}`,
  `/media_sources/${MISSING_ID}/libraries/${MISSING_ID}`,
  `/settings/ffmpeg/${MISSING_ID}`,
  `/media/movie/${MISSING_ID}`,
  `/media/show/${MISSING_ID}`,
  `/library/fillers/${MISSING_ID}/edit`,
  `/library/custom-shows/${MISSING_ID}/edit`,
]) {
  test(`a missing entity at ${path} shows the not-found page`, async ({
    page,
  }) => {
    await page.goto(`/web${path}`);

    await expect(notFoundHeading(page)).toBeVisible();
    await expect(
      page.getByText('Looks like something went wrong.'),
    ).toHaveCount(0);
  });
}

test('a failed detail lookup keeps the route error UI rather than showing not found', async ({
  page,
}) => {
  await page.route(`**/api/smart_collections/${MISSING_ID}`, (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': WEB_URL },
      body: JSON.stringify({ message: 'Lookup failed' }),
    }),
  );
  await page.goto(`/web/library/smart_collections/${MISSING_ID}`);
  await expect(page.getByText('Looks like something went wrong.')).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('Lookup failed', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Try again', exact: true }),
  ).toBeVisible();
  await expect(notFoundHeading(page)).toHaveCount(0);
});

for (const status of [404, 500]) {
  test(`a cached entity awaits a fresh lookup and handles ${status}`, async ({
    page,
  }) => {
    const { smartCollectionId } = readFixtureIds();
    const path = `/web/library/smart_collections/${smartCollectionId}`;
    await page.goto(path);
    await expect(
      page.getByRole('heading', { name: /^Smart Collection:/ }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Channels', exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(/\/web\/channels$/);
    await expect(
      page.getByRole('heading', { name: 'Channels', exact: true }),
    ).toBeVisible();
    await page.route(`**/api/smart_collections/${smartCollectionId}`, (route) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': WEB_URL },
        body: JSON.stringify({
          message: status === 404 ? 'Not found' : 'Lookup failed',
        }),
      }),
    );
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${smartCollectionId}$`));
    if (status === 404) {
      await expect(notFoundHeading(page)).toBeVisible();
      await expect(
        page.getByText('Looks like something went wrong.'),
      ).toHaveCount(0);
    } else {
      await expect(
        page.getByText('Looks like something went wrong.'),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByText('Lookup failed', { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Try again', exact: true }),
      ).toBeVisible();
      await expect(notFoundHeading(page)).toHaveCount(0);
    }
  });
}
