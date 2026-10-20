import { expect, test } from '@playwright/test';
import { SERVER_URL } from '../fixture/env.ts';
import { savedSettings } from './settingsForm.ts';

// The Scanner page: a change saves, survives a reload and moves nothing else.

type MediaSourceSettings = { rescanIntervalHours: number };

const SETTINGS_URL = `${SERVER_URL}/api/settings/media-source`;

test('a changed rescan interval saves, survives a reload and moves nothing else', async ({
  page,
}) => {
  const before = await savedSettings<MediaSourceSettings>(page, SETTINGS_URL);
  await page.goto('/web/settings/library');
  const interval = page.getByLabel('Rescan interval (hours)');
  await expect(interval).toHaveValue(String(before.rescanIntervalHours));
  const form = interval.locator('xpath=ancestor::form');
  await expect(
    form.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled();

  const changed = before.rescanIntervalHours + 6;
  await interval.fill(String(changed));
  const saved = page.waitForResponse(
    (res) => res.url() === SETTINGS_URL && res.request().method() === 'PUT',
  );
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await saved).ok()).toBe(true);

  await page.reload();
  await expect(interval).toHaveValue(String(changed));
  expect(await savedSettings(page, SETTINGS_URL)).toEqual({
    ...before,
    rescanIntervalHours: changed,
  });
});
