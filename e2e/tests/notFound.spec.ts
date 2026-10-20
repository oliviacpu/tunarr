import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

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
