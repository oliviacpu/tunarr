import { expect, test } from '@playwright/test';
import { SERVER_URL } from '../fixture/env.ts';
import { save, saveButton, savedSettings } from './settingsForm.ts';

// The Tuner (HDHomeRun) page: a change saves, survives a reload and moves
// nothing else.

type HdhrSettings = { autoDiscoveryEnabled: boolean; tunerCount: number };

const SETTINGS_URL = `${SERVER_URL}/api/hdhr-settings`;

test('a changed tuner count saves, survives a reload and moves nothing else', async ({
  page,
}) => {
  const before = await savedSettings<HdhrSettings>(page, SETTINGS_URL);
  await page.goto('/web/settings/tuner');
  const tunerCount = page.getByLabel('Tuner count');
  await expect(tunerCount).toHaveValue(String(before.tunerCount));
  await expect(saveButton(page)).toBeDisabled();

  const changed = before.tunerCount + 1;
  await tunerCount.fill(String(changed));
  await save(page, SETTINGS_URL);

  await page.reload();
  await expect(tunerCount).toHaveValue(String(changed));
  expect(await savedSettings(page, SETTINGS_URL)).toEqual({
    ...before,
    tunerCount: changed,
  });
});
