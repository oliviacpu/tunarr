import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { SERVER_URL } from '../fixture/env.ts';

// The guide (XMLTV) page is the reference for the settings form shell: a
// change saves, survives a reload and moves nothing else; Restore defaults is
// a change like any other until it is saved.

test.describe.configure({ mode: 'serial' });

type XmlTvSettings = {
  programmingHours: number;
  refreshHours: number;
  refreshStartHour: number;
  outputPath: string;
  useShowPoster: boolean;
  publicUrl: string;
};

const SETTINGS_URL = `${SERVER_URL}/api/settings/xmltv`;

const savedSettings = async (page: Page) => {
  const res = await page.request.get(SETTINGS_URL);
  return (await res.json()) as XmlTvSettings;
};

const startHour = (page: Page) =>
  page.getByRole('combobox', { name: 'Refreshes start at' });
const saveButton = (page: Page) =>
  page.getByRole('button', { name: 'Save', exact: true });

const open = async (page: Page) => {
  await page.goto('/web/settings/guide');
  await expect(startHour(page)).toBeVisible();
};

const pickStartHour = async (page: Page, hour: string) => {
  await startHour(page).click();
  await page.getByRole('option', { name: hour, exact: true }).click();
};

const save = async (page: Page) => {
  const saved = page.waitForResponse(
    (res) => res.request().method() === 'PUT' && res.url() === SETTINGS_URL,
  );
  await saveButton(page).click();
  expect((await saved).ok()).toBe(true);
};

test('a changed start hour saves, survives a reload and moves nothing else', async ({
  page,
}) => {
  const before = await savedSettings(page);
  await open(page);
  await expect(saveButton(page)).toBeDisabled();

  await pickStartHour(page, '05:00');
  await save(page);

  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(saveButton(page)).toBeDisabled();
  await page.reload();
  await expect(startHour(page)).toHaveText('05:00');
  expect(await savedSettings(page)).toEqual({
    ...before,
    refreshStartHour: 5,
  });
});

test('Restore defaults is a change: it can be undone, guards leaving, and saves', async ({
  page,
}) => {
  const before = await savedSettings(page);
  const put = await page.request.put(SETTINGS_URL, {
    data: { ...before, refreshStartHour: 7 },
  });
  expect(put.ok()).toBe(true);
  await open(page);
  await expect(startHour(page)).toHaveText('07:00');

  await page.getByRole('button', { name: 'Restore defaults' }).click();
  await expect(startHour(page)).toHaveText('00:00');
  await expect(saveButton(page)).toBeEnabled();

  // Leaving with the defaults unsaved asks first
  await page.getByRole('tab', { name: 'General' }).click();
  await expect(page.getByText('You have unsaved changes!')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/settings\/guide$/);

  await page.getByRole('button', { name: 'Reset changes' }).click();
  await expect(startHour(page)).toHaveText('07:00');
  await expect(saveButton(page)).toBeDisabled();

  await page.getByRole('button', { name: 'Restore defaults' }).click();
  await save(page);
  await page.reload();
  await expect(startHour(page)).toHaveText('00:00');
  const after = await savedSettings(page);
  expect(after.refreshStartHour).toBe(0);
  // The output path is not a setting the page restores
  expect(after.outputPath).toBe(before.outputPath);
});
