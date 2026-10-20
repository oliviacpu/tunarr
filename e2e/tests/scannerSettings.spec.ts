import { expect, test } from '@playwright/test';
import { SERVER_URL } from '../fixture/env.ts';
import { save, saveButton, savedSettings } from './settingsForm.ts';

// The Scanner page: a change saves, survives a reload and moves nothing else.

type MediaSourceSettings = { rescanIntervalHours: number };

const SETTINGS_URL = `${SERVER_URL}/api/settings/media-source`;

test('a changed rescan interval saves, survives a reload and moves nothing else', async ({
  page,
}) => {
  const before = await savedSettings<MediaSourceSettings>(page, SETTINGS_URL);
  await page.goto('/web/settings/scanner');
  const interval = page.getByLabel('Rescan interval (hours)');
  await expect(interval).toHaveValue(String(before.rescanIntervalHours));
  await expect(saveButton(page)).toBeDisabled();

  const changed = before.rescanIntervalHours + 6;
  await interval.fill(String(changed));
  await save(page, SETTINGS_URL);

  await page.reload();
  await expect(interval).toHaveValue(String(changed));
  expect(await savedSettings(page, SETTINGS_URL)).toEqual({
    ...before,
    rescanIntervalHours: changed,
  });
});
