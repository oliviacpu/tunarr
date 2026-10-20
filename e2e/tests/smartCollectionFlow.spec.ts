import { expect, test } from '@playwright/test';
import { SERVER_URL } from '../fixture/env.ts';
import type { SmartCollection } from '../../types/src/index.ts';

const collectionsUrl = `${SERVER_URL}/api/smart_collections`;
const movieFilter = {
  type: 'value',
  fieldSpec: { key: 'type', type: 'faceted_string', op: '=', value: ['movie'] },
};

test('Create explains the search step and returns to the saved collection', async ({
  page,
}) => {
  await page.goto('/web/library/smart_collections');
  await page.getByRole('link', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/createCollection=true/);
  await expect(page.getByRole('alert')).toHaveText(
    'Build the query, then Save as collection',
  );
  await page.getByLabel('Keywords', { exact: true }).fill('space');
  await page.getByLabel('Filter', { exact: true }).fill('type:movie');
  await page
    .getByRole('button', { name: 'Save as collection', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('P4 Saved search');
  const saved = page.waitForResponse(
    (response) =>
      response.url() === collectionsUrl &&
      response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await saved).ok()).toBe(true);
  await expect(page).toHaveURL(/\/library\/smart_collections\/?$/);
  await expect(
    page.getByRole('cell', { name: 'P4 Saved search', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('cell', { name: 'P4 Saved search', exact: true }),
  ).toBeVisible();
  const all = (await (
    await page.request.get(collectionsUrl)
  ).json()) as SmartCollection[];
  expect(
    all.find((collection) => collection.name === 'P4 Saved search'),
  ).toMatchObject({ keywords: 'space', filterString: 'type = "movie"' });
  await page.goto('/web/search');
  await expect(
    page.getByText('Build the query, then Save as collection'),
  ).not.toBeVisible();
});

test('edit persists keywords/filter/name, supports both builders and clears the query', async ({
  page,
}) => {
  const original = (await (
    await page.request.post(collectionsUrl, {
      data: { name: 'P4 Edit source', keywords: 'space', filter: movieFilter },
    })
  ).json()) as SmartCollection;
  await page.goto('/web/library/smart_collections');
  const row = page.getByRole('row').filter({
    has: page.getByRole('cell', { name: original.name, exact: true }),
  });
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Keywords')).toHaveValue('space');
  await dialog.getByLabel('Name').fill('P4 Updated source');
  await dialog.getByLabel('Keywords').fill('science');
  await dialog.getByLabel('Filter', { exact: true }).fill('type:episode');
  await dialog
    .getByRole('button', { name: 'Visual filter builder', exact: true })
    .click();
  await expect(dialog.getByLabel('Filter', { exact: true })).toHaveValue(
    'type = "episode"',
  );
  await dialog
    .getByRole('button', { name: 'Text filter', exact: true })
    .click();
  const saved = page.waitForResponse(
    (response) =>
      response.url() === `${collectionsUrl}/${original.uuid}` &&
      response.request().method() === 'PUT',
  );
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await saved).ok()).toBe(true);
  await expect(dialog).not.toBeVisible();
  await page.reload();
  const updatedRow = page.getByRole('row').filter({
    has: page.getByRole('cell', { name: 'P4 Updated source', exact: true }),
  });
  await updatedRow.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(dialog.getByLabel('Keywords')).toHaveValue('science');
  await expect(dialog.getByLabel('Filter', { exact: true })).toHaveValue(
    'type = "episode"',
  );
  await dialog.getByLabel('Keywords').fill('');
  await dialog.getByLabel('Filter', { exact: true }).fill('');
  const cleared = page.waitForResponse(
    (response) =>
      response.url() === `${collectionsUrl}/${original.uuid}` &&
      response.request().method() === 'PUT',
  );
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await cleared).ok()).toBe(true);
  const persisted = (await (
    await page.request.get(`${collectionsUrl}/${original.uuid}`)
  ).json()) as SmartCollection;
  expect(persisted.keywords).toBe('');
  expect(persisted.filter).toBeUndefined();
  expect(persisted.filterString).toBeUndefined();
  await updatedRow
    .getByRole('button', { name: 'View Collection', exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/smart_collections/${original.uuid}$`),
  );
  await expect(page.getByLabel('Keywords', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Filter', { exact: true })).toHaveValue('');
});

test('invalid filter cannot save and Cancel leaves the stored query intact', async ({
  page,
}) => {
  const original = (await (
    await page.request.post(collectionsUrl, {
      data: {
        name: 'P4 Cancel source',
        keywords: 'space',
        filter: movieFilter,
      },
    })
  ).json()) as SmartCollection;
  await page.goto('/web/library/smart_collections');
  const row = page.getByRole('row').filter({
    has: page.getByRole('cell', { name: original.name, exact: true }),
  });
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Filter', { exact: true }).fill('(');
  await expect(
    dialog.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByText(/Could not parse this filter expression/),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(
    await (await page.request.get(`${collectionsUrl}/${original.uuid}`)).json(),
  ).toEqual(original);
});

test('saving an unrestricted search over an existing collection clears its query', async ({
  page,
}) => {
  const original = (await (
    await page.request.post(collectionsUrl, {
      data: {
        name: 'P4 Replace query',
        keywords: 'space',
        filter: movieFilter,
      },
    })
  ).json()) as SmartCollection;
  await page.goto('/web/library/smart_collections');
  await page.getByRole('link', { name: 'Create', exact: true }).click();
  await page
    .getByRole('button', { name: 'Save as collection', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox').click();
  await page.getByRole('option', { name: original.name, exact: true }).click();
  const saved = page.waitForResponse(
    (response) =>
      response.url() === `${collectionsUrl}/${original.uuid}` &&
      response.request().method() === 'PUT',
  );
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await saved).ok()).toBe(true);
  await expect(page).toHaveURL(/\/library\/smart_collections\/?$/);
  const persisted = (await (
    await page.request.get(`${collectionsUrl}/${original.uuid}`)
  ).json()) as SmartCollection;
  expect(persisted.name).toBe(original.name);
  expect(persisted.keywords).toBe('');
  expect(persisted.filterString).toBeUndefined();
  expect(persisted.filter).toBeUndefined();
});

test('creation and query editing fit phone/desktop in both themes', async ({
  page,
}, testInfo) => {
  const original = (await (
    await page.request.post(collectionsUrl, {
      data: {
        name: 'P4 Layout source',
        keywords: 'space',
        filter: movieFilter,
      },
    })
  ).json()) as SmartCollection;
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/web/library/smart_collections');
      await expect(
        page.getByRole('button', { name: /Enable (light|dark) Mode/ }),
      ).toBeVisible();
      const themeToggle = page.getByRole('button', {
        name: colorScheme === 'dark' ? 'Enable dark Mode' : 'Enable light Mode',
        exact: true,
      });
      if (await themeToggle.isVisible()) await themeToggle.click();
      await expect(
        page.getByRole('button', {
          name:
            colorScheme === 'dark' ? 'Enable light Mode' : 'Enable dark Mode',
          exact: true,
        }),
      ).toBeVisible();
      await page.getByRole('link', { name: 'Create', exact: true }).click();
      await expect(
        page.getByText('Build the query, then Save as collection'),
      ).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`create-${colorScheme}-${width}.png`),
        fullPage: true,
        animations: 'disabled',
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.goto('/web/library/smart_collections');
      await page
        .getByRole('row')
        .filter({
          has: page.getByRole('cell', { name: original.name, exact: true }),
        })
        .getByRole('button', { name: 'Edit', exact: true })
        .click();
      await expect(
        page.getByRole('dialog').getByLabel('Filter', { exact: true }),
      ).toHaveValue('type = "movie"');
      await page.screenshot({
        path: testInfo.outputPath(`edit-${colorScheme}-${width}.png`),
        fullPage: true,
        animations: 'disabled',
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
  }
});
